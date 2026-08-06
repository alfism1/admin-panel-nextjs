import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { db } from "@/db/client";
import { newId } from "@/db/id";

import type { ResourceDescriptor } from "./define";

/**
 * The generic data-access layer.
 *
 * Drizzle only: no authorization, no auditing, no zod. Everything here assumes
 * its input was already validated by the service, which is what makes these
 * functions safe to call from a seed script with no request context around it.
 *
 * The reason this is a factory rather than something each module copies is the
 * search strategy below. It is the one piece of a CRUD module that is genuinely
 * hard to get right, and hand-writing it per module means every new module gets
 * a fresh chance to reintroduce the 40-second query.
 */

export type ResourceRow = Record<string, unknown> & { id: string };

export interface ResourceListInput extends Record<string, unknown> {
  page: number;
  pageSize: number;
  sort: string;
  order: "asc" | "desc";
  search: string;
}

export interface ResourcePage {
  rows: ResourceRow[];
  /**
   * Rows matching the filter. A floor rather than the count when `totalCapped`
   * — the pager has to say "5,000+" instead of claiming a total it never
   * measured.
   */
  total: number;
  totalCapped: boolean;
}

export interface ResourceRepository {
  list: (input: ResourceListInput) => Promise<ResourcePage>;
  findById: (id: string) => Promise<ResourceRow | null>;
  isTaken: (
    fieldName: string,
    value: unknown,
    exceptId?: string,
  ) => Promise<boolean>;
  stats: () => Promise<{ total: number; archived: number }>;
  insert: (values: Record<string, unknown>) => Promise<ResourceRow>;
  update: (
    id: string,
    values: Record<string, unknown>,
  ) => Promise<ResourceRow | null>;
  remove: (id: string) => Promise<void>;
}

/**
 * How far `list` counts before it stops and reports a floor.
 *
 * An unpaged `count(*)` visits every matching row. At 7M rows a broad term
 * costs seconds — on every keystroke — to produce a number nobody reads past
 * the first two digits. Counting to a cap makes the cost bounded instead of
 * proportional (measured on products: 3.6s → 29ms).
 */
const DEFAULT_MATCH_CAP = 5_000;

/** `\`, `%` and `_` are LIKE metacharacters: searching "100%" must not scan the table. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function createResourceRepository(
  descriptor: ResourceDescriptor,
  options: { table: PgTable; matchCap?: number },
): ResourceRepository {
  const { table } = options;
  const matchCap = options.matchCap ?? DEFAULT_MATCH_CAP;
  const columns = getTableColumns(table) as Record<string, PgColumn>;

  function column(name: string): PgColumn {
    const found = columns[name];
    if (!found) {
      throw new Error(
        `Resource "${descriptor.name}": no column "${name}" on table "${String(
          descriptor.segment,
        )}". Field names must match the Drizzle table.`,
      );
    }
    return found;
  }

  const idColumn = column("id");
  const createdAtColumn = columns.createdAt;
  const updatedAtColumn = columns.updatedAt;
  const archivedColumn = descriptor.archivable ? column("archived") : null;

  const searchColumns = descriptor.searchFields.map(column);
  const sortColumns: Record<string, PgColumn> = Object.fromEntries(
    descriptor.sortKeys.map((key) => [key, column(key)]),
  );

  // ---- predicate -----------------------------------------------------------

  function buildWhere(input: ResourceListInput): SQL | undefined {
    const clauses: SQL[] = [];

    const term = input.search.trim();
    if (term && searchColumns.length > 0) {
      const pattern = likePattern(term);
      const searchClause = or(
        ...searchColumns.map((col) => ilike(col, pattern)),
      );
      if (searchClause) clauses.push(searchClause);
    }

    if (archivedColumn) {
      if (input.status === "archived") {
        clauses.push(eq(archivedColumn, true));
      } else if (input.status === "active") {
        clauses.push(eq(archivedColumn, false));
      }
    }

    for (const filter of descriptor.filters) {
      if (filter.name === "status" && archivedColumn) continue;
      const value = input[filter.name];
      if (typeof value === "string" && value !== "") {
        clauses.push(eq(column(filter.name), value));
      }
    }

    // `and()` of nothing is not the same as no WHERE at all — return undefined
    // so Drizzle omits the clause entirely.
    if (clauses.length === 0) return undefined;
    return and(...clauses);
  }

  /**
   * Driver rows back into field-keyed rows.
   *
   * `db.execute` bypasses Drizzle's result mapper, so values arrive as the
   * driver sent them and keys are column names, not field names. Timestamps are
   * the trap: Drizzle installs pg type parsers that hand back raw strings and
   * does the `Date` construction itself in the mapper this path skips.
   * `mapFromDriverValue` is that mapper, called per column.
   */
  function fromDriverRow(driverRow: Record<string, unknown>): ResourceRow {
    const row: Record<string, unknown> = {};
    for (const [fieldName, col] of Object.entries(columns)) {
      const raw = driverRow[col.name];
      row[fieldName] =
        raw === null || raw === undefined || raw instanceof Date
          ? raw
          : col.mapFromDriverValue(raw);
    }
    return row as ResourceRow;
  }

  // ---- reads ---------------------------------------------------------------

  /**
   * One page of rows, plus the total across all pages.
   *
   * There is no single query plan that is fast for every search, so this picks
   * one. The two candidates are `selectPage` and `selectPageByMatches`, and
   * which wins depends entirely on how many rows the term matches:
   *
   *   matches │ selectPage │ selectPageByMatches
   *   ────────┼────────────┼────────────────────
   *         0 │  40,000ms  │       0.7ms
   *       100 │   8,500ms  │       167ms
   *     1,000 │   1,000ms  │       167ms
   *    10,000 │      93ms  │       313ms
   *   580,000 │       4ms  │     9,000ms
   *
   * They cross at a few thousand, which is what `matchCap` is set near — so the
   * capped count is both the number the pager displays and the probe that picks
   * the plan. That is why it runs first rather than alongside: the extra round
   * trip costs ~10-175ms and saves up to 40 seconds.
   */
  async function list(input: ResourceListInput): Promise<ResourcePage> {
    const where = buildWhere(input);

    // No search term, so there is no selectivity question to answer: the sort
    // is index-ordered and the exact total is one scan the planner parallelises.
    if (!input.search.trim() || searchColumns.length === 0) {
      const [rows, [totals]] = await Promise.all([
        selectPage(input, where),
        db.select({ value: count() }).from(table).where(where),
      ]);
      return { rows, total: totals?.value ?? 0, totalCapped: false };
    }

    const total = await countUpToCap(where);
    const totalCapped = total >= matchCap;

    return {
      rows: totalCapped
        ? await selectPage(input, where)
        : await selectPageByMatches(input, where),
      total,
      totalCapped,
    };
  }

  /**
   * The paged read in the shape the planner reaches for on its own.
   *
   * `ORDER BY created_at DESC LIMIT 20` lets it walk the timestamp index
   * backwards and stop at the 20th surviving row. When matches are dense that
   * is unbeatable. When they are sparse it is the 40-second case — nothing
   * tells the planner the filter is selective, so a search matching one row
   * reads the whole table. Only call this when the count says matches are dense.
   */
  async function selectPage(
    input: ResourceListInput,
    where: SQL | undefined,
  ): Promise<ResourceRow[]> {
    const col = sortColumns[input.sort] ?? createdAtColumn ?? idColumn;
    const orderBy = input.order === "asc" ? asc(col) : desc(col);

    const rows = await db
      .select()
      .from(table)
      .where(where)
      // `id` breaks ties, so a row can't appear on two pages when the sort
      // column holds duplicates — two rows created in the same second.
      .orderBy(orderBy, asc(idColumn))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    return rows as ResourceRow[];
  }

  /**
   * The paged read with the trigram indexes forced.
   *
   * `AS MATERIALIZED` is the entire trick. It is an optimisation fence, so
   * Postgres has to resolve the filter into a row set *before* it considers the
   * ORDER BY — and resolving it means a bitmap scan over the trigram indexes.
   * The sort then runs over whatever few rows survived instead of over the table.
   *
   * The fence is also why LIMIT sits outside the CTE. Moving it inside restores
   * the planner's freedom to walk the timestamp index again, and with it the 40
   * seconds; that is a real thing to get wrong, not a hypothetical.
   *
   * Raw SQL because Drizzle's `$with` cannot spell MATERIALIZED. `where` is
   * still a Drizzle `SQL` object, so the search term stays a bound parameter.
   */
  async function selectPageByMatches(
    input: ResourceListInput,
    where: SQL | undefined,
  ): Promise<ResourceRow[]> {
    const result = await db.execute<Record<string, unknown>>(sql`
      WITH matches AS MATERIALIZED (
        SELECT ${idColumn} AS id
        FROM ${table}
        ${where ? sql`WHERE ${where}` : sql.empty()}
      )
      SELECT p.*
      FROM ${table} AS p
      JOIN matches AS m ON m.id = p.${sql.raw(`"${idColumn.name}"`)}
      ORDER BY ${orderByFragment(input)}
      LIMIT ${input.pageSize}
      OFFSET ${(input.page - 1) * input.pageSize}
    `);

    return result.rows.map(fromDriverRow);
  }

  /**
   * `count(*)` that stops at `matchCap`.
   *
   * The LIMIT is inside the subquery, so Postgres stops feeding the aggregate
   * once it has enough rows rather than resolving every match first.
   */
  async function countUpToCap(where: SQL | undefined): Promise<number> {
    const capped = db
      .select({ one: sql<number>`1` })
      .from(table)
      .where(where)
      .limit(matchCap)
      .as("capped");

    const [row] = await db.select({ value: count() }).from(capped);
    return row?.value ?? 0;
  }

  /**
   * `ORDER BY` for the raw query, aliased to `p`.
   *
   * `sql.raw` is safe here only because both halves come from the descriptor's
   * own sort keys — the zod enum in `listSchema` rejects anything else before
   * it gets this far, and the column name comes from the Drizzle table rather
   * than the request. Keep it that way.
   */
  function orderByFragment(input: ResourceListInput): SQL {
    const col = sortColumns[input.sort] ?? createdAtColumn ?? idColumn;
    const direction = input.order === "asc" ? "ASC" : "DESC";
    return sql.raw(`p."${col.name}" ${direction}, p."${idColumn.name}" ASC`);
  }

  async function findById(id: string): Promise<ResourceRow | null> {
    const [row] = await db
      .select()
      .from(table)
      .where(eq(idColumn, id))
      .limit(1);
    return (row as ResourceRow | undefined) ?? null;
  }

  /**
   * Uniqueness pre-check, so the service can raise a readable `ConflictError`
   * instead of surfacing a driver constraint violation.
   *
   * `exceptId` excludes the row being edited, so saving without touching the
   * unique field doesn't collide with itself. This is the friendly path, not
   * the guarantee — the unique index is, and it still wins under a race.
   */
  async function isTaken(
    fieldName: string,
    value: unknown,
    exceptId?: string,
  ): Promise<boolean> {
    const col = column(fieldName);
    const [row] = await db
      .select({ id: idColumn })
      .from(table)
      .where(
        exceptId ? and(eq(col, value), ne(idColumn, exceptId)) : eq(col, value),
      )
      .limit(1);
    return Boolean(row);
  }

  async function stats(): Promise<{ total: number; archived: number }> {
    if (!archivedColumn) {
      const [total] = await db.select({ value: count() }).from(table);
      return { total: total?.value ?? 0, archived: 0 };
    }

    const [[total], [archived]] = await Promise.all([
      db.select({ value: count() }).from(table),
      db.select({ value: count() }).from(table).where(eq(archivedColumn, true)),
    ]);
    return { total: total?.value ?? 0, archived: archived?.value ?? 0 };
  }

  // ---- writes --------------------------------------------------------------

  /** The id is generated here so the service can audit the row it just wrote. */
  async function insert(values: Record<string, unknown>): Promise<ResourceRow> {
    const [row] = await db
      .insert(table)
      .values({ id: newId(), ...values })
      .returning();
    // A successful insert always returns a row; this narrows the type and turns
    // a driver-level surprise into a readable error instead of an undefined
    // dereference.
    if (!row) {
      throw new Error(`Insert into ${descriptor.name} returned no row.`);
    }
    return row as ResourceRow;
  }

  /** `null` means no row matched — the service turns that into `NotFoundError`. */
  async function update(
    id: string,
    values: Record<string, unknown>,
  ): Promise<ResourceRow | null> {
    const [row] = await db
      .update(table)
      .set(updatedAtColumn ? { ...values, updatedAt: new Date() } : values)
      .where(eq(idColumn, id))
      .returning();
    return (row as ResourceRow | undefined) ?? null;
  }

  async function remove(id: string): Promise<void> {
    await db.delete(table).where(eq(idColumn, id));
  }

  return { list, findById, isTaken, stats, insert, update, remove };
}

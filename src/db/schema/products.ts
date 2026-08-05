import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(), // no gen_random_uuid() — see below
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("products_sku_unique").on(table.sku),
    index("products_archived_idx").on(table.archived),
    index("products_created_at_idx").on(table.createdAt),
    // Trigram indexes, for the search box.
    //
    // Every btree above can answer `LIKE 'term%'` and none of them can answer
    // `LIKE '%term%'` — a leading wildcard has no prefix to seek on, so the
    // planner falls back to reading the whole table. These two are what make
    // the search predicate indexable at all.
    //
    // Having them is necessary but not sufficient: the planner will still
    // ignore them for the paged query unless it is shaped to force the issue.
    // `products.repository.ts` explains the shape and why.
    index("products_sku_trgm_idx").using("gin", table.sku.op("gin_trgm_ops")),
    index("products_name_trgm_idx").using("gin", table.name.op("gin_trgm_ops")),
  ],
);

export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;

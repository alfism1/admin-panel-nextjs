import "dotenv/config";

import { isProduction } from "@/lib/env";

import { closeDatabase, db, getPool } from "./client";
import { newId } from "./id";
import { products, type NewProductRow } from "./schema";

/**
 * Bulk product seeder — built for ~1M rows.
 *
 *   pnpm db:seed:products                      # 1,000,000 rows
 *   pnpm db:seed:products --count=50000        # a smaller set
 *   pnpm db:seed:products --truncate           # wipe products first
 *   pnpm db:seed:products --start=1000000      # append a second million
 *
 * Three things make this fast, and none of them is `async` on its own — Node
 * runs one thread, so an async function that awaits every row is exactly as
 * slow as a sync one. What actually helps:
 *
 *   1. Rows are generated lazily, one batch at a time. Materialising 1M row
 *      objects up front costs hundreds of MB and buys nothing.
 *   2. Each round trip carries `--batch` rows in a single multi-row INSERT
 *      instead of one statement per row.
 *   3. `--concurrency` batches are in flight at once over the pg pool, so the
 *      driver is encoding the next statement while Postgres commits the last.
 *
 * Re-runnable: SKUs are derived from the row index, so a second run with the
 * same flags conflicts on `products_sku_unique` and inserts nothing.
 */

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/** Postgres caps a single statement at 65535 bind parameters. */
const MAX_BIND_PARAMS = 65_535;
const COLUMNS_PER_ROW = 8;
const MAX_BATCH = Math.floor(MAX_BIND_PARAMS / COLUMNS_PER_ROW);

interface Options {
  count: number;
  start: number;
  batch: number;
  concurrency: number;
  seed: number;
  truncate: boolean;
  skuPrefix: string;
}

function readFlag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match?.slice(name.length + 3);
}

function readNumber(name: string, fallback: number): number {
  const raw = readFlag(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative number (got "${raw}").`);
  }
  return Math.floor(value);
}

function parseOptions(): Options {
  const poolMax = getPool().options.max ?? 10;

  const batch = readNumber("batch", 1_000);
  if (batch < 1 || batch > MAX_BATCH) {
    throw new Error(
      `--batch must be between 1 and ${MAX_BATCH} — Postgres allows ${MAX_BIND_PARAMS} bind parameters per statement and each row uses ${COLUMNS_PER_ROW}.`,
    );
  }

  // More in-flight batches than pool clients just queues them inside pg. It is
  // harmless, but it looks like tuning while doing nothing, so say so.
  const requested = readNumber("concurrency", Math.min(8, poolMax));
  const concurrency = Math.max(1, Math.min(requested, poolMax));
  if (requested > poolMax) {
    console.warn(
      `[seed:products] --concurrency=${requested} capped to ${poolMax} (DATABASE_POOL_MAX).`,
    );
  }

  const skuPrefix = (readFlag("sku-prefix") ?? "SEED").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(skuPrefix)) {
    throw new Error(
      "--sku-prefix must be uppercase letters, digits and hyphens (it has to satisfy the product SKU rule).",
    );
  }

  return {
    count: readNumber("count", 1_000_000),
    start: readNumber("start", 0),
    batch,
    concurrency,
    seed: readNumber("seed", 1337),
    truncate: process.argv.includes("--truncate"),
    skuPrefix,
  };
}

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

/**
 * Seeded PRNG (mulberry32). `Math.random()` would work, but a fixed seed means
 * two runs produce byte-identical rows — which is what makes this usable as a
 * benchmark fixture and not just filler.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const ADJECTIVES = [
  "Compact",
  "Rugged",
  "Matte",
  "Brushed",
  "Featherweight",
  "Reinforced",
  "Modular",
  "Insulated",
  "Foldable",
  "Precision",
  "Heritage",
  "Anodised",
  "Weatherproof",
  "Ultra-Slim",
  "Ergonomic",
  "Vintage",
] as const;

const MATERIALS = [
  "Walnut",
  "Aluminium",
  "Canvas",
  "Ceramic",
  "Titanium",
  "Bamboo",
  "Leather",
  "Merino",
  "Carbon",
  "Linen",
  "Copper",
  "Recycled PET",
] as const;

const NOUNS = [
  "Desk Lamp",
  "Travel Mug",
  "Notebook",
  "Backpack",
  "Keyboard",
  "Monitor Arm",
  "Chair Mat",
  "Cable Kit",
  "Wall Clock",
  "Storage Crate",
  "Pour-Over Kettle",
  "Field Jacket",
  "Dock",
  "Stand",
  "Toolroll",
  "Planter",
] as const;

const SERIES = [
  "Mk I",
  "Mk II",
  "Mk III",
  "Studio",
  "Pro",
  "Lite",
  "XL",
  "Mini",
] as const;

const OPENERS = [
  "Built for daily use and tested well past it.",
  "A quiet redesign of something you already own.",
  "Ships flat, assembles in under a minute.",
  "Made in small runs, restocked twice a year.",
  "The version we kept after eleven prototypes.",
  "Sized to disappear into a carry-on.",
] as const;

const CLOSERS = [
  "Backed by a two-year warranty.",
  "Spare parts sold separately.",
  "Free returns within 30 days.",
  "Cleans up with a damp cloth.",
  "Certified carbon-neutral shipping.",
  "Discontinued colours are marked final sale.",
] as const;

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)]!;
}

/** Two years of history, so `created_at` sorting and pagination have something to chew on. */
const WINDOW_MS = 730 * 24 * 60 * 60 * 1000;
const WINDOW_END = Date.UTC(2026, 7, 5);

/**
 * Builds one batch. `index` is the global row number: it drives the SKU, which
 * is what makes the whole run idempotent.
 */
function buildBatch(
  from: number,
  size: number,
  options: Options,
): NewProductRow[] {
  const rows: NewProductRow[] = new Array(size);

  for (let offset = 0; offset < size; offset += 1) {
    const index = from + offset;
    // Seeding per row (rather than one stream for the run) keeps a row's
    // contents independent of the batch boundaries it happened to fall on.
    const random = makeRandom(options.seed + index);

    const createdAt = new Date(WINDOW_END - Math.floor(random() * WINDOW_MS));
    // Roughly a third of rows have been touched since creation.
    const updatedAt =
      random() < 0.34
        ? new Date(
            createdAt.getTime() +
              Math.floor(random() * (WINDOW_END - createdAt.getTime())),
          )
        : createdAt;

    rows[offset] = {
      id: newId(),
      sku: `${options.skuPrefix}-${String(index + 1).padStart(8, "0")}`,
      name: `${pick(ADJECTIVES, random)} ${pick(MATERIALS, random)} ${pick(NOUNS, random)} ${pick(SERIES, random)}`,
      // One in twelve products has no description — the list and detail views
      // should be exercised against nullable columns too.
      description:
        random() < 0.92
          ? `${pick(OPENERS, random)} ${pick(CLOSERS, random)}`
          : null,
      priceCents: 500 + Math.floor(random() * 249_500),
      archived: random() < 0.12,
      createdAt,
      updatedAt,
    };
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

async function insertBatch(rows: NewProductRow[]): Promise<void> {
  await db
    .insert(products)
    .values(rows)
    // Makes the script re-runnable: the same flags regenerate the same SKUs,
    // and the unique index turns the second run into a no-op instead of an
    // error halfway through.
    .onConflictDoNothing({ target: products.sku });
}

/**
 * Fixed-size worker pool over the batch list.
 *
 * `Promise.all(batches.map(insert))` would open a thousand statements at once
 * and let pg queue every one of them; the pool keeps exactly `concurrency`
 * inserts in flight, which is the number of pool clients that can actually be
 * doing work.
 */
async function runPool(
  totalBatches: number,
  concurrency: number,
  worker: (batchIndex: number) => Promise<void>,
): Promise<void> {
  let next = 0;

  // Safe without a lock: nothing awaits between reading and incrementing, and
  // the event loop is single-threaded.
  async function drain(): Promise<void> {
    while (next < totalBatches) {
      const batchIndex = next;
      next += 1;
      await worker(batchIndex);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, drain));
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function createReporter(total: number, startedAt: number) {
  const interactive = process.stdout.isTTY;
  let done = 0;
  let lastPrintedAt = 0;

  return {
    advance(rows: number) {
      done += rows;
      const now = Date.now();
      const finished = done >= total;
      // Repainting on every batch is most of the cost of a fast loop.
      if (!finished && now - lastPrintedAt < 500) return;
      lastPrintedAt = now;

      const elapsed = now - startedAt;
      const rate = done / (elapsed / 1000);
      const remaining = rate > 0 ? ((total - done) / rate) * 1000 : 0;
      const percent = ((done / total) * 100).toFixed(1);
      const line = `[seed:products] ${done.toLocaleString()}/${total.toLocaleString()} (${percent}%) · ${Math.round(rate).toLocaleString()} rows/s · eta ${formatDuration(remaining)}`;

      if (interactive) {
        process.stdout.write(`\r${line.padEnd(96)}`);
        if (finished) process.stdout.write("\n");
      } else {
        console.log(line);
      }
    },
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const options = parseOptions();

  if (options.count === 0) {
    console.log("[seed:products] --count=0, nothing to do.");
    return;
  }

  if (options.truncate) {
    if (isProduction) {
      throw new Error(
        "--truncate refuses to run with NODE_ENV=production. Delete the rows deliberately if that is really what you want.",
      );
    }
    // TRUNCATE over DELETE: it reclaims the space and resets the indexes in one
    // pass instead of writing 1M dead tuples for autovacuum to clean up later.
    await getPool().query("TRUNCATE TABLE products");
    console.log("[seed:products] truncated products");
  }

  const totalBatches = Math.ceil(options.count / options.batch);
  console.log(
    `[seed:products] inserting ${options.count.toLocaleString()} rows · ` +
      `batch ${options.batch} · concurrency ${options.concurrency} · ` +
      `sku ${options.skuPrefix}-${String(options.start + 1).padStart(8, "0")}…`,
  );

  const startedAt = Date.now();
  const reporter = createReporter(options.count, startedAt);

  await runPool(totalBatches, options.concurrency, async (batchIndex) => {
    const from = options.start + batchIndex * options.batch;
    const size = Math.min(
      options.batch,
      options.count - batchIndex * options.batch,
    );
    await insertBatch(buildBatch(from, size, options));
    reporter.advance(size);
  });

  const elapsed = Date.now() - startedAt;
  // `count(*)` returns bigint, which pg hands back as a string — cast in SQL so
  // the value never round-trips through a lossy Number on the way here.
  const totals = await getPool().query<{ count: string }>(
    "SELECT count(*)::text AS count FROM products",
  );
  const total = totals.rows[0]?.count ?? "0";

  console.log(
    `[seed:products] done in ${formatDuration(elapsed)} · ` +
      `${Math.round(options.count / (elapsed / 1000)).toLocaleString()} rows/s · ` +
      `${Number(total).toLocaleString()} products in the table`,
  );
}

main()
  .catch((error) => {
    console.error("\n[seed:products] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    process.exit(process.exitCode ?? 0);
  });

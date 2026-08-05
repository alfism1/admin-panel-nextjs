-- `gin_trgm_ops` below is not a built-in operator class; without this the two
-- CREATE INDEX statements fail with "operator class does not exist".
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- These build in one pass over the table and hold a write lock while they do
-- (measured: ~40s and ~20s respectively at 7M rows). Reads are unaffected. If
-- that is too long a write pause, run the same two statements by hand with
-- CREATE INDEX CONCURRENTLY *outside* a migration — drizzle wraps migrations in
-- a transaction, and CONCURRENTLY cannot run inside one.
CREATE INDEX IF NOT EXISTS "products_sku_trgm_idx" ON "products" USING gin ("sku" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
-- The search predicate no longer touches `description`; see the repository.
-- Dropping this reclaims ~500MB at 7M rows. IF EXISTS because it was only ever
-- created by hand while benchmarking.
DROP INDEX IF EXISTS "products_description_trgm_idx";

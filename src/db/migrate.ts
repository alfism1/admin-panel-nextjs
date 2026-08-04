import "dotenv/config";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { closeDatabase, db } from "./client";

/**
 * Applies every pending migration in `drizzle/`, then exits.
 *
 * Run with `pnpm db:migrate`. This is the deploy-time entry point — never call
 * `drizzle-kit push` against an environment you care about, it diffs and
 * rewrites rather than replaying reviewed migrations.
 */
async function main() {
  console.log("[migrate] applying migrations from ./drizzle …");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] up to date");
}

main()
  .catch((error) => {
    console.error("[migrate] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    process.exit(process.exitCode ?? 0);
  });

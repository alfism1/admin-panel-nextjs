/**
 * Stand-in for the `server-only` package under Vitest.
 *
 * The real package's default entry throws on import — that is its whole job, a
 * build-time tripwire against pulling server code into a client bundle. Next
 * resolves it to a no-op through the `react-server` export condition; Vitest
 * has no such condition, so the alias in `vitest.config.mts` points here
 * instead. Aliasing rather than disabling keeps the tripwire armed everywhere
 * that matters.
 */
export {};

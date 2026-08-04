import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

/**
 * Every Better-Auth endpoint — sign-in/up, OAuth callbacks, verification,
 * two-factor, and the `admin` plugin's user/session management — is served from
 * this one catch-all handler.
 *
 * `nodejs` runtime: the handler reaches Postgres through `pg`, which needs
 * Node's net module.
 */
export const runtime = "nodejs";

export const { GET, POST } = toNextJsHandler(auth.handler);

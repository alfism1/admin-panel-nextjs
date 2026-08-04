import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import pino, { type Logger } from "pino";

import { env, isProduction } from "@/lib/env";

/**
 * Structured logging.
 *
 * Production emits newline-delimited JSON (ready for any log shipper); dev
 * pipes through pino-pretty. Request ids are propagated with AsyncLocalStorage
 * so every log line inside a request can be correlated without threading a
 * logger through every function signature.
 */

const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: [
      "password",
      "newPassword",
      "currentPassword",
      "token",
      "secret",
      "authorization",
      "cookie",
      "*.password",
      "*.token",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[redacted]",
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l" },
        },
      }),
});

export const REQUEST_ID_HEADER = "x-request-id";

/** Runs `fn` with a request id bound to the async context. */
export function withRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function newRequestId(): string {
  return randomUUID();
}

/**
 * A logger bound to the current request id (when there is one) plus any extra
 * fields. Use this in services rather than the bare `logger`.
 */
export function getLogger(bindings: Record<string, unknown> = {}): Logger {
  const requestId = getRequestId();
  return logger.child(requestId ? { requestId, ...bindings } : bindings);
}

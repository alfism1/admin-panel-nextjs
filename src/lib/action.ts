import "server-only";

import { ZodError } from "zod";

import { ValidationError, isAppError, type AppErrorCode } from "@/lib/errors";
import { getLogger } from "@/lib/logger";

/**
 * Server Action result envelope.
 *
 * Actions return a discriminated union instead of throwing, because a thrown
 * error in a Server Action reaches the client as an opaque digest — useless for
 * showing "that e-mail is already taken" next to a field. Genuine bugs still
 * throw and hit `error.tsx`; expected failures come back as data.
 */
export type ActionResult<TData = void> =
  | { ok: true; data: TData }
  | {
      ok: false;
      code: AppErrorCode;
      message: string;
      /** Field-level messages, ready for `form.setError`. */
      fieldErrors?: Record<string, string[]>;
    };

export function actionOk(): ActionResult<void>;
export function actionOk<TData>(data: TData): ActionResult<TData>;
export function actionOk<TData>(data?: TData): ActionResult<TData | void> {
  return { ok: true, data: data as TData };
}

/**
 * Wraps a Server Action body: runs it, and converts anything it throws into an
 * `ActionResult`.
 *
 * Zod errors become field errors. `AppError`s keep their code and message —
 * they were written to be read by a user. Everything else collapses to a
 * generic message, because an unexpected error's text may contain a query, a
 * path, or a hostname.
 */
export async function withAction<TData>(
  name: string,
  run: () => Promise<TData>,
): Promise<ActionResult<TData>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    const log = getLogger({ action: name });

    if (error instanceof ZodError) {
      return {
        ok: false,
        code: "VALIDATION",
        message: "Some fields need attention.",
        fieldErrors: flattenZodError(error),
      };
    }

    if (error instanceof ValidationError) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
      };
    }

    if (isAppError(error)) {
      // Expected: authorization failures, conflicts, missing rows.
      log.info({ code: error.code, msg: error.message }, "action rejected");
      return { ok: false, code: error.code, message: error.message };
    }

    log.error({ err: error }, "action failed unexpectedly");
    return {
      ok: false,
      code: "INTERNAL",
      message: "Something went wrong. Please try again.",
    };
  }
}

function flattenZodError(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_form";
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message];
  }
  return fieldErrors;
}

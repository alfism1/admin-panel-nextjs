/**
 * Typed application errors.
 *
 * Services and repositories throw these; the transport layer (Route Handlers,
 * Server Actions, error boundaries) maps them to HTTP status codes or UI.
 * Anything that isn't an `AppError` is treated as an unexpected 500 and its
 * message is never leaked to the client.
 */

export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "INTERNAL";

export abstract class AppError extends Error {
  abstract readonly code: AppErrorCode;
  abstract readonly status: number;

  /** Whether `message` is safe to show to an end user. */
  readonly expose: boolean = true;

  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export class BadRequestError extends AppError {
  readonly code = "BAD_REQUEST" as const;
  readonly status = 400;
}

export class UnauthorizedError extends AppError {
  readonly code = "UNAUTHORIZED" as const;
  readonly status = 401;

  constructor(message = "You must be signed in to do that.") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly code = "FORBIDDEN" as const;
  readonly status = 403;

  constructor(
    message = "You do not have permission to perform this action.",
    details?: { resource?: string; action?: string },
  ) {
    super(message, details);
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;

  constructor(resource = "Resource", id?: string) {
    super(id ? `${resource} "${id}" was not found.` : `${resource} not found.`);
  }
}

export class ConflictError extends AppError {
  readonly code = "CONFLICT" as const;
  readonly status = 409;
}

/** Field-level failures, shaped for direct consumption by react-hook-form. */
export class ValidationError extends AppError {
  readonly code = "VALIDATION" as const;
  readonly status = 422;

  constructor(
    message = "Some fields are invalid.",
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message, { fieldErrors });
  }
}

export class RateLimitError extends AppError {
  readonly code = "RATE_LIMITED" as const;
  readonly status = 429;

  constructor(
    message = "Too many requests. Please slow down.",
    readonly retryAfterSeconds?: number,
  ) {
    super(message, { retryAfterSeconds });
  }
}

export class InternalError extends AppError {
  readonly code = "INTERNAL" as const;
  readonly status = 500;
  override readonly expose = false;

  constructor(message = "Something went wrong.") {
    super(message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Normalises any thrown value into an `AppError`. Unknown errors collapse into
 * `InternalError` so their message never reaches the client.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return new InternalError();
}

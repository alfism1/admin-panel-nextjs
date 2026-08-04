import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { isAppError, UnauthorizedError } from "@/lib/errors";
import {
  REQUEST_ID_HEADER,
  getLogger,
  newRequestId,
  withRequestId,
} from "@/lib/logger";
import type { ActionFor, Resource } from "@/lib/permissions";
import { requirePermission } from "@/modules/rbac/permissions.service";
import type { Authorization } from "@/modules/rbac/permissions.service";

/**
 * Route Handler wrapper.
 *
 * Default-deny: `withApiHandler` **requires** a permission. There is no
 * "public" variant — a route that should be reachable without auth (like
 * `/api/health`) is written without this wrapper, so the decision is visible in
 * the diff rather than hidden in an options object.
 *
 * Also owns request-id propagation and error → status mapping, so no handler
 * has to remember either.
 */

interface HandlerContext {
  authorization: Authorization;
  requestId: string;
}

export function withApiHandler<R extends Resource>(
  resource: R,
  action: ActionFor<R>,
  handler: (
    request: Request,
    context: HandlerContext,
  ) => Promise<Response> | Response,
) {
  return async function route(request: Request): Promise<Response> {
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();

    return withRequestId(requestId, async () => {
      const log = getLogger({
        method: request.method,
        path: new URL(request.url).pathname,
      });

      try {
        const authorization = await requirePermission(resource, action);
        const response = await handler(request, { authorization, requestId });
        response.headers.set(REQUEST_ID_HEADER, requestId);
        return response;
      } catch (error) {
        return toErrorResponse(error, requestId, log);
      }
    });
  };
}

type Logger = ReturnType<typeof getLogger>;

function toErrorResponse(
  error: unknown,
  requestId: string,
  log: Logger,
): NextResponse {
  const headers = { [REQUEST_ID_HEADER]: requestId };

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION",
          message: "Invalid request.",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 422, headers },
    );
  }

  if (isAppError(error)) {
    if (error.status >= 500) {
      log.error({ err: error }, "request failed");
    } else {
      log.info({ code: error.code }, "request rejected");
    }

    return NextResponse.json(
      error.expose
        ? error.toJSON()
        : { error: { code: error.code, message: "Something went wrong." } },
      { status: error.status, headers },
    );
  }

  log.error({ err: error }, "unhandled error in route handler");
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong." } },
    { status: 500, headers },
  );
}

/** For handlers outside `withApiHandler` that still need consistent errors. */
export function apiError(error: unknown, requestId = newRequestId()) {
  return toErrorResponse(error, requestId, getLogger());
}

export { UnauthorizedError };

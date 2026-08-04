import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { REQUEST_ID_HEADER, newRequestId } from "@/lib/logger";
import { evaluateFlagsSchema } from "@/modules/feature-flags/feature-flag.schema";
import { featureFlagService } from "@/modules/feature-flags/feature-flag.service";
import { getAuthorization } from "@/modules/rbac/permissions.service";

/**
 * Flag evaluation for the browser — what `useFeatureFlag()` calls.
 *
 * Deliberately **not** wrapped in `withApiHandler`: it needs no permission,
 * because asking "is this flag on for me?" is something every signed-in user
 * does implicitly on every page. What it must never do is let a caller ask on
 * someone else's behalf, so the evaluation context comes from the session and
 * is never read from the request body.
 *
 * A signed-out caller gets every flag evaluated with no user id, which means
 * percentage rollouts resolve to `false`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();

  try {
    const { keys } = evaluateFlagsSchema.parse(await request.json());

    const authorization = await getAuthorization();
    const flags = await featureFlagService.evaluateMany(keys, {
      userId: authorization?.user.id ?? null,
      roleKeys: authorization?.roleKeys ?? [],
    });

    return NextResponse.json(
      { data: flags },
      {
        headers: {
          [REQUEST_ID_HEADER]: requestId,
          // Per-user answers must never land in a shared cache.
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return apiError(error, requestId);
  }
}

import { NextResponse } from "next/server";

import { withApiHandler } from "@/lib/api";
import { usersService } from "@/modules/users/users.service";

/**
 * REST view of the Users module.
 *
 * Exists alongside the Server Actions the dashboard uses, for integrations and
 * scripts that need HTTP semantics. Both funnel into the same service, so
 * authorization, validation and auditing are identical either way.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiHandler("user", "read", async (request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { rows, total } = await usersService.list(params);
  return NextResponse.json({ data: rows, meta: { total } });
});

export const POST = withApiHandler("user", "create", async (request) => {
  const user = await usersService.create(await request.json());
  return NextResponse.json({ data: user }, { status: 201 });
});

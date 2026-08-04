import { NextResponse } from "next/server";

import { withApiHandler } from "@/lib/api";
import { featureFlagService } from "@/modules/feature-flags/feature-flag.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiHandler("featureFlag", "read", async (request) => {
  const search = new URL(request.url).searchParams.get("search") ?? "";
  const flags = await featureFlagService.list(search);
  return NextResponse.json({ data: flags });
});

export const POST = withApiHandler("featureFlag", "create", async (request) => {
  const flag = await featureFlagService.create(await request.json());
  return NextResponse.json({ data: flag }, { status: 201 });
});

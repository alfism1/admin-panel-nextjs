import { NextResponse } from "next/server";

import { withApiHandler } from "@/lib/api";
import { auditLogService } from "@/modules/audit-log/audit-log.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiHandler("auditLog", "read", async (request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { rows, total } = await auditLogService.list(params);
  return NextResponse.json({ data: rows, meta: { total } });
});

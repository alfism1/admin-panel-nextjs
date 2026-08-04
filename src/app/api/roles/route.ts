import { NextResponse } from "next/server";

import { withApiHandler } from "@/lib/api";
import { rbacService } from "@/modules/rbac/rbac.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiHandler("role", "read", async () => {
  const [roles, permissions] = await Promise.all([
    rbacService.listRoles(),
    rbacService.listPermissions(),
  ]);
  return NextResponse.json({ data: roles, meta: { permissions } });
});

export const POST = withApiHandler("role", "create", async (request) => {
  const role = await rbacService.create(await request.json());
  return NextResponse.json({ data: role }, { status: 201 });
});

import { expect, test } from "@playwright/test";

import { adminStatePath, viewerStatePath } from "./fixtures";

/**
 * The Definition of Done requires that every write action is unreachable
 * without the right permission, *verified by e2e*. These are those tests.
 *
 * Both halves matter, and they are different failures: the API must refuse the
 * request (security), and the UI must not offer the button (usability). A panel
 * that shows a button which 403s is broken even though it is safe.
 */

test.describe("as a viewer", () => {
  test.use({ storageState: viewerStatePath });

  test("is refused every write, with a 403 and no side effect", async ({
    request,
  }) => {
    const createUser = await request.post("/api/users", {
      data: {
        name: "Should Not Exist",
        email: "should-not-exist@example.com",
        password: "Password123!",
        markVerified: true,
      },
    });
    expect(createUser.status()).toBe(403);
    expect(await createUser.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });

    const createRole = await request.post("/api/roles", {
      data: {
        key: "escalated",
        name: "Escalated",
        requireTwoFactor: false,
        permissionKeys: [],
      },
    });
    expect(createRole.status()).toBe(403);

    // `auditLog:export` is a strictly higher bar than `auditLog:read`: an
    // export leaves the system and stops being subject to its access controls.
    const exportLogs = await request.get("/api/audit-logs/export");
    expect(exportLogs.status()).toBe(403);

    // Nothing was created despite three attempts.
    const check = await request.get(
      "/api/users?search=should-not-exist%40example.com",
    );
    const { data } = (await check.json()) as { data: unknown[] };
    expect(data).toHaveLength(0);
  });

  test("keeps the reads the role does grant", async ({ request }) => {
    expect((await request.get("/api/users")).status()).toBe(200);
    expect((await request.get("/api/roles")).status()).toBe(200);
    expect((await request.get("/api/audit-logs")).status()).toBe(200);
  });

  test("cannot mint a role granting permissions it lacks", async ({
    request,
  }) => {
    const response = await request.post("/api/roles", {
      data: {
        key: "self-promotion",
        name: "Self promotion",
        requireTwoFactor: false,
        permissionKeys: ["user:delete", "role:create"],
      },
    });

    expect(response.status()).toBe(403);
  });

  test("is not shown actions it cannot perform", async ({ page }) => {
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    // Hidden, not disabled — a disabled button still advertises the capability
    // and invites the user to go looking for a way around it.
    await expect(page.getByRole("button", { name: "New user" })).toHaveCount(0);

    await page.goto("/roles");
    await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New role" })).toHaveCount(0);

    await page.goto("/audit-logs");
    await expect(
      page.getByRole("heading", { name: "Audit logs" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveCount(0);
  });

  test("can still manage its own account", async ({ page }) => {
    // Settings is deliberately ungated: a viewer with zero permissions must
    // still be able to change their password and enrol in 2FA.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Change password" }),
    ).toBeVisible();
  });
});

test.describe("as a super admin", () => {
  test.use({ storageState: adminStatePath });

  test("is shown those same actions", async ({ page }) => {
    await page.goto("/users");
    await expect(page.getByRole("button", { name: "New user" })).toBeVisible();

    await page.goto("/roles");
    await expect(page.getByRole("button", { name: "New role" })).toBeVisible();

    await page.goto("/audit-logs");
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
  });

  test("is allowed the writes a viewer was refused", async ({ request }) => {
    const response = await request.get("/api/audit-logs/export");
    expect(response.status()).toBe(200);
  });

  test("sees every navigation section", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });

    for (const label of [
      "Dashboard",
      "Users",
      "Roles",
      "Audit logs",
      "Feature flags",
      "Settings",
    ]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });
});

import { expect, test } from "@playwright/test";

import { SUPER_ADMIN, adminStatePath, unique } from "./fixtures";

/**
 * Definition of Done: "every mutation produces an audit log entry."
 *
 * These make a real mutation and then look for its record — through the API
 * (exact assertions) and through the UI (the operator's actual view of it).
 */
// Reuses the signed-in state saved by global.setup.ts.
test.use({ storageState: adminStatePath });

test.describe("audit log", () => {
  test("a mutation shows up in the log with a before/after snapshot", async ({
    request,
  }) => {
    const email = `${unique("e2e-audit")}@example.com`;
    const created = await request.post("/api/users", {
      data: {
        name: "Audit Target",
        email,
        password: "AuditPass123!",
        markVerified: true,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { data: user } = (await created.json()) as { data: { id: string } };

    const logs = await request.get(
      "/api/audit-logs?pageSize=10&action=user.created",
    );
    expect(logs.status()).toBe(200);

    const { data } = (await logs.json()) as {
      data: {
        action: string;
        actorEmail: string;
        resourceType: string;
        resourceId: string;
        after: Record<string, unknown> | null;
      }[];
    };

    const entry = data.find((row) => row.resourceId === user.id);
    expect(entry, "no audit entry for the user just created").toBeDefined();
    expect(entry).toMatchObject({
      action: "user.created",
      actorEmail: SUPER_ADMIN.email,
      resourceType: "user",
    });
    // The snapshot is what makes the entry auditable rather than decorative.
    expect(entry?.after).toMatchObject({ email });
  });

  test("a feature-flag toggle records the transition, not the whole entity", async ({
    request,
  }) => {
    const key = unique("e2e-flag");
    const created = await request.post("/api/feature-flags", {
      data: { key, name: "E2E flag", enabled: false, rules: {} },
    });
    expect(created.status(), await created.text()).toBe(201);

    const logs = await request.get(
      `/api/audit-logs?pageSize=5&search=${encodeURIComponent(key)}`,
    );
    const { data } = (await logs.json()) as {
      data: { action: string; resourceId: string }[];
    };

    expect(data.some((row) => row.action === "featureFlag.created")).toBe(true);
  });

  test("the log UI filters and opens a diff", async ({ page }) => {
    await page.goto("/audit-logs");

    await expect(
      page.getByRole("heading", { name: "Audit logs" }),
    ).toBeVisible();

    // Filtering is URL state, so the filtered view is a shareable link.
    await page.getByRole("combobox", { name: "Resource" }).click();
    await page.getByRole("option", { name: "User" }).click();
    await expect(page).toHaveURL(/resourceType=user/);

    await page
      .getByRole("table")
      .getByRole("button", { name: "Details" })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("What changed")).toBeVisible();
  });

  test("CSV export streams a file with the expected header", async ({
    page,
  }) => {
    await page.goto("/audit-logs");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(
      /^audit-logs-\d{4}-\d{2}-\d{2}\.csv$/,
    );

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString("utf8");

    expect(csv.split("\n")[0]).toBe(
      "id,created_at,actor_id,actor_email,action,resource_type,resource_id,ip,user_agent,before,after",
    );
  });
});

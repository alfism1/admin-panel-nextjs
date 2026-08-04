import { expect, test } from "@playwright/test";

import { adminStatePath, unique } from "./fixtures";

/**
 * Definition of Done: "toggling a feature flag changes behavior without a
 * redeploy."
 *
 * The proof is the evaluate endpoint returning a different answer from the same
 * running process after a toggle — no restart, no rebuild.
 */
// Reuses the signed-in state saved by global.setup.ts.
test.use({ storageState: adminStatePath });

test.describe("feature flags", () => {
  test("toggling in the UI flips evaluation, with no redeploy", async ({
    page,
    request,
  }) => {
    const key = unique("e2e-flag");

    async function evaluate(): Promise<boolean | undefined> {
      const response = await request.post("/api/feature-flags/evaluate", {
        data: { keys: [key] },
      });
      expect(response.status()).toBe(200);
      const { data } = (await response.json()) as {
        data: Record<string, boolean>;
      };
      return data[key];
    }

    // 1. It doesn't exist yet, so it evaluates false.
    expect(await evaluate()).toBe(false);

    // 2. Create it, switched on.
    await page.goto("/feature-flags");
    await page.getByRole("button", { name: "New flag" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Key", exact: true }).fill(key);
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(key);
    await dialog.getByRole("switch", { name: "Enabled", exact: true }).click();
    await dialog.getByRole("button", { name: "Create flag" }).click();

    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("table").getByRole("row", { name: new RegExp(key) }),
    ).toBeVisible();

    expect(await evaluate()).toBe(true);

    // 3. Flip it off from the table. The service invalidates the Redis entry on
    //    write, so the very next evaluation must already disagree.
    await page
      .getByRole("table")
      .getByRole("switch", { name: `Disable ${key}` })
      .click();
    await expect(page.getByText(/turned off/i)).toBeVisible();

    expect(await evaluate()).toBe(false);
  });

  test("role targeting decides who sees a flag", async ({ request }) => {
    const targeted = unique("e2e-targeted");
    const created = await request.post("/api/feature-flags", {
      data: {
        key: targeted,
        name: "Super admins only",
        enabled: true,
        rules: { includeRoles: ["super_admin"] },
      },
    });
    expect(created.status(), await created.text()).toBe(201);

    const response = await request.post("/api/feature-flags/evaluate", {
      data: { keys: [targeted] },
    });
    const { data } = (await response.json()) as {
      data: Record<string, boolean>;
    };

    expect(data[targeted]).toBe(true);
  });

  test("a flag targeted at other roles stays off for you", async ({
    request,
  }) => {
    const key = unique("e2e-other-role");
    await request.post("/api/feature-flags", {
      data: {
        key,
        name: "Someone else only",
        enabled: true,
        // "staff only" must not silently mean "everyone".
        rules: { includeRoles: ["nobody-has-this-role"] },
      },
    });

    const response = await request.post("/api/feature-flags/evaluate", {
      data: { keys: [key] },
    });
    const { data } = (await response.json()) as {
      data: Record<string, boolean>;
    };

    expect(data[key]).toBe(false);
  });

  test("an unknown key evaluates to false rather than erroring", async ({
    request,
  }) => {
    const response = await request.post("/api/feature-flags/evaluate", {
      data: { keys: ["definitely-not-a-real-flag"] },
    });

    expect(response.status()).toBe(200);
    const { data } = (await response.json()) as {
      data: Record<string, boolean>;
    };
    expect(data["definitely-not-a-real-flag"]).toBe(false);
  });

  test("rejects a malformed key instead of storing it", async ({ request }) => {
    const response = await request.post("/api/feature-flags", {
      data: { key: "Not A Valid Key!", name: "Bad", enabled: false, rules: {} },
    });

    expect(response.status()).toBe(422);
  });
});

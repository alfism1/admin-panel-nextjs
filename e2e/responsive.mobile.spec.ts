import { expect, test, type Page } from "@playwright/test";

import { SUPER_ADMIN, adminStatePath } from "./fixtures";

/**
 * Runs in the `mobile` Playwright project (iPhone SE, 375px).
 *
 * The Definition of Done says "every screen is usable at 375px — no horizontal
 * scroll, sidebar collapses correctly". Horizontal overflow is the failure mode
 * that slips through code review every time, so it is asserted numerically
 * rather than eyeballed.
 */

const DASHBOARD_ROUTES = [
  "/",
  "/users",
  "/roles",
  "/audit-logs",
  "/feature-flags",
  "/settings",
];

const AUTH_ROUTES = ["/sign-in", "/sign-up", "/forgot-password"];

async function expectNoHorizontalScroll(page: Page, route: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(
    overflow.scrollWidth,
    `${route} scrolls horizontally at 375px (${overflow.scrollWidth}px content in a ${overflow.clientWidth}px viewport)`,
    // 1px of tolerance for sub-pixel rounding on fractional borders.
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

// Reuses the signed-in state saved by global.setup.ts.
test.use({ storageState: adminStatePath });

test.describe("375px layout", () => {
  test("auth screens fit the viewport", async ({ page }) => {
    for (const route of AUTH_ROUTES) {
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      await expectNoHorizontalScroll(page, route);
    }
  });

  test("every dashboard screen fits the viewport", async ({ page }) => {
    for (const route of DASHBOARD_ROUTES) {
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      await expectNoHorizontalScroll(page, route);
    }
  });

  test("the sidebar is replaced by a drawer", async ({ page }) => {
    await page.goto("/");

    // The desktop rail must not merely be off-screen — that is what causes the
    // horizontal scroll it is supposed to avoid.
    await expect(page.locator("aside")).toBeHidden();

    const menuButton = page.getByRole("button", {
      name: "Open navigation menu",
    });
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Users" })).toBeVisible();

    // Escape closes it — Radix behaviour we depend on rather than reimplement.
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("navigating from the drawer closes it", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Roles" }).click();

    await expect(page).toHaveURL(/\/roles/);
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("the users table becomes cards instead of scrolling sideways", async ({
    page,
  }) => {
    // Search rather than trusting page 1: the list is newest-first and the
    // seeded admin is the oldest row in it.
    await page.goto(`/users?search=${encodeURIComponent(SUPER_ADMIN.email)}`);

    // A real layout swap: no `<table>` in the DOM at this width.
    await expect(page.locator("table")).toBeHidden();
    await expect(
      page.getByRole("listitem").getByText(SUPER_ADMIN.email),
    ).toBeVisible();
    await expectNoHorizontalScroll(page, "/users");
  });

  test("a dialog fits the viewport", async ({ page }) => {
    await page.goto("/users");

    await page.getByRole("button", { name: "New user" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoHorizontalScroll(page, "/users (dialog open)");
  });
});

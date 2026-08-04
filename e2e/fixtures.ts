import path from "node:path";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Shared helpers for the e2e suite.
 *
 * Credentials come from the same env vars the seed reads, so a fork that
 * changes them doesn't have to touch the tests.
 */

/**
 * Signed-in browser states written by `global.setup.ts` and reused by every
 * spec that isn't exercising the sign-in flow itself.
 */
export const adminStatePath = path.join(
  ".playwright",
  "state",
  "super-admin.json",
);
export const viewerStatePath = path.join(".playwright", "state", "viewer.json");

export const SUPER_ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com",
  password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!",
};

/** Created by `global.setup.ts` so RBAC denial can be tested against a real role. */
export const VIEWER = {
  email: "e2e-viewer@example.com",
  password: "ViewerPass123!",
  name: "E2E Viewer",
};

export async function signIn(
  page: Page,
  credentials: { email: string; password: string },
) {
  await page.goto("/sign-in");
  await page
    .getByRole("textbox", { name: "E-mail", exact: true })
    .fill(credentials.email);
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The dashboard heading is the first thing that only renders post-auth.
  await expect(
    page.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: /Account menu/ }).click();
  // Wait for the menu itself before reaching for an item: the click can land
  // while the post-sign-in refresh is still settling, and Radix then drops it.
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

/** Signs in over the API and returns a request context carrying the cookies. */
export async function apiSignIn(
  request: APIRequestContext,
  credentials: { email: string; password: string },
): Promise<void> {
  const response = await request.post("/api/auth/sign-in/email", {
    data: { email: credentials.email, password: credentials.password },
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** A value unique to this run, so re-running the suite never collides. */
export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

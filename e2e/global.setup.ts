import { expect, test as setup } from "@playwright/test";

import {
  SUPER_ADMIN,
  VIEWER,
  adminStatePath,
  apiSignIn,
  signIn,
  viewerStatePath,
} from "./fixtures";

/**
 * Runs once before the suite.
 *
 * Creates the read-only account the RBAC tests need, then saves a signed-in
 * storage state for each role. Every spec that isn't testing the sign-in flow
 * itself reuses those states, which keeps the whole run to two real sign-ins —
 * both faster and clear of the credential rate limiter, which is deliberately
 * tight.
 *
 * Idempotent: a second run finds the account already there, so the suite can be
 * re-run against the same database without a reset.
 */

setup("create the viewer account", async ({ request }) => {
  await apiSignIn(request, SUPER_ADMIN);

  const existing = await request.get(
    `/api/users?search=${encodeURIComponent(VIEWER.email)}`,
  );
  expect(existing.status(), await existing.text()).toBe(200);
  const { data } = (await existing.json()) as { data: { email: string }[] };

  if (data.some((user) => user.email === VIEWER.email)) return;

  const created = await request.post("/api/users", {
    data: {
      name: VIEWER.name,
      email: VIEWER.email,
      password: VIEWER.password,
      role: "viewer",
      markVerified: true,
    },
  });

  expect(created.status(), await created.text()).toBe(201);
});

setup("save the super-admin session", async ({ page }) => {
  await signIn(page, SUPER_ADMIN);
  await page.context().storageState({ path: adminStatePath });
});

setup("save the viewer session", async ({ page }) => {
  await signIn(page, VIEWER);
  await page.context().storageState({ path: viewerStatePath });
});

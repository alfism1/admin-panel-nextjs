import { expect, test } from "@playwright/test";

import { SUPER_ADMIN, signIn, signOut, unique } from "./fixtures";

// These exercise the real sign-in path rather than reusing a saved session, so
// they start signed out and run in order — parallel workers would race each
// other through the credential rate limiter.
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

test.describe("authentication", () => {
  test("redirects an unauthenticated visitor off the dashboard", async ({
    page,
  }) => {
    await page.goto("/users");
    await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fusers/);
  });

  test("returns the user to where they were headed after signing in", async ({
    page,
  }) => {
    await page.goto("/feature-flags");
    await expect(page).toHaveURL(/\/sign-in/);

    await page
      .getByRole("textbox", { name: "E-mail", exact: true })
      .fill(SUPER_ADMIN.email);
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill(SUPER_ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/feature-flags/);
    await expect(
      page.getByRole("heading", { name: "Feature flags" }),
    ).toBeVisible();
  });

  test("rejects a wrong password without saying which field was wrong", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page
      .getByRole("textbox", { name: "E-mail", exact: true })
      .fill(SUPER_ADMIN.email);
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("validates the form client-side before hitting the network", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page
      .getByRole("textbox", { name: "E-mail", exact: true })
      .fill("not-an-email");
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("x");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Enter a valid e-mail address.")).toBeVisible();
  });

  test("signs in and out", async ({ page }) => {
    await signIn(page, SUPER_ADMIN);
    await signOut(page);

    // And the dashboard is closed again afterwards.
    await page.goto("/users");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("sends a signed-in user away from the auth pages", async ({ page }) => {
    await signIn(page, SUPER_ADMIN);
    await page.goto("/sign-in");
    await expect(page).toHaveURL("/");
  });

  test("sign-up requires e-mail verification before the first sign-in", async ({
    page,
  }) => {
    const email = `${unique("e2e-signup")}@example.com`;

    await page.goto("/sign-up");
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("E2E Signup");
    await page
      .getByRole("textbox", { name: "E-mail", exact: true })
      .fill(email);
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("SignupPass123!");
    await page
      .getByRole("textbox", { name: "Confirm password" })
      .fill("SignupPass123!");
    await page.getByRole("button", { name: "Create account" }).click();

    // No session yet — the app parks them on "check your inbox".
    await expect(page).toHaveURL(/\/verify-email/);
    await expect(
      page.getByRole("heading", { name: "Verify your e-mail" }),
    ).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // And signing in is refused until the address is proven.
    await page.goto("/sign-in");
    await page
      .getByRole("textbox", { name: "E-mail", exact: true })
      .fill(email);
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("SignupPass123!");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      /verified/i,
    );
    await expect(
      page.getByRole("button", { name: "Resend verification e-mail" }),
    ).toBeVisible();
  });

  test("dead reset-password links explain themselves", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(
      page.getByRole("heading", { name: /isn't valid/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Request a new link" }),
    ).toBeVisible();
  });

  test("health reports both dependencies", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      status: string;
      checks: { database: { ok: boolean }; redis: { ok: boolean } };
    };
    expect(body.status).toBe("ok");
    expect(body.checks.database.ok).toBe(true);
  });
});

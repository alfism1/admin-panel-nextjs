import { expect, test } from "@playwright/test";

import { SUPER_ADMIN, adminStatePath, unique } from "./fixtures";

/**
 * The Users module end to end, through the UI a real operator uses.
 */
// Reuses the signed-in state saved by global.setup.ts.
test.use({ storageState: adminStatePath });

test.describe("users", () => {
  /**
   * The DataTable renders the desktop table and the mobile card list side by
   * side, swapping them with CSS. Row assertions are therefore scoped to the
   * table, or they match twice and trip strict mode.
   */

  test("creates, edits, bans and unbans a user", async ({ page }) => {
    await page.goto("/users");

    // Unique per run: the suite is re-runnable against the same database, and
    // a fixed name collides with rows left by the previous run.
    const name = unique("Grace");
    const email = `${unique("e2e-user")}@example.com`;

    // --- create ---
    await page.getByRole("button", { name: "New user" }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(name);
    await createDialog
      .getByRole("textbox", { name: "E-mail", exact: true })
      .fill(email);
    await createDialog
      .getByRole("textbox", { name: "Temporary password" })
      .fill("TempPass123!");
    await createDialog.getByRole("button", { name: "Create user" }).click();

    await expect(createDialog).toBeHidden();
    const table = page.getByRole("table");
    await expect(table.getByText(email)).toBeVisible();

    // --- search finds them, and the filter is in the URL ---
    await page.getByRole("searchbox").fill(email);
    await expect(page).toHaveURL(new RegExp(`search=`));
    await expect(table.getByText(name)).toBeVisible();

    // --- edit ---
    await table.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Edit details" }).click();

    const editDialog = page.getByRole("dialog");
    await editDialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(`${name} B.`);
    await editDialog.getByRole("button", { name: "Save changes" }).click();

    await expect(editDialog).toBeHidden();
    await expect(table.getByText(`${name} B.`)).toBeVisible();

    // --- ban ---
    await table.getByRole("button", { name: `Actions for ${name} B.` }).click();
    await page.getByRole("menuitem", { name: "Ban user" }).click();

    const banDialog = page.getByRole("dialog");
    await banDialog
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("E2E test ban");
    await banDialog.getByRole("button", { name: "Ban user" }).click();

    await expect(banDialog).toBeHidden();
    await expect(table.getByText("banned")).toBeVisible();

    // --- unban ---
    await table.getByRole("button", { name: `Actions for ${name} B.` }).click();
    await page.getByRole("menuitem", { name: "Lift ban" }).click();
    await expect(page.getByText("unbanned").first()).toBeVisible();
  });

  test("assigns a role and the change is reflected immediately", async ({
    page,
  }) => {
    await page.goto("/users");

    const name = unique("Role Target");
    const email = `${unique("e2e-role")}@example.com`;

    await page.getByRole("button", { name: "New user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await dialog
      .getByRole("textbox", { name: "E-mail", exact: true })
      .fill(email);
    await dialog
      .getByRole("textbox", { name: "Temporary password" })
      .fill("TempPass123!");
    await dialog.getByRole("button", { name: "Create user" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("searchbox").fill(email);
    await expect(page.getByRole("table").getByText(name)).toBeVisible();

    await page
      .getByRole("table")
      .getByRole("button", { name: `Actions for ${name}` })
      .click();
    await page.getByRole("menuitem", { name: "Manage roles" }).click();

    const rolesDialog = page.getByRole("dialog");
    await rolesDialog.getByLabel("Viewer").check();
    await rolesDialog.getByRole("button", { name: "Save roles" }).click();

    await expect(rolesDialog).toBeHidden();
    await expect(
      page.getByRole("table").getByRole("row", { name: new RegExp(name) }),
    ).toContainText("Viewer");
  });

  test("refuses a duplicate e-mail with a readable message", async ({
    page,
  }) => {
    await page.goto("/users");

    await page.getByRole("button", { name: "New user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Duplicate");
    await dialog
      .getByRole("textbox", { name: "E-mail", exact: true })
      .fill(SUPER_ADMIN.email);
    await dialog
      .getByRole("textbox", { name: "Temporary password" })
      .fill("TempPass123!");
    await dialog.getByRole("button", { name: "Create user" }).click();

    // Still open, with an explanation rather than a generic failure.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText(/already exists/i);
  });

  test("does not offer destructive actions against yourself", async ({
    page,
  }) => {
    await page.goto("/users");
    await page.getByRole("searchbox").fill(SUPER_ADMIN.email);

    await page
      .getByRole("table")
      .getByRole("button", { name: /Actions for Super Admin/ })
      .click();

    await expect(page.getByRole("menuitem", { name: "Ban user" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("menuitem", { name: "Delete user" }),
    ).toHaveCount(0);
  });

  test("paginates through the URL", async ({ page }) => {
    await page.goto("/users?pageSize=10");

    await expect(page.getByRole("combobox", { name: "Rows" })).toBeVisible();
    // Page state is linkable, so the pager reflects the query string.
    await expect(page.getByText(/of \d+/)).toBeVisible();
  });
});

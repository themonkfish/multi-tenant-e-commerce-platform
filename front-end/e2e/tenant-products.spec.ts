import { expect, test } from "@playwright/test";

const tenantUrl = "http://store.localhost:3100";

test("tenant owner can create, edit, and delete catalog products", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL: tenantUrl });
  const page = await context.newPage();

  await page.goto("/en/tenant/login");
  await page.getByLabel("Email").fill("owner@store.e2e.test");
  await page.getByLabel("Password").fill("E2ETenantOwner-2026!");
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tenant/auth/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  expect((await loginResponse).ok()).toBe(true);

  await page.goto("/en/tenant/products");
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();

  await page.getByLabel("Product title").fill("E2E Catalog Bag");
  await page.getByLabel("Slug").fill("e2e-catalog-bag");
  await page.getByLabel("Status").selectOption("active");
  await page.getByLabel("Price amount").fill("2499");
  await page
    .getByRole("textbox", { name: "Currency", exact: true })
    .fill("USD");
  await page.getByLabel("SKU (optional)").fill("E2E-BAG");
  await page.getByLabel("Category (optional)").fill("Bags");
  await page.getByRole("button", { name: "Create product" }).click();

  await expect(page.getByText("Product created successfully.")).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "E2E Catalog Bag" }),
  ).toBeVisible();

  const productRow = page
    .getByRole("row")
    .filter({ hasText: "E2E Catalog Bag" });
  await productRow.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Product title").fill("E2E Updated Bag");
  await page.getByLabel("Price amount").fill("2799");
  const updateResponse = page.waitForResponse(
    (response) =>
      /\/api\/tenant\/products\/[^/]+$/.test(response.url()) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await updateResponse).ok()).toBe(true);

  await expect(page.getByText("Product updated successfully.")).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "E2E Updated Bag" }),
  ).toBeVisible();

  const apiResult = await page.evaluate(async () => {
    const response = await fetch("/api/tenant/products");
    return { status: response.status, body: await response.json() };
  });
  expect(apiResult.status).toBe(200);
  expect(apiResult.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: "E2E Updated Bag",
        slug: "e2e-catalog-bag",
        price: { amount: 2799, currency: "USD" },
      }),
    ]),
  );

  const updatedRow = page
    .getByRole("row")
    .filter({ hasText: "E2E Updated Bag" });
  page.once("dialog", (dialog) => dialog.accept());
  await updatedRow.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText("Product deleted.")).toBeVisible();
  await expect(page.getByText("E2E Updated Bag")).toHaveCount(0);

  await context.close();
});

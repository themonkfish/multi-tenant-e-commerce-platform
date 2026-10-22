import { expect, test } from "@playwright/test";

const tenantOrderId = "ORD-33333333-3333-4333-8333-333333333333";
const otherTenantOrderId = "ORD-44444444-4444-4444-8444-444444444444";
const tenantUrl = "http://store.localhost:3100";
const otherTenantUrl = "http://other.localhost:3100";

async function signIn(
  page: import("@playwright/test").Page,
  path: string,
  email: string,
  password: string,
) {
  await page.goto(path);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const loginPath = path.includes("/staff/")
    ? "/api/tenant/staff/auth/login"
    : path.includes("/customer/")
      ? "/api/customer/auth/login"
      : "/api/tenant/auth/login";
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(loginPath) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  const response = await loginResponse;
  if (!response.ok()) {
    throw new Error(
      `Login failed (${response.status()}): ${JSON.stringify(await response.json())}`,
    );
  }
}

test("tenant orders are permission-scoped, isolated, and reflected in customer history", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext({ baseURL: tenantUrl });
  const ownerPage = await ownerContext.newPage();
  await signIn(
    ownerPage,
    "/en/tenant/login",
    "owner@store.e2e.test",
    "E2ETenantOwner-2026!",
  );
  await expect(ownerPage.getByText(/^Signed in as/)).toBeVisible();
  const ownerOrderApi = await ownerPage.evaluate(async () => {
    const response = await fetch("/api/tenant/orders");
    return { status: response.status, body: await response.json() };
  });
  expect(ownerOrderApi.status).toBe(200);
  await ownerPage.goto("/en/tenant/orders");
  await expect(ownerPage).toHaveURL(/\/en\/tenant\/orders$/);
  await expect(
    ownerPage.getByRole("heading", { name: "Orders" }),
  ).toBeVisible();
  await expect(
    ownerPage.getByRole("row").filter({ hasText: tenantOrderId }),
  ).toBeVisible();
  await expect(ownerPage.getByText(otherTenantOrderId)).toHaveCount(0);
  await ownerPage
    .getByRole("row")
    .filter({ hasText: tenantOrderId })
    .getByRole("button", { name: "View" })
    .click();
  await expect(ownerPage.getByText("Order E2E Product × 2")).toBeVisible();
  await ownerPage.getByRole("button", { name: "Mark as processing" }).click();
  await expect(
    ownerPage
      .getByRole("status")
      .getByText("Order status updated to Processing."),
  ).toBeVisible();
  await ownerContext.close();

  const staffContext = await browser.newContext({ baseURL: tenantUrl });
  const staffPage = await staffContext.newPage();
  await signIn(
    staffPage,
    "/en/tenant/staff/login",
    "orders@store.e2e.test",
    "E2EOrderStaff-2026!",
  );
  await expect(staffPage).toHaveURL(/\/en\/tenant\/orders$/);
  await staffPage
    .getByRole("row")
    .filter({ hasText: tenantOrderId })
    .getByRole("button", { name: "View" })
    .click();
  await staffPage.getByRole("button", { name: "Mark as shipped" }).click();
  await expect(
    staffPage.getByRole("status").getByText("Order status updated to Shipped."),
  ).toBeVisible();
  await staffContext.close();

  const readOnlyContext = await browser.newContext({ baseURL: tenantUrl });
  const readOnlyPage = await readOnlyContext.newPage();
  await signIn(
    readOnlyPage,
    "/en/tenant/staff/login",
    "readonly@store.e2e.test",
    "E2EReadOnlyStaff-2026!",
  );
  await expect(readOnlyPage).toHaveURL(/\/en\/tenant\/orders$/);
  await readOnlyPage
    .getByRole("row")
    .filter({ hasText: tenantOrderId })
    .getByRole("button", { name: "View" })
    .click();
  await expect(
    readOnlyPage.getByRole("button", { name: /Mark as/ }),
  ).toHaveCount(0);
  const forbidden = await readOnlyPage.evaluate(async (orderId) => {
    const response = await fetch("/api/tenant/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, status: "Shipped" }),
    });
    return response.status;
  }, tenantOrderId);
  expect(forbidden).toBe(403);
  await readOnlyContext.close();

  const otherTenantContext = await browser.newContext({
    baseURL: otherTenantUrl,
  });
  const otherTenantPage = await otherTenantContext.newPage();
  await signIn(
    otherTenantPage,
    "/en/tenant/staff/login",
    "orders@other.e2e.test",
    "E2EOtherTenantStaff-2026!",
  );
  await expect(otherTenantPage).toHaveURL(/\/en\/tenant\/orders$/);
  await expect(
    otherTenantPage.getByRole("row").filter({ hasText: otherTenantOrderId }),
  ).toBeVisible();
  await expect(otherTenantPage.getByText(tenantOrderId)).toHaveCount(0);
  const crossTenantDetail = await otherTenantPage.evaluate(async (orderId) => {
    const response = await fetch(
      `/api/tenant/orders/${encodeURIComponent(orderId)}`,
    );
    return response.status;
  }, tenantOrderId);
  expect(crossTenantDetail).toBe(404);
  await otherTenantContext.close();

  const customerContext = await browser.newContext({ baseURL: tenantUrl });
  const customerPage = await customerContext.newPage();
  await signIn(
    customerPage,
    "/en/customer/login",
    "customer@store.e2e.test",
    "E2ECustomerAccount-2026!",
  );
  await expect(customerPage).toHaveURL(/\/en\/account$/);
  await customerPage.goto("/en/account");
  const customerOrder = customerPage
    .locator("article")
    .filter({ hasText: tenantOrderId });
  await expect(customerOrder.getByText("Shipped")).toBeVisible();
  await expect(customerPage.getByText(otherTenantOrderId)).toHaveCount(0);
  await customerContext.close();
});

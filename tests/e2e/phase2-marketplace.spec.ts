import { expect, test } from "@playwright/test";

function isoDateFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("a visitor can search live public availability", async ({ page, request }) => {
  const checkIn = isoDateFromNow(2);
  const checkOut = isoDateFromNow(4);
  const query = new URLSearchParams({
    destination: "Aizawl",
    checkIn,
    checkOut,
    guests: "2",
  });

  const apiResponse = await request.get(`/api/v1/search?${query}`);
  expect(apiResponse.status()).toBe(200);
  const apiBody = await apiResponse.json() as { data: Array<{ name: string }> };

  await page.goto("/search");
  await page.getByLabel("Destination").fill("Aizawl");
  await page.getByLabel("Check-in").fill(checkIn);
  await page.getByLabel("Check-out").fill(checkOut);
  await page.getByLabel("Guests").fill("2");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/search" && url.searchParams.get("checkIn") === checkIn),
    page.getByRole("button", { name: "Search availability" }).click(),
  ]);

  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText(/\d+ available stays? found/);
  await expect(page.getByLabel("Destination")).toHaveValue("Aizawl");
  await expect(page.getByLabel("Check-in")).toHaveValue(checkIn);
  await expect(page.getByLabel("Check-out")).toHaveValue(checkOut);
  await expect(page.getByLabel("Guests")).toHaveValue("2");

  if (apiBody.data[0]) {
    await expect(page.getByRole("heading", { name: apiBody.data[0].name })).toBeVisible();
  }
});

test("an unauthenticated visitor is redirected away from host pages", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/host/dashboard");

  await expect(page).toHaveURL(/\/login\?next=%2Fhost%2Fdashboard$/);
  await expect(page.getByRole("heading", { name: "Sign in to continue." })).toBeVisible();
});

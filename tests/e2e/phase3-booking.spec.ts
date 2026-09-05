import { expect, test } from "@playwright/test";

const BOOKING_ID = "11111111-1111-4111-8111-111111111111";

function isoDateFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("an unauthenticated visitor is redirected from a private booking", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto(`/booking/${BOOKING_ID}`);

  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fbooking%2F${BOOKING_ID}$`));
  await expect(page.getByRole("heading", { name: "Sign in to continue." })).toBeVisible();
});

test("a visitor can move from public availability to property booking details without starting payment", async ({ page, request }) => {
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
  const payload = await apiResponse.json() as {
    data: Array<{ name: string; slug: string; roomName: string }>;
  };
  expect(payload.data.length, "Seed at least one published Aizawl stay with inventory for the selected dates").toBeGreaterThan(0);
  const stay = payload.data[0];

  let paymentRequests = 0;
  await page.route("**/api/v1/payments/**", async (route) => {
    paymentRequests += 1;
    await route.abort();
  });

  await page.goto(`/search?${query}`);
  await expect(page.getByRole("heading", { name: stay.name })).toBeVisible();
  await expect(page.getByText(stay.roomName, { exact: true })).toBeVisible();
  await Promise.all([
    page.waitForURL(new RegExp(`/stays/${stay.slug}$`)),
    page.getByRole("link", { name: "View stay" }).first().click(),
  ]);

  await expect(page.getByRole("heading", { name: stay.name, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a room" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Booking details" })).toBeVisible();
  await expect(page.getByText("You will see the full price and cancellation terms before payment.")).toBeVisible();

  await page.getByRole("button", { name: "Request to reserve" }).click();
  await expect(page).toHaveURL(new RegExp(`/stays/${stay.slug}$`));
  expect(paymentRequests).toBe(0);
});

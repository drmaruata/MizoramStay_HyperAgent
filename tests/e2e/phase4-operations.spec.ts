import { expect, test } from "@playwright/test";

test("an unauthenticated visitor is redirected from customer support and admin operations", async ({ page }) => {
  await page.context().clearCookies();

  await page.goto("/support");
  await expect(page).toHaveURL(/\/login\?next=%2Fsupport$/);
  await expect(page.getByRole("heading", { name: "Sign in to continue." })).toBeVisible();

  await page.goto("/admin/support");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fsupport$/);
  await expect(page.getByRole("heading", { name: "Sign in to continue." })).toBeVisible();
});

test("a public property displays an approved review fixture when one exists", async ({ page, request }) => {
  await page.context().clearCookies();
  await page.goto("/stays");

  const listedSlugs = await page.locator('a[href^="/stays/"]').evaluateAll((links) =>
    links.flatMap((link) => {
      const href = link.getAttribute("href");
      return href ? [href.replace(/^\/stays\//, "")] : [];
    }),
  );
  const configuredSlug = process.env.PHASE4_E2E_REVIEW_PROPERTY_SLUG;
  const candidates = [...new Set([configuredSlug, ...listedSlugs].filter((slug): slug is string => Boolean(slug)))];

  let fixture: {
    slug: string;
    propertyName: string;
    review: { rating: number; title: string | null; body: string | null; hostResponse: string | null };
  } | undefined;

  for (const slug of candidates) {
    const response = await request.get(`/api/v1/public/properties/${encodeURIComponent(slug)}`);
    if (!response.ok()) continue;
    const payload = await response.json() as {
      data: {
        name: string;
        reviews: Array<{ rating: number; title: string | null; body: string | null; hostResponse: string | null }>;
      };
    };
    const review = payload.data.reviews[0];
    if (review) {
      fixture = { slug, propertyName: payload.data.name, review };
      break;
    }
  }

  test.skip(!fixture, "Seed an approved/published review, optionally setting PHASE4_E2E_REVIEW_PROPERTY_SLUG.");
  await page.goto(`/stays/${fixture!.slug}`);

  await expect(page.getByRole("heading", { name: fixture!.propertyName, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Guest reviews" })).toBeVisible();
  await expect(page.getByText(`★ ${fixture!.review.rating.toFixed(1)}`, { exact: false }).first()).toBeVisible();
  if (fixture!.review.title) await expect(page.getByRole("heading", { name: fixture!.review.title })).toBeVisible();
  if (fixture!.review.body) await expect(page.getByText(fixture!.review.body, { exact: true })).toBeVisible();
  if (fixture!.review.hostResponse) {
    await expect(page.getByText("Response from host", { exact: true })).toBeVisible();
    await expect(page.getByText(fixture!.review.hostResponse, { exact: true })).toBeVisible();
  }
});

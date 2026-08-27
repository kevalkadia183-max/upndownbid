import { expect, test, type Page } from "@playwright/test";

const listing = {
  id: "listing-signalrank",
  name: "SignalRank",
  slug: "signalrank",
  tagline: "Find the products worth your attention.",
  description: "A public product discovery leaderboard.",
  category: "Directories, Launch & Discovery",
  initials: "SR",
  accent: "#e88470",
  rank: 1,
  effectiveBid: 125,
  ownerBid: 100,
  communitySupport: 35,
  penalties: 10,
  supporters: 7,
  penalizers: 2,
  rating: 4.8,
  reviewCount: 12,
  clicks: 48,
  createdAt: "2026-08-20T12:00:00.000Z",
  trend: 1,
  websiteUrl: "https://signalrank.example.com",
};

const campaign = {
  id: "campaign-label-regression",
  number: 42,
  status: "live",
  startAt: "2026-08-23T00:00:00.000Z",
  endAt: "2026-08-30T00:00:00.000Z",
  minimumBid: 5,
  timezone: "UTC",
  lastWinner: null,
};

async function mockPublicReadApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/listings") {
      await route.fulfill({ json: [listing] });
      return;
    }
    if (pathname === `/api/listings/${listing.slug}`) {
      await route.fulfill({
        json: {
          ...listing,
          reviews: [],
          transactions: [],
        },
      });
      return;
    }
    if (pathname === "/api/activity") {
      await route.fulfill({ json: [] });
      return;
    }
    if (pathname === "/api/campaigns/current") {
      await route.fulfill({ json: campaign });
      return;
    }
    await route.continue();
  });
}

async function mockCampaignClaimApi(page: Page) {
  await page.route("**/api/public/listings/preview", async (route) => {
    const request = route.request();
    const body = JSON.parse(request.postData() ?? "{}") as { websiteUrl?: string };
    await route.fulfill({
      json: {
        duplicate: listing,
        canonicalUrl: body.websiteUrl ?? listing.websiteUrl,
      },
    });
  });
  await page.route("**/api/public/campaign-bids", async (route) => {
    await route.fulfill({
      status: 201,
      json: {
        mode: "increase",
        campaign,
        listing,
        payment: {
          id: "pending-campaign-claim",
          status: "pending",
          receiptNumber: null,
          checkoutUrl: "/test-sandbox-checkout",
        },
      },
    });
  });
}

async function openClaimAndCaptureRequest(page: Page) {
  const viewport = page.viewportSize();
  await page.goto("/");
  if (viewport && viewport.width < 600) {
    await page.getByTestId("mobile-nav-campaign-bid").click();
    await expect(page).toHaveURL(/\/add-product$/);
  } else {
    await page.goto("/add-product");
  }

  await page.getByTestId("input-campaign-url").fill(listing.websiteUrl!);
  await page.getByTestId("input-campaign-bid").fill("126");
  await expect(page.getByTestId("campaign-existing-product")).toBeVisible();
  await page.getByTestId("button-open-campaign-checkout").click();
  await page.getByTestId("input-campaign-email").fill("owner@example.test");

  const mobileLayout = viewport && viewport.width < 600
    ? await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
    : null;
  const requestPromise = page.waitForRequest("**/api/public/campaign-bids");
  await page.getByTestId("button-confirm-campaign-bid").click();
  return { request: await requestPromise, mobileLayout };
}

async function expectNoLegacyLabels(page: Page) {
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/\bBID\b/i);
  expect(bodyText).not.toMatch(/\bPENALTY\b/i);
  expect(bodyText).not.toMatch(/\bEffective Bid\b/i);
}

async function expectActionDialog(page: Page, label: "BOOST" | "PUSH DOWN") {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: label, exact: true })).toBeVisible();
  await expect(dialog.getByText("Projected ranking power", { exact: true })).toBeVisible();
  await expectNoLegacyLabels(page);
}

async function retryActionCheckout(
  page: Page,
  type: "support" | "penalize",
  firstFailure: { status: number; retryable: boolean },
) {
  const idempotencyKeys: string[] = [];
  let attempts = 0;
  await page.route(`**/api/public/listings/${listing.slug}/checkout`, async (route) => {
    idempotencyKeys.push(route.request().headers()["idempotency-key"] ?? "");
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: firstFailure.status,
        json: {
          error: firstFailure.retryable
            ? "Checkout is pending confirmation. Retry using the same payment attempt."
            : "The checkout provider rejected this request.",
          retryable: firstFailure.retryable,
        },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        payment: { id: `checkout-${type}`, status: "succeeded", receiptNumber: "SBX-RETRY" },
        listing,
        sandbox: true,
      },
    });
  });

  await page.goto(`/listing/${listing.slug}`);
  await page.getByTestId(type === "support" ? "button-trigger-support" : "button-trigger-penalize").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("you@example.com").fill(`${type}@example.test`);
  if (type === "penalize") {
    await dialog.getByRole("button", { name: "Bug", exact: true }).click();
  }
  const submit = dialog.getByTestId(`button-submit-${type}`);
  await submit.click();
  await expect(submit).toHaveText(
    type === "support"
      ? firstFailure.retryable
        ? "RETRY BOOST"
        : "BOOST"
      : firstFailure.retryable
        ? "RETRY PUSH DOWN"
        : "PUSH DOWN",
  );
  await submit.click();
  await expect.poll(() => idempotencyKeys.length).toBe(2);
  return idempotencyKeys;
}

test.describe("public marketplace terminology", () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicReadApi(page);
  });

  test("keeps homepage cards and detail dialogs on the public labels", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("link-listing-signalrank")).toBeVisible();
    await expect(page.getByText("Ranking Power", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("button-card-bid-signalrank")).toHaveText(/BOOST/);
    await expect(page.getByTestId("button-card-penalty-signalrank")).toHaveText(/PUSH DOWN/);
    await expectNoLegacyLabels(page);

    await page.getByTestId("button-card-bid-signalrank").click();
    await expectActionDialog(page, "BOOST");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await page.goto("/");
    await page.getByTestId("button-card-penalty-signalrank").click();
    await expectActionDialog(page, "PUSH DOWN");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("keeps product detail actions on the public labels", async ({ page }) => {
    await page.goto(`/listing/${listing.slug}`);
    await expect(page.getByText("Ranking Power", { exact: true })).toBeVisible();
    await expectNoLegacyLabels(page);

    await page.getByTestId("button-trigger-support").click();
    await expectActionDialog(page, "BOOST");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await page.getByTestId("button-trigger-penalize").click();
    await expectActionDialog(page, "PUSH DOWN");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("sends complete Claim a Spot data and an idempotency key from each responsive entry", async ({ page }) => {
    await mockCampaignClaimApi(page);
    const { request, mobileLayout } = await openClaimAndCaptureRequest(page);
    const body = JSON.parse(request.postData() ?? "{}");

    expect(body).toEqual({
      websiteUrl: listing.websiteUrl,
      category: campaign.minimumBid === 5 ? "SEO & AI Visibility" : expect.any(String),
      ownerBid: 126,
      email: "owner@example.test",
    });
    expect(request.headers()["idempotency-key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    if (mobileLayout) {
      expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth);
    }
  });

  test("keeps direct Claim a Spot navigation ready for a complete request", async ({ page }) => {
    await page.goto("/add-product");
    await expect(page.getByTestId("input-campaign-url")).toBeVisible();
    await expect(page.getByTestId("select-campaign-category")).toBeVisible();
    await expect(page.getByTestId("input-campaign-bid")).toHaveValue("5");
  });

  for (const type of ["support", "penalize"] as const) {
    test(`retries an indeterminate ${type} checkout with the same idempotency key`, async ({ page }) => {
      const idempotencyKeys = await retryActionCheckout(page, type, { status: 503, retryable: true });
      expect(idempotencyKeys[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    });
  }

  test("starts a fresh support checkout after a confirmed provider rejection", async ({ page }) => {
    const idempotencyKeys = await retryActionCheckout(page, "support", { status: 502, retryable: false });
    expect(idempotencyKeys[1]).not.toBe(idempotencyKeys[0]);
  });
});
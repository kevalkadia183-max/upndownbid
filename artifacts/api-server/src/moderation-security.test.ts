import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { campaignsTable, db, invoiceEmailDeliveriesTable, invoicesTable, ledgerEntriesTable, listingsTable, paymentEventsTable, paymentReceiptsTable, paymentsTable, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createApp } from "./app";
import { ensureCurrentCampaign } from "./lib/campaigns";
import { associateVerifiedEmailClaims } from "./lib/moderation";
import { ensureSignalRankSeed } from "./lib/signalrank-seed";
import {
  capturePayPalOrder,
  createAndCompleteTestCheckout,
  createPayPalCheckout,
  createPayPalOrder,
  createRefund,
  getPaymentProviderStatus,
  isPayPalCheckoutEnabled,
  payPalEnvironment,
  processVerifiedPaymentEvent,
  setPayPalFetchForTests,
  verifyAndProcessPayPalWebhook,
} from "./lib/payments";

let listingId = "";
let campaignId = "";
const createdUsers: string[] = [];

before(async () => {
  await ensureSignalRankSeed();
  const campaign = await ensureCurrentCampaign();
  const [listing] = await db.select({ id: listingsTable.id }).from(listingsTable).limit(1);
  assert.ok(listing);
  listingId = listing.id;
  campaignId = campaign.id;
});
after(async () => {
  setPayPalFetchForTests(null);
  if (createdUsers.length) {
    for (const id of createdUsers) {
      await db.update(invoicesTable).set({ userId: null }).where(eq(invoicesTable.userId, id));
      await db.update(paymentsTable).set({ userId: null }).where(eq(paymentsTable.userId, id));
      await db.delete(usersTable).where(eq(usersTable.id, id));
    }
  }
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function withPayPal<T>(run: () => Promise<T>): Promise<T> {
  const saved = { provider: process.env.PAYMENT_PROVIDER, mode: process.env.PAYMENT_MODE, client: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET, webhook: process.env.PAYPAL_WEBHOOK_ID };
  process.env.PAYMENT_PROVIDER = "paypal";
  process.env.PAYMENT_MODE = "sandbox";
  process.env.PAYPAL_CLIENT_ID = "test-client";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  process.env.PAYPAL_WEBHOOK_ID = "test-webhook";
  try { return await run(); } finally {
    for (const [key, value] of Object.entries(saved)) {
      const name = key === "provider" ? "PAYMENT_PROVIDER" : key === "mode" ? "PAYMENT_MODE" : key === "client" ? "PAYPAL_CLIENT_ID" : key === "secret" ? "PAYPAL_CLIENT_SECRET" : "PAYPAL_WEBHOOK_ID";
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    setPayPalFetchForTests(null);
  }
}

describe("verified-email listing ownership claims", { concurrency: false }, () => {
  async function insertTestUser(role: "member" | "moderator" | "admin"): Promise<User> {
    const id = `ownership-claim-user-${role}-${crypto.randomUUID()}`;
    createdUsers.push(id);
    const [user] = await db
      .insert(usersTable)
      .values({
        id,
        clerkUserId: `ownership-claim-clerk-${crypto.randomUUID()}`,
        email: null,
        displayName: `Ownership claim test (${role})`,
        role,
        status: "active",
      })
      .returning();
    assert.ok(user);
    return user;
  }

  async function insertUnownedListing(ownerEmail: string): Promise<string> {
    const id = `ownership-claim-listing-${crypto.randomUUID()}`;
    await db.insert(listingsTable).values({
      id,
      ownerId: null,
      ownerEmail,
      name: "Ownership claim test listing",
      slug: id,
      tagline: "test",
      description: "test",
      category: "AI",
      initials: "OC",
      accent: "coral",
    });
    return id;
  }

  after(async () => {
    // Individual listing ids are cleaned up inline by each test, but this
    // guards against a failed assertion leaving one behind.
    await db.delete(listingsTable).where(eq(listingsTable.name, "Ownership claim test listing"));
  });

  it("does not let an admin's verified email silently acquire ownership of another user's unowned listing", async () => {
    const email = `admin-claim-${crypto.randomUUID()}@example.test`;
    const admin = await insertTestUser("admin");
    const listingId = await insertUnownedListing(email);
    try {
      await associateVerifiedEmailClaims(admin, email);
      const [listing] = await db.select({ ownerId: listingsTable.ownerId }).from(listingsTable).where(eq(listingsTable.id, listingId));
      assert.equal(listing?.ownerId, null);
    } finally {
      await db.delete(listingsTable).where(eq(listingsTable.id, listingId));
    }
  });

  it("does not let a moderator's verified email silently acquire ownership of another user's unowned listing", async () => {
    const email = `moderator-claim-${crypto.randomUUID()}@example.test`;
    const moderator = await insertTestUser("moderator");
    const listingId = await insertUnownedListing(email);
    try {
      await associateVerifiedEmailClaims(moderator, email);
      const [listing] = await db.select({ ownerId: listingsTable.ownerId }).from(listingsTable).where(eq(listingsTable.id, listingId));
      assert.equal(listing?.ownerId, null);
    } finally {
      await db.delete(listingsTable).where(eq(listingsTable.id, listingId));
    }
  });

  it("still lets a member's verified email claim their own legacy unowned listing", async () => {
    const email = `member-claim-${crypto.randomUUID()}@example.test`;
    const member = await insertTestUser("member");
    const listingId = await insertUnownedListing(email);
    try {
      await associateVerifiedEmailClaims(member, email);
      const [listing] = await db.select({ ownerId: listingsTable.ownerId }).from(listingsTable).where(eq(listingsTable.id, listingId));
      assert.equal(listing?.ownerId, member.id);
    } finally {
      await db.delete(listingsTable).where(eq(listingsTable.id, listingId));
    }
  });
});

describe("payment adapter selection", () => {
  it("defaults the provider environment to sandbox", () => {
    assert.equal(payPalEnvironment(), "sandbox");
    assert.equal(typeof isPayPalCheckoutEnabled(), "boolean");
  });

  it("requires every production safeguard before selecting production", () => {
    const saved = {
      environment: process.env.PAYPAL_ENVIRONMENT,
      mode: process.env.PAYMENT_MODE,
      enabled: process.env.PAYMENTS_LIVE_ENABLED,
    };
    try {
      process.env.PAYPAL_ENVIRONMENT = "production";
      process.env.PAYMENT_MODE = "live";
      process.env.PAYMENTS_LIVE_ENABLED = "false";
      assert.equal(payPalEnvironment(), "sandbox");
      process.env.PAYMENTS_LIVE_ENABLED = "true";
      assert.equal(payPalEnvironment(), "production");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        const name = key === "environment" ? "PAYPAL_ENVIRONMENT" : key === "mode" ? "PAYMENT_MODE" : "PAYMENTS_LIVE_ENABLED";
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("serves the LIVE PayPal client id to the JS SDK only once every production safeguard is active, and the sandbox id otherwise", async () => {
    const saved = {
      environment: process.env.PAYPAL_ENVIRONMENT, mode: process.env.PAYMENT_MODE, enabled: process.env.PAYMENTS_LIVE_ENABLED,
      client: process.env.PAYPAL_CLIENT_ID, liveClient: process.env.PAYPAL_CLIENT_ID_LIVE, providerEnv: process.env.PAYMENT_PROVIDER,
    };
    process.env.PAYPAL_CLIENT_ID = "sandbox-client-id";
    process.env.PAYPAL_CLIENT_ID_LIVE = "live-client-id";
    process.env.PAYMENT_PROVIDER = "paypal";
    try {
      process.env.PAYPAL_ENVIRONMENT = "sandbox";
      process.env.PAYMENT_MODE = "sandbox";
      process.env.PAYMENTS_LIVE_ENABLED = "false";
      assert.equal((await getPaymentProviderStatus()).paypalClientId, "sandbox-client-id");
      process.env.PAYPAL_ENVIRONMENT = "production";
      process.env.PAYMENT_MODE = "live";
      process.env.PAYMENTS_LIVE_ENABLED = "false";
      assert.equal((await getPaymentProviderStatus()).paypalClientId, "sandbox-client-id", "must stay on the sandbox id until every safeguard is active");
      process.env.PAYMENTS_LIVE_ENABLED = "true";
      const status = await getPaymentProviderStatus();
      assert.equal(status.paypalClientId, "live-client-id");
      assert.equal(status.mode, "live");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        const name = key === "environment" ? "PAYPAL_ENVIRONMENT" : key === "mode" ? "PAYMENT_MODE" : key === "enabled" ? "PAYMENTS_LIVE_ENABLED" : key === "client" ? "PAYPAL_CLIENT_ID" : key === "liveClient" ? "PAYPAL_CLIENT_ID_LIVE" : "PAYMENT_PROVIDER";
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("payment finality regressions", { concurrency: false }, () => {
  it("does not downgrade a captured payment when a verified deny arrives later", async () => {
    await withPayPal(async () => {
      const payment = (await createPayPalCheckout({
        listingId, campaignId, userId: null, type: "COMMUNITY_BID", amountCents: 500,
        idempotencyKey: `finality-${crypto.randomUUID()}`,
      })).payment;
      const orderId = `order-${payment.id}`;
      await db.update(paymentsTable).set({ providerCheckoutId: orderId }).where(eq(paymentsTable.id, payment.id));
      const success = await processVerifiedPaymentEvent({
        provider: "paypal", eventId: `capture-${payment.id}`, type: "payment_succeeded",
        paymentId: payment.id, providerCheckoutId: orderId, providerPaymentId: `capture-${payment.id}`,
        amountCents: 500, currency: "USD",
      });
      assert.equal(success.payment?.status, "succeeded");
      await processVerifiedPaymentEvent({
        provider: "paypal", eventId: `deny-${payment.id}`, type: "payment_failed",
        paymentId: payment.id, providerCheckoutId: orderId, providerPaymentId: `capture-${payment.id}`,
      });
      const [stored] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, payment.id));
      const ledger = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.paymentId, payment.id));
      assert.equal(stored?.status, "succeeded");
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0]?.type, "COMMUNITY_BID");
    });
  });

  it("serializes concurrent order creation onto the persisted order binding", async () => {
    await withPayPal(async () => {
      let orderCalls = 0;
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        orderCalls += 1;
        return response({ id: "ORDER-BOUND-ONCE", status: "CREATED" });
      });
      const payment = (await createPayPalCheckout({
        listingId, campaignId, userId: null, type: "COMMUNITY_BID", amountCents: 501,
        idempotencyKey: `order-race-${crypto.randomUUID()}`,
      })).payment;
      const [left, right] = await Promise.all([createPayPalOrder(payment.id), createPayPalOrder(payment.id)]);
      const [stored] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, payment.id));
      assert.equal(left.orderId, "ORDER-BOUND-ONCE");
      assert.equal(right.orderId, "ORDER-BOUND-ONCE");
      assert.equal(stored?.providerCheckoutId, "ORDER-BOUND-ONCE");
      assert.equal(orderCalls, 1);
    });
  });

  it("rejects test community-bid refunds without writing a reversal", async () => {
    const userId = `refund-user-${crypto.randomUUID()}`;
    createdUsers.push(userId);
    await db.insert(usersTable).values({
      id: userId, clerkUserId: `refund-clerk-${crypto.randomUUID()}`,
      email: `${userId}@example.test`, displayName: "Refund test", role: "member", status: "active",
    });
    const payment = await createAndCompleteTestCheckout({
      listingId, campaignId, userId, type: "COMMUNITY_BID", amountCents: 502,
      idempotencyKey: `community-refund-${crypto.randomUUID()}`,
    });
    await assert.rejects(
      () => createRefund({ paymentId: payment.id, userId, amountCents: 502, idempotencyKey: `refund-${crypto.randomUUID()}` }),
      /non-refundable/i,
    );
    const entries = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.paymentId, payment.id));
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.type, "COMMUNITY_BID");
  });

  it("supports bounded partial test refunds and protects idempotent request fields", async () => {
    const userId = `partial-refund-user-${crypto.randomUUID()}`;
    createdUsers.push(userId);
    await db.insert(usersTable).values({
      id: userId, clerkUserId: `partial-refund-clerk-${crypto.randomUUID()}`,
      email: `${userId}@example.test`, displayName: "Partial refund test", role: "member", status: "active",
    });
    const payment = await createAndCompleteTestCheckout({
      listingId, campaignId, userId, type: "OWNER_BID", amountCents: 500,
      idempotencyKey: `partial-payment-${crypto.randomUUID()}`,
    });
    const firstKey = `partial-first-${crypto.randomUUID()}`;
    const first = await createRefund({ paymentId: payment.id, userId, amountCents: 300, reason: "first", idempotencyKey: firstKey });
    assert.equal(first.payment.status, "partially_refunded");
    await assert.rejects(
      () => createRefund({ paymentId: payment.id, userId, amountCents: 300, reason: "changed", idempotencyKey: firstKey }),
      /different refund request/i,
    );
    const second = await createRefund({ paymentId: payment.id, userId, amountCents: 200, reason: "second", idempotencyKey: `partial-second-${crypto.randomUUID()}` });
    assert.equal(second.payment.status, "refunded");
    await assert.rejects(
      () => createRefund({ paymentId: payment.id, userId, amountCents: 1, reason: "over", idempotencyKey: `partial-over-${crypto.randomUUID()}` }),
      /not refundable|remaining refundable/i,
    );
    const entries = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.paymentId, payment.id));
    assert.equal(entries.filter((entry) => entry.type === "REFUND").length, 2);
  });
});

describe("campaign-scoped PayPal order creation", { concurrency: false }, () => {
  async function insertEndedCampaign(): Promise<string> {
    const id = `ended-campaign-${crypto.randomUUID()}`;
    const now = Date.now();
    await db.insert(campaignsTable).values({
      id,
      number: Math.floor(now / 1000) + Math.floor(Math.random() * 100000),
      startAt: new Date(now - 14 * 24 * 60 * 60 * 1000),
      endAt: new Date(now - 7 * 24 * 60 * 60 * 1000),
      status: "completed",
    });
    return id;
  }

  it("rejects creating a new PayPal order once the payment's campaign has ended", async () => {
    await withPayPal(async () => {
      const endedCampaignId = await insertEndedCampaign();
      const payment = (await createPayPalCheckout({
        listingId, campaignId: endedCampaignId, userId: null, type: "COMMUNITY_BID", amountCents: 520,
        idempotencyKey: `campaign-ended-${crypto.randomUUID()}`,
      })).payment;
      await assert.rejects(
        () => createPayPalOrder(payment.id),
        /campaign has ended/i,
      );
      const [stored] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, payment.id));
      assert.equal(stored?.providerCheckoutId, null);
      assert.equal(stored?.status, "pending");
    });
  });

  it("rejects a tampered client that only forges its own belief about campaign status, since the server re-derives it from the stored payment", async () => {
    // The client never sends a campaignId on create-order — this test documents that
    // even if it did, the server ignores it entirely and only trusts payment.campaignId
    // as already persisted server-side at checkout time.
    await withPayPal(async () => {
      const endedCampaignId = await insertEndedCampaign();
      const payment = (await createPayPalCheckout({
        listingId, campaignId: endedCampaignId, userId: null, type: "OWNER_BID", amountCents: 700,
        idempotencyKey: `campaign-tamper-${crypto.randomUUID()}`,
      })).payment;
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        throw new Error(`Unexpected PayPal request: ${url}`);
      });
      await assert.rejects(() => createPayPalOrder(payment.id), /campaign has ended/i);
    });
  });

  it("still creates a new PayPal order for a payment bound to the current live campaign", async () => {
    await withPayPal(async () => {
      let orderCalls = 0;
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        orderCalls += 1;
        return response({ id: "ORDER-CURRENT-CAMPAIGN", status: "CREATED" });
      });
      const payment = (await createPayPalCheckout({
        listingId, campaignId, userId: null, type: "COMMUNITY_BID", amountCents: 521,
        idempotencyKey: `campaign-current-${crypto.randomUUID()}`,
      })).payment;
      const order = await createPayPalOrder(payment.id);
      assert.equal(order.orderId, "ORDER-CURRENT-CAMPAIGN");
      assert.equal(orderCalls, 1);
    });
  });

  it("lets an order already bound before rollover finish its in-flight approval instead of being blocked", async () => {
    await withPayPal(async () => {
      const endedCampaignId = await insertEndedCampaign();
      const payment = (await createPayPalCheckout({
        listingId, campaignId: endedCampaignId, userId: null, type: "COMMUNITY_BID", amountCents: 522,
        idempotencyKey: `campaign-inflight-${crypto.randomUUID()}`,
      })).payment;
      // Simulate an order that was already created against PayPal before the
      // campaign rolled over — this is the idempotent-replay short circuit,
      // not a fresh order request, so it must not be retroactively rejected.
      await db.update(paymentsTable).set({ providerCheckoutId: "ORDER-ALREADY-BOUND" }).where(eq(paymentsTable.id, payment.id));
      const order = await createPayPalOrder(payment.id);
      assert.equal(order.orderId, "ORDER-ALREADY-BOUND");
    });
  });
});

const PAYPAL_WEBHOOK_HEADERS = {
  "paypal-transmission-id": "test-transmission-id",
  "paypal-transmission-time": "2026-01-01T00:00:00Z",
  "paypal-transmission-sig": "test-sig",
  "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
  "paypal-auth-algo": "SHA256withRSA",
};

function paypalWebhookBody(overrides: { id: string; event_type: string; resource: Record<string, unknown> }) {
  return Buffer.from(JSON.stringify(overrides));
}

async function bindOrder(amountCents: number): Promise<{ paymentId: string; orderId: string }> {
  const payment = (await createPayPalCheckout({
    listingId, campaignId, userId: null, type: "COMMUNITY_BID", amountCents,
    idempotencyKey: `webhook-${crypto.randomUUID()}`,
  })).payment;
  const orderId = `ORDER-${payment.id}`;
  await db.update(paymentsTable).set({ providerCheckoutId: orderId }).where(eq(paymentsTable.id, payment.id));
  return { paymentId: payment.id, orderId };
}

describe("PayPal webhook event handling", { concurrency: false }, () => {
  it("only subscribes to and processes the six whitelisted checkout/capture events", async () => {
    await withPayPal(async () => {
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        if (url.endsWith("/v1/notifications/verify-webhook-signature")) return response({ verification_status: "SUCCESS" });
        throw new Error(`Unexpected PayPal request: ${url}`);
      });
      const result = await verifyAndProcessPayPalWebhook(
        paypalWebhookBody({ id: `evt-${crypto.randomUUID()}`, event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "CAP-1" } }),
        PAYPAL_WEBHOOK_HEADERS,
      );
      assert.equal(result.handled, false);
      assert.equal(result.payment, null);
    });
  });

  it("records PAYMENT.CAPTURE.PENDING as an audited no-op without crediting the ledger", async () => {
    await withPayPal(async () => {
      const { paymentId, orderId } = await bindOrder(510);
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        if (url.endsWith("/v1/notifications/verify-webhook-signature")) return response({ verification_status: "SUCCESS" });
        throw new Error(`Unexpected PayPal request: ${url}`);
      });
      const eventId = `evt-pending-${crypto.randomUUID()}`;
      const body = paypalWebhookBody({ id: eventId, event_type: "PAYMENT.CAPTURE.PENDING", resource: { id: `CAP-${orderId}`, supplementary_data: { related_ids: { order_id: orderId } } } });
      const first = await verifyAndProcessPayPalWebhook(body, PAYPAL_WEBHOOK_HEADERS);
      assert.equal(first.duplicate, false);
      assert.equal(first.payment?.status, "pending");
      const second = await verifyAndProcessPayPalWebhook(body, PAYPAL_WEBHOOK_HEADERS);
      assert.equal(second.duplicate, true);
      const [stored] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
      assert.equal(stored?.status, "pending");
      const ledger = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.paymentId, paymentId));
      assert.equal(ledger.length, 0);
    });
  });

  it("records CHECKOUT.ORDER.APPROVED as an audited no-op without crediting the ledger", async () => {
    await withPayPal(async () => {
      const { paymentId, orderId } = await bindOrder(511);
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        if (url.endsWith("/v1/notifications/verify-webhook-signature")) return response({ verification_status: "SUCCESS" });
        throw new Error(`Unexpected PayPal request: ${url}`);
      });
      const result = await verifyAndProcessPayPalWebhook(
        paypalWebhookBody({ id: `evt-approved-${crypto.randomUUID()}`, event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: orderId } }),
        PAYPAL_WEBHOOK_HEADERS,
      );
      assert.equal(result.payment?.status, "pending");
      const ledger = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.paymentId, paymentId));
      assert.equal(ledger.length, 0);
    });
  });

  it("fails the payment on PAYMENT.CAPTURE.DENIED", async () => {
    await withPayPal(async () => {
      const { paymentId, orderId } = await bindOrder(512);
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        if (url.endsWith("/v1/notifications/verify-webhook-signature")) return response({ verification_status: "SUCCESS" });
        throw new Error(`Unexpected PayPal request: ${url}`);
      });
      await verifyAndProcessPayPalWebhook(
        paypalWebhookBody({ id: `evt-denied-${crypto.randomUUID()}`, event_type: "PAYMENT.CAPTURE.DENIED", resource: { id: `CAP-${orderId}`, supplementary_data: { related_ids: { order_id: orderId } } } }),
        PAYPAL_WEBHOOK_HEADERS,
      );
      const [stored] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
      assert.equal(stored?.status, "failed");
    });
  });

  it("fails the payment on CHECKOUT.ORDER.DECLINED", async () => {
    await withPayPal(async () => {
      const { paymentId, orderId } = await bindOrder(513);
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        if (url.endsWith("/v1/notifications/verify-webhook-signature")) return response({ verification_status: "SUCCESS" });
        throw new Error(`Unexpected PayPal request: ${url}`);
      });
      await verifyAndProcessPayPalWebhook(
        paypalWebhookBody({ id: `evt-declined-${crypto.randomUUID()}`, event_type: "CHECKOUT.ORDER.DECLINED", resource: { id: orderId } }),
        PAYPAL_WEBHOOK_HEADERS,
      );
      const [stored] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
      assert.equal(stored?.status, "failed");
    });
  });

  it("fails the payment on CHECKOUT.PAYMENT-APPROVAL.REVERSED, matched via resource.order_id", async () => {
    await withPayPal(async () => {
      const { paymentId, orderId } = await bindOrder(514);
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        if (url.endsWith("/v1/notifications/verify-webhook-signature")) return response({ verification_status: "SUCCESS" });
        throw new Error(`Unexpected PayPal request: ${url}`);
      });
      await verifyAndProcessPayPalWebhook(
        paypalWebhookBody({ id: `evt-reversed-${crypto.randomUUID()}`, event_type: "CHECKOUT.PAYMENT-APPROVAL.REVERSED", resource: { order_id: orderId, purchase_units: [] } }),
        PAYPAL_WEBHOOK_HEADERS,
      );
      const [stored] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
      assert.equal(stored?.status, "failed");
    });
  });

  it("credits the ledger on PAYMENT.CAPTURE.COMPLETED only after re-fetching and verifying the order server-side", async () => {
    await withPayPal(async () => {
      const { paymentId, orderId } = await bindOrder(515);
      const captureId = `CAP-${orderId}`;
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        if (url.endsWith("/v1/notifications/verify-webhook-signature")) return response({ verification_status: "SUCCESS" });
        if (url.includes(`/v2/checkout/orders/${orderId}`)) {
          return response({ id: orderId, purchase_units: [{ payments: { captures: [{ id: captureId, status: "COMPLETED", amount: { value: "5.15", currency_code: "USD" } }] } }] });
        }
        throw new Error(`Unexpected PayPal request: ${url}`);
      });
      const eventId = `evt-completed-${crypto.randomUUID()}`;
      const body = paypalWebhookBody({ id: eventId, event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: captureId, supplementary_data: { related_ids: { order_id: orderId } } } });
      const first = await verifyAndProcessPayPalWebhook(body, PAYPAL_WEBHOOK_HEADERS);
      assert.equal(first.payment?.status, "succeeded");
      const duplicate = await verifyAndProcessPayPalWebhook(body, PAYPAL_WEBHOOK_HEADERS);
      assert.equal(duplicate.duplicate, true);
      const ledger = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.paymentId, paymentId));
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0]?.amountCents, 515);
    });
  });
});

describe("PayPal capture verification", { concurrency: false }, () => {
  it("marks the payment for reconciliation when PayPal's captured amount does not match the checkout amount", async () => {
    await withPayPal(async () => {
      const { paymentId, orderId } = await bindOrder(520);
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        if (url.includes(`/v2/checkout/orders/${orderId}/capture`)) {
          return response({ id: orderId, purchase_units: [{ payments: { captures: [{ id: `CAP-${orderId}`, status: "COMPLETED", amount: { value: "9.99", currency_code: "USD" } }] } }] });
        }
        throw new Error(`Unexpected PayPal request: ${url}`);
      });
      await assert.rejects(() => capturePayPalOrder(paymentId, orderId), /reconciliation/i);
      const [stored] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
      assert.equal(stored?.status, "requires_reconciliation");
    });
  });

  it("marks the payment for reconciliation when PayPal's captured currency does not match the checkout currency", async () => {
    await withPayPal(async () => {
      const { paymentId, orderId } = await bindOrder(521);
      setPayPalFetchForTests(async (url) => {
        if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
        if (url.includes(`/v2/checkout/orders/${orderId}/capture`)) {
          return response({ id: orderId, purchase_units: [{ payments: { captures: [{ id: `CAP-${orderId}`, status: "COMPLETED", amount: { value: "5.21", currency_code: "EUR" } }] } }] });
        }
        throw new Error(`Unexpected PayPal request: ${url}`);
      });
      await assert.rejects(() => capturePayPalOrder(paymentId, orderId), /reconciliation/i);
      const [stored] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
      assert.equal(stored?.status, "requires_reconciliation");
    });
  });

  it("rejects the capture when PayPal's payee does not match the configured merchant account", async () => {
    await withPayPal(async () => {
      const savedMerchant = process.env.PAYPAL_MERCHANT_ID;
      process.env.PAYPAL_MERCHANT_ID = "expected-merchant";
      try {
        const { paymentId, orderId } = await bindOrder(522);
        setPayPalFetchForTests(async (url) => {
          if (url.endsWith("/v1/oauth2/token")) return response({ access_token: "token" });
          if (url.includes(`/v2/checkout/orders/${orderId}/capture`)) {
            return response({ id: orderId, purchase_units: [{ payee: { merchant_id: "someone-elses-merchant" }, payments: { captures: [{ id: `CAP-${orderId}`, status: "COMPLETED", amount: { value: "5.22", currency_code: "USD" } }] } }] });
          }
          throw new Error(`Unexpected PayPal request: ${url}`);
        });
        await assert.rejects(() => capturePayPalOrder(paymentId, orderId), /does not match the configured merchant/i);
        // Merchant mismatch is rejected before finalize() runs, so the local
        // payment must remain untouched -- no accidental partial credit.
        const [stored] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
        assert.equal(stored?.status, "pending");
        const ledger = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.paymentId, paymentId));
        assert.equal(ledger.length, 0);
      } finally {
        if (savedMerchant === undefined) delete process.env.PAYPAL_MERCHANT_ID; else process.env.PAYPAL_MERCHANT_ID = savedMerchant;
      }
    });
  });
});

describe("public management-link owner bid increases", { concurrency: false }, () => {
  let server: Server;
  let baseUrl = "";
  const managementToken = `manage-token-test-${crypto.randomUUID()}`;
  let manageListingId = "";

  before(async () => {
    const app = createApp({});
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    manageListingId = `manage-bid-test-${crypto.randomUUID()}`;
    await db.insert(listingsTable).values({
      id: manageListingId,
      ownerId: null,
      ownerEmail: `manage-bid-${crypto.randomUUID()}@example.test`,
      name: "Manage-link bid test listing",
      slug: manageListingId,
      tagline: "test",
      description: "test",
      category: "AI",
      initials: "MB",
      accent: "coral",
      managementTokenHash: createHash("sha256").update(managementToken).digest("hex"),
      managementTokenExpiresAt: new Date(Date.now() + 60_000),
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const payments = await db.select({ id: paymentsTable.id }).from(paymentsTable).where(eq(paymentsTable.listingId, manageListingId));
    for (const payment of payments) {
      // A completed checkout schedules its invoice delivery as an un-awaited
      // background task, so a delivery row can still be inserting when this
      // hook runs; retry the delete a few times to let it settle instead of
      // racing it into a foreign-key violation.
      for (let attempt = 0; attempt < 5; attempt++) {
        const invoiceRows = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.paymentId, payment.id));
        for (const invoice of invoiceRows) {
          await db.delete(invoiceEmailDeliveriesTable).where(eq(invoiceEmailDeliveriesTable.invoiceId, invoice.id));
        }
        try {
          await db.delete(invoicesTable).where(eq(invoicesTable.paymentId, payment.id));
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      await db.delete(paymentEventsTable).where(eq(paymentEventsTable.paymentId, payment.id));
      await db.delete(paymentReceiptsTable).where(eq(paymentReceiptsTable.paymentId, payment.id));
    }
    await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.listingId, manageListingId));
    await db.delete(paymentsTable).where(eq(paymentsTable.listingId, manageListingId));
    await db.delete(listingsTable).where(eq(listingsTable.id, manageListingId));
  });

  // This is a regression test for a bug where the private "manage your
  // listing" link (emailed to owners, requiring no PayPal payment adapter)
  // let anyone holding that link raise their own owner bid for free via
  // signalrank.ts's PATCH /public/manage/:token route, because -- unlike
  // every other owner-bid-increase route in the codebase -- it never checked
  // isLivePaymentsEnabled() before completing the bid through the internal
  // free "test" checkout path. Once real PayPal payments are live, this
  // route must refuse to move ranking power without a real payment, exactly
  // like the other three owner-bid-increase call sites already do.
  it("refuses to raise an owner bid for free through the private management link once live payments are enabled", async () => {
    const saved = { mode: process.env.PAYMENT_MODE, enabled: process.env.PAYMENTS_LIVE_ENABLED };
    process.env.PAYMENT_MODE = "live";
    process.env.PAYMENTS_LIVE_ENABLED = "true";
    try {
      const res = await fetch(`${baseUrl}/api/public/manage/${managementToken}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: baseUrl, "Idempotency-Key": `manage-bid-live-${crypto.randomUUID()}` },
        body: JSON.stringify({ name: "Manage-link bid test listing", tagline: "test", description: "test", category: "AI", ownerBid: 50 }),
      });
      assert.equal(res.status, 409);
      const ledger = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.listingId, manageListingId));
      assert.equal(ledger.length, 0, "no free ledger entry should be created while live payments are enabled");
    } finally {
      if (saved.mode === undefined) delete process.env.PAYMENT_MODE; else process.env.PAYMENT_MODE = saved.mode;
      if (saved.enabled === undefined) delete process.env.PAYMENTS_LIVE_ENABLED; else process.env.PAYMENTS_LIVE_ENABLED = saved.enabled;
    }
  });

  it("still allows the free sandbox bid increase through the private management link while live payments are disabled", async () => {
    const saved = { mode: process.env.PAYMENT_MODE, enabled: process.env.PAYMENTS_LIVE_ENABLED };
    process.env.PAYMENT_MODE = "sandbox";
    process.env.PAYMENTS_LIVE_ENABLED = "false";
    try {
      const res = await fetch(`${baseUrl}/api/public/manage/${managementToken}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: baseUrl, "Idempotency-Key": `manage-bid-sandbox-${crypto.randomUUID()}` },
        body: JSON.stringify({ name: "Manage-link bid test listing", tagline: "test", description: "test", category: "AI", ownerBid: 50 }),
      });
      assert.equal(res.status, 200);
      const ledger = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.listingId, manageListingId));
      assert.equal(ledger.length, 1);
    } finally {
      if (saved.mode === undefined) delete process.env.PAYMENT_MODE; else process.env.PAYMENT_MODE = saved.mode;
      if (saved.enabled === undefined) delete process.env.PAYMENTS_LIVE_ENABLED; else process.env.PAYMENTS_LIVE_ENABLED = saved.enabled;
    }
  });
});
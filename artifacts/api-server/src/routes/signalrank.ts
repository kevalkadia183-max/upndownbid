import { createHash, createHmac, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import {
  ArchiveMyListingParams,
  ArchivePublicManagedListingParams,
  CreatePublicActionCheckoutBody,
  CreatePublicActionCheckoutParams,
  CreatePublicActionCheckoutResponse,
  CreatePublicListingCheckoutBody,
  CreatePublicListingCheckoutResponse,
  CreatePublicReviewBody,
  CreatePublicReviewParams,
  CreatePublicReviewResponse,
  CreateListingBody,
  CreateListingResponse,
  RecordDemoViewResponse,
  RecordDemoViewBody,
  RecordDemoViewParams,
  RecordSpotlightImpressionResponse,
  RecordSpotlightImpressionBody,
  RecordSpotlightImpressionParams,
  GetPublicManagedListingParams,
  GetPublicManagedListingResponse,
  GetMyListingsResponse,
  GetMyProfileResponse,
  GetMyTransactionsResponse,
  GetPublicAnalyticsResponse,
  GetPublicPaymentEnvironmentResponse,
  GetTop4BoardResponse,
  RecordAnalyticsVisitBody,
  ReplyToOwnedListingReviewBody,
  ReplyToOwnedListingReviewParams,
  ReplyToOwnedListingReviewResponse,
  GetActivityResponse,
  GetListingParams,
  GetListingResponse,
  GetListingsQueryParams,
  GetListingsResponse,
  PenalizeListingBody,
  PenalizeListingParams,
  PenalizeListingResponse,
  PlaceCampaignBidResponse,
  RemoveReviewVoteParams,
  RemoveReviewVoteResponse,
  RemovePublicReviewVoteParams,
  RemovePublicReviewVoteResponse,
  SupportListingBody,
  SupportListingParams,
  SupportListingResponse,
  PreviewPublicListingBody,
  PreviewPublicListingResponse,
  UpdatePublicManagedListingBody,
  UpdatePublicManagedListingParams,
  UpdatePublicManagedListingResponse,
  UpdateMyListingBody,
  UpdateMyListingParams,
  UpdateMyListingResponse,
  UpdateMyProfileBody,
  UpdateMyProfileResponse,
  RequestMyListingLogoUploadUrlBody,
  RequestMyListingLogoUploadUrlParams,
  RequestMyListingLogoUploadUrlResponse,
  RequestPublicManagedListingLogoUploadUrlBody,
  RequestPublicManagedListingLogoUploadUrlParams,
  RequestPublicManagedListingLogoUploadUrlResponse,
  VotePublicReviewParams,
  VotePublicReviewResponse,
  VoteReviewParams,
  VoteReviewResponse,
} from "@workspace/api-zod";
import {
  db,
  campaignsTable,
  campaignWinnersTable,
  campaignListingsTable,
  ledgerEntriesTable,
  listingClicksTable,
  listingDemoViewsTable,
  listingSpotlightImpressionsTable,
  listingsTable,
  paymentsTable,
  reviewVotesTable,
  reviewsTable,
  siteVisitsTable,
  usersTable,
  type LedgerEntry,
  type Listing,
  type Payment,
  type Review,
  type User,
} from "@workspace/db";
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  enforceActionRateLimit,
  getRequestActor,
  requireActiveActor,
} from "../lib/moderation";
import { ensureSignalRankSeed } from "../lib/signalrank-seed";
import { ensureCurrentCampaign } from "../lib/campaigns";
import { accentFrom, isValidHexColor } from "../lib/accent-colors";
import {
  createAndCompleteTestCheckout,
  createAndCompleteTestCheckoutInTransaction,
  createCheckout,
  createPayPalCheckout,
  getPaymentProviderStatus,
  isLivePaymentsEnabled,
  isPayPalCheckoutEnabled,
  paymentEnvironment,
  PaymentError,
  type CheckoutInput,
  type PendingListingDraft,
} from "../lib/payments";
import { triggerInvoiceDeliveryForPayment } from "../lib/invoices";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// logoUrl is only ever accepted once it points at an object this same
// server minted an upload URL for -- never an arbitrary external URL --
// so a listing can't be pointed at someone else's asset or a non-storage
// origin.
function isValidLogoObjectPath(value: string): boolean {
  return /^\/objects\/[A-Za-z0-9/_-]+$/.test(value);
}

router.use(async (_req, _res, next) => {
  await ensureSignalRankSeed();
  next();
});

type PublicCheckout = {
  payment: Payment;
  checkoutUrl?: string;
};

async function createPublicCheckout(
  input: CheckoutInput,
): Promise<PublicCheckout> {
  if (isPayPalCheckoutEnabled()) {
    return createPayPalCheckout(input);
  }
  if (isLivePaymentsEnabled()) {
    return { payment: await createCheckout(input) };
  }
  return { payment: await createAndCompleteTestCheckout(input) };
}

function publicPaymentReceipt(payment: Payment, checkoutUrl?: string) {
  return {
    id: payment.id,
    status: payment.status,
    receiptNumber: payment.receiptNumber,
    environment: paymentEnvironment(payment),
    ...(checkoutUrl ? { checkoutUrl } : {}),
  };
}

const publicWebsiteUrlPattern =
  /^(?:https?:\/\/)?[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::(?:[0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?(?:[/?#][^\s]*)?$/;
const publicEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const minimumPublicCampaignBidCents = 500;
const publicEmail = z.string().trim().toLowerCase().max(320).regex(publicEmailPattern);
const publicUrl = z.string().trim().max(2048).regex(publicWebsiteUrlPattern);
const publicCreateListingBody = z.object({
  websiteUrl: publicUrl,
  category: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  tagline: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2000),
  ownerBid: z.coerce.number().int().min(1).max(100000),
  email: publicEmail,
  ownerName: z.string().trim().max(80).optional(),
});
const publicActionBody = z.object({
  amount: z.coerce.number().int().min(1).max(10000),
  email: publicEmail,
  reason: z.string().trim().max(120).optional(),
  reasonDescription: z.string().trim().max(120).optional(),
});
const publicCampaignBidBody = z.object({
  websiteUrl: publicUrl,
  category: z.string().trim().min(1).max(80),
  ownerBid: z.coerce.number().int().min(1).max(100000),
  email: publicEmail,
  ownerName: z.string().trim().min(2).max(80).optional(),
  demoVideoUrl: publicUrl.optional(),
  accent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
const publicReviewBody = z.object({
  anonymous: z.boolean().default(true),
  displayName: z.string().trim().min(2).max(80).optional(),
  rating: z.coerce.number().int().min(1).max(5).default(5),
  reason: z.string().trim().min(1).max(120),
  body: z.string().trim().max(1000).default(""),
});
const publicManagementUpdateBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  tagline: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  websiteUrl: publicUrl.nullish(),
  ownerBid: z.coerce.number().int().min(1).max(100000).optional(),
  demoVideoUrl: publicUrl.nullish(),
  logoUrl: z.string().trim().max(500).nullish(),
});
const publicReviewIdParams = z.object({ id: z.string().uuid() });
const pushDownReasons = [
  "Bug",
  "UI / UX",
  "Performance",
  "Missing / broken feature",
  "I’m a competitor",
  "Just for fun",
  "Other",
] as const;
type PushDownReason = (typeof pushDownReasons)[number];

type PublicListing = ReturnType<typeof toPublicListing>;

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

function timestamp(value: Date): string {
  return value.toISOString();
}

function netEntries(
  entries: LedgerEntry[],
  type: "OWNER_BID" | "COMMUNITY_BID" | "PENALTY",
): LedgerEntry[] {
  const refundByLedgerId = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type === "REFUND" && entry.refundOfLedgerEntryId) {
      refundByLedgerId.set(
        entry.refundOfLedgerEntryId,
        (refundByLedgerId.get(entry.refundOfLedgerEntryId) ?? 0) + entry.amountCents,
      );
    }
  }
  return entries
    .filter((entry) => entry.type === type)
    .map((entry) => ({
      ...entry,
      amountCents: Math.max(
        0,
        entry.amountCents - (refundByLedgerId.get(entry.id) ?? 0),
      ),
    }))
    .filter((entry) => entry.amountCents > 0);
}

function netAmount(
  entries: LedgerEntry[],
  type: "OWNER_BID" | "COMMUNITY_BID" | "PENALTY",
): number {
  return netEntries(entries, type).reduce(
    (total, entry) => total + entry.amountCents,
    0,
  );
}

function asPushDownReason(value: string | null | undefined): PushDownReason | null {
  if (!value) return null;
  const match = pushDownReasons.find(
    (reason) => value === reason || value.startsWith(`${reason}:`),
  );
  return match ?? null;
}

function publicReview(
  review: Review,
  entries: LedgerEntry[],
  helpfulCount = 0,
) {
  const entry = entries.find((item) => item.id === review.ledgerEntryId);
  return {
    id: review.id,
    kind: review.kind === "penalty" ? "penalty" : "support",
    author: review.displayName,
    amount: dollars(entry?.amountCents ?? 0),
    rating: review.rating,
    reason: review.reason,
    body: review.body,
    createdAt: timestamp(review.createdAt),
    helpfulCount,
    ownerReply:
      review.ownerReply && review.ownerReplyAuthor && review.ownerReplyAt
        ? {
            author: review.ownerReplyAuthor,
            body: review.ownerReply,
            createdAt: timestamp(review.ownerReplyAt),
          }
        : null,
  };
}

async function completeOwnerBidAtTarget(input: {
  listingId: string;
  campaignId: string;
  userId: string | null;
  targetBidCents: number;
  reason: string;
  receiptEmail?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  listing: Listing;
  currentOwnerBidCents: number;
  payment: Awaited<ReturnType<typeof createAndCompleteTestCheckout>> | null;
}> {
  const result = await db.transaction(async (tx) => {
    const [listing] = await tx
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.id, input.listingId))
      .limit(1)
      .for("no key update");
    if (!listing) throw new Error("Listing not found while completing owner bid");

    const entries = await tx
      .select()
      .from(ledgerEntriesTable)
      .where(
        and(
          eq(ledgerEntriesTable.listingId, input.listingId),
          eq(ledgerEntriesTable.campaignId, input.campaignId),
          inArray(ledgerEntriesTable.status, ["sandbox_verified", "verified"]),
        ),
      );
    const currentOwnerBidCents = netAmount(entries, "OWNER_BID");
    const [replayedPayment] = await tx
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (replayedPayment) {
      const recordedTargetBidCents =
        replayedPayment.metadata &&
        typeof replayedPayment.metadata === "object" &&
        typeof (replayedPayment.metadata as Record<string, unknown>)
          .ownerBidTargetCents === "number"
          ? (replayedPayment.metadata as Record<string, unknown>)
              .ownerBidTargetCents
          : undefined;
      if (
        replayedPayment.listingId !== input.listingId ||
        replayedPayment.campaignId !== input.campaignId ||
        replayedPayment.userId !== input.userId ||
        replayedPayment.type !== "OWNER_BID" ||
        replayedPayment.reason !== input.reason ||
        replayedPayment.receiptEmail !== (input.receiptEmail ?? null) ||
        (recordedTargetBidCents !== undefined &&
          recordedTargetBidCents !== input.targetBidCents)
      ) {
        throw new PaymentError(
          "Idempotency-Key was already used for a different owner bid request",
          409,
        );
      }
      return { listing, currentOwnerBidCents, payment: replayedPayment };
    }
    if (input.targetBidCents <= currentOwnerBidCents) {
      return { listing, currentOwnerBidCents, payment: null };
    }

    // Every owner-bid path locks the listing before deriving this delta. The
    // payment, verified ledger entry, and cached owner total commit together
    // before this lock is released, so later targets use the verified total.
    const payment = await createAndCompleteTestCheckoutInTransaction(tx, {
      listingId: input.listingId,
      campaignId: input.campaignId,
      userId: input.userId,
      type: "OWNER_BID",
      amountCents: input.targetBidCents - currentOwnerBidCents,
      reason: input.reason,
      receiptEmail: input.receiptEmail,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        ...input.metadata,
        ownerBidTargetCents: input.targetBidCents,
      },
    });
    const [updated] = await tx
      .update(listingsTable)
      .set({ ownerBidCents: input.targetBidCents })
      .where(eq(listingsTable.id, input.listingId))
      .returning();
    return {
      listing: updated ?? listing,
      currentOwnerBidCents,
      payment,
    };
  });
  // Only after this function's own transaction has committed -- the payment
  // row (and its invoice, created atomically alongside it) is now visible
  // outside the transaction. Idempotent: a replayed idempotency key that
  // didn't just newly succeed is a safe no-op here.
  if (result.payment?.status === "succeeded") triggerInvoiceDeliveryForPayment(result.payment.id);
  return result;
}

function toPublicListing(
  listing: Listing,
  entries: LedgerEntry[],
  reviews: Review[],
  rank: number,
  clickStats: { totalClicks: number; uniqueClicks: number } = {
    totalClicks: 0,
    uniqueClicks: 0,
  },
) {
  const supportEntries = netEntries(entries, "COMMUNITY_BID");
  const penaltyEntries = netEntries(entries, "PENALTY");
  const ownerBidCents = netAmount(entries, "OWNER_BID");
  const communitySupportCents = netAmount(entries, "COMMUNITY_BID");
  const penaltyCents = netAmount(entries, "PENALTY");
  const publishedReviews = reviews.filter((review) => review.status === "published");
  const rating =
    publishedReviews.length === 0
      ? 0
      : Math.round(
          (publishedReviews.reduce((total, review) => total + review.rating, 0) /
            publishedReviews.length) *
            10,
        ) / 10;

  return {
    id: listing.id,
    name: listing.name,
    slug: listing.slug,
    tagline: listing.tagline,
    description: listing.description,
    category: listing.category,
    initials: listing.initials,
    accent: listing.accent,
    rank,
    effectiveBid: dollars(
      ownerBidCents + communitySupportCents - penaltyCents,
    ),
    ownerBid: dollars(ownerBidCents),
    communitySupport: dollars(communitySupportCents),
    penalties: dollars(penaltyCents),
    supporters: new Set(supportEntries.map((entry) => entry.userId ?? entry.id))
      .size,
    penalizers: new Set(penaltyEntries.map((entry) => entry.userId ?? entry.id))
      .size,
    rating,
    reviewCount: publishedReviews.length,
    clicks: listing.clicks,
    clickAnalytics: {
      totalClicks: clickStats.totalClicks,
      uniqueClicks: clickStats.uniqueClicks,
    },
    createdAt: timestamp(listing.createdAt),
    trend: supportEntries.length - penaltyEntries.length,
    websiteUrl: listing.websiteUrl ?? null,
    demoVideoUrl: listing.demoVideoUrl ?? null,
    demoViewCount: listing.demoViewCount,
    logoUrl: listing.logoUrl ?? null,
  };
}

// The subset of a member's profile that is safe to show on a public listing
// page. Deliberately excludes email, role/status, and every other
// account-internal field returned by memberProfile().
function publicOwnerProfile(owner: User) {
  return {
    displayName: owner.displayName,
    photoUrl: owner.photoUrl ?? null,
    bio: owner.bio ?? null,
    company: owner.company ?? null,
    profileRole: owner.profileRole ?? null,
    socialLinks: owner.socialLinks ?? null,
    website: owner.website ?? null,
    location: owner.location ?? null,
  };
}

function initialsFrom(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 3);
}

function slugFrom(name: string): string {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 64) || "listing";
}

function normalizedWebsiteUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.port = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

// Result marker distinguishes "left blank" (null) from "typed something that
// isn't a usable http(s) URL" (invalid) -- the caller needs that distinction
// to reject the latter with a clear error instead of silently storing
// garbage or a dangerous scheme like `javascript:`.
type ProfileUrlResult = { ok: true; value: string | null } | { ok: false };

// Used for member-profile `photoUrl` / `website` fields. Unlike
// normalizedWebsiteUrl (used for listing destinations), this does not
// rewrite the hostname or path -- a profile photo URL's exact host/path is
// often load-bearing (e.g. a CDN link), so only the scheme is normalized.
function normalizedProfileUrl(value: string | null | undefined): ProfileUrlResult {
  const trimmed = value?.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    const url = new URL(/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!["http:", "https:"].includes(url.protocol)) return { ok: false };
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false };
  }
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function publicVisitorKey(req: Request): string {
  return `guest:${hashSecret(`${req.ip}|${req.get("user-agent") ?? ""}`).slice(0, 48)}`;
}

function idempotencyKey(req: Request): string | null {
  const value = req.get("Idempotency-Key")?.trim();
  return value && value.length <= 255 ? value : null;
}

function publicManagePath(token: string): string {
  return `/manage/${token}`;
}

function managementTokenForIdempotency(key: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to create secure management links");
  }
  return createHmac("sha256", secret)
    .update(`upndownbid:listing-management:${key}`)
    .digest("base64url");
}

async function managedListing(token: string): Promise<Listing | null> {
  const [listing] = await db
    .select()
    .from(listingsTable)
    .where(
      and(
        eq(listingsTable.managementTokenHash, hashSecret(token)),
        isNull(listingsTable.managementTokenRevokedAt),
        gt(listingsTable.managementTokenExpiresAt, new Date()),
      ),
    )
    .limit(1);
  return listing ?? null;
}

async function projectedRank(ownerBidCents: number): Promise<{
  rank: number;
  currentTop: number;
  toReachTop: number;
}> {
  const ranked = await rankedListings();
  const values = ranked.listings.map((listing) => Math.round(listing.effectiveBid * 100));
  const higher = values.filter((value) => value > ownerBidCents).length;
  const currentTop = values[0] ?? 0;
  return {
    rank: higher + 1,
    currentTop: dollars(currentTop),
    toReachTop: dollars(Math.max(ownerBidCents, currentTop) + 100),
  };
}

async function nextSlug(name: string): Promise<string> {
  const base = slugFrom(name);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const [existing] = await db
      .select({ id: listingsTable.id })
      .from(listingsTable)
      .where(eq(listingsTable.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

// Builds the draft stashed on a deferred-creation payment's metadata. The id
// and slug are candidates chosen now (so management links and the pending
// response can reference them) but the row itself is only ever inserted by
// payments.ts's finalize() once the payment succeeds -- see PendingListingDraft.
async function buildPendingListingDraft(input: {
  name: string;
  tagline: string;
  description: string;
  category: string;
  websiteUrl: string;
  demoVideoUrl?: string | null;
  ownerId: string | null;
  ownerEmail: string;
  ownerName: string | null;
  managementToken: string;
  // Owner-chosen brand color, already validated by the caller with
  // isValidHexColor -- falls back to the hash-derived palette color when
  // omitted so every listing still gets a valid accent.
  accent?: string;
}): Promise<PendingListingDraft> {
  return {
    id: randomUUID(),
    slug: await nextSlug(input.name),
    name: input.name,
    tagline: input.tagline,
    description: input.description,
    category: input.category,
    initials: initialsFrom(input.name),
    accent: input.accent ?? accentFrom(input.name),
    websiteUrl: input.websiteUrl,
    demoVideoUrl: input.demoVideoUrl ?? null,
    ownerId: input.ownerId,
    ownerEmail: input.ownerEmail,
    ownerName: input.ownerName,
    managementTokenHash: hashSecret(input.managementToken),
    managementTokenExpiresAt: new Date(
      Date.now() + 1000 * 60 * 60 * 24 * 90,
    ).toISOString(),
  };
}

// Renders a not-yet-persisted draft as a Listing-shaped object purely for
// building a "pending checkout" preview response -- this is never written to
// the database. Field values mirror what finalize() will actually insert.
function previewListingFromDraft(draft: PendingListingDraft): Listing {
  const now = new Date();
  return {
    id: draft.id,
    ownerId: draft.ownerId,
    ownerEmail: draft.ownerEmail,
    ownerName: draft.ownerName,
    creationPaymentId: null,
    managementTokenHash: draft.managementTokenHash,
    managementTokenExpiresAt: new Date(draft.managementTokenExpiresAt),
    managementTokenRevokedAt: null,
    name: draft.name,
    slug: draft.slug,
    tagline: draft.tagline,
    description: draft.description,
    category: draft.category,
    initials: draft.initials,
    accent: draft.accent,
    websiteUrl: draft.websiteUrl,
    demoVideoUrl: draft.demoVideoUrl,
    logoUrl: null,
    status: "active",
    moderationStatus: "active",
    moderationReason: null,
    moderatedAt: null,
    moderatedById: null,
    ownerBidCents: 0,
    clicks: 0,
    demoViewCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function pendingListingDraftFrom(payment: Payment): PendingListingDraft | null {
  const draft = (payment.metadata as Record<string, unknown> | null)
    ?.pendingListing;
  return draft && typeof draft === "object"
    ? (draft as PendingListingDraft)
    : null;
}

function memberListing(
  listing: Listing,
  entries: LedgerEntry[],
  reviews: Review[],
  rankById: Map<string, PublicListing>,
  helpfulVotes: Array<{ reviewId: string }> = [],
) {
  const publicListing =
    rankById.get(listing.id) ??
    toPublicListing(
      listing,
      entries.filter((entry) => entry.listingId === listing.id),
      reviews.filter((review) => review.listingId === listing.id),
      0,
    );
  return {
    ...publicListing,
    ownerId: listing.ownerId ?? "",
    status: listing.status === "active" ? "active" : "archived",
    feedback: reviews
      .filter(
        (review) =>
          review.listingId === listing.id && review.status === "published",
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((review) =>
        publicReview(
          review,
          entries,
          helpfulVotes.filter((vote) => vote.reviewId === review.id).length,
        ),
      ),
  };
}

async function memberProfile(actor: User) {
  const [ownedListings, transactions] = await Promise.all([
    db
      .select({ id: listingsTable.id })
      .from(listingsTable)
      .where(eq(listingsTable.ownerId, actor.id)),
    db
      .select({ id: ledgerEntriesTable.id })
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.userId, actor.id)),
  ]);
  return {
    id: actor.id,
    email: actor.email ?? null,
    displayName: actor.displayName,
    photoUrl: actor.photoUrl ?? null,
    bio: actor.bio ?? null,
    company: actor.company ?? null,
    profileRole: actor.profileRole ?? null,
    socialLinks: actor.socialLinks ?? null,
    website: actor.website ?? null,
    location: actor.location ?? null,
    role: ["moderator", "admin"].includes(actor.role) ? actor.role : "member",
    status: actor.status === "suspended" ? "suspended" : "active",
    createdAt: timestamp(actor.createdAt),
    updatedAt: timestamp(actor.updatedAt),
    listingsCount: ownedListings.length,
    transactionsCount: transactions.length,
  };
}

async function rankedListings(): Promise<{
  listings: PublicListing[];
  entries: LedgerEntry[];
  reviews: Review[];
  campaign: Awaited<ReturnType<typeof ensureCurrentCampaign>>;
}> {
  await ensureSignalRankSeed();
  const campaign = await ensureCurrentCampaign();
  const [[listings, entries, reviews], clickAgg, inactiveUserRows] = await Promise.all([
    db.transaction(async (tx) => {
      // A repeatable, read-only snapshot prevents rankings from combining
      // listings from one instant with payment ledger rows from another.
      await tx.execute(
        sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`,
      );
      // A transaction has one PostgreSQL client, so its queries must remain
      // sequential even though the surrounding request can serve in parallel.
      const listings = await tx
        .select()
        .from(listingsTable)
        .where(eq(listingsTable.status, "active"));
      const entries = await tx
        .select()
        .from(ledgerEntriesTable)
        .where(
          and(
            eq(ledgerEntriesTable.campaignId, campaign.id),
            inArray(ledgerEntriesTable.status, ["sandbox_verified", "verified"]),
          ),
        );
      const reviews = await tx
        .select()
        .from(reviewsTable)
        .where(eq(reviewsTable.campaignId, campaign.id));
      return [listings, entries, reviews] as const;
    }),
    // Click analytics live in their own table and are not part of the
    // ranking snapshot, so this can run on a separate connection in parallel.
    db
      .select({
        listingId: listingClicksTable.listingId,
        totalClicks: sql<string>`count(*)`,
        uniqueClicks: sql<string>`count(distinct ${listingClicksTable.visitorHash})`,
      })
      .from(listingClicksTable)
      .groupBy(listingClicksTable.listingId),
    // A review authored by a since-banned/suspended user must not keep
    // counting toward a listing's public rating or review count, mirroring
    // the active-user scoping already applied to /analytics/public. Ledger
    // entries (bids/penalties) are intentionally left unscoped here: they
    // drive the campaign's effective-bid ranking, which must stay identical
    // to the verified-payment totals the weekly rollover (closeCampaign)
    // finalizes, regardless of a bidder's later account status.
    db.select({ id: usersTable.id }).from(usersTable).where(ne(usersTable.status, "active")),
  ]);
  const clickStatsById = new Map(
    clickAgg.map((row) => [
      row.listingId,
      { totalClicks: Number(row.totalClicks), uniqueClicks: Number(row.uniqueClicks) },
    ]),
  );
  const inactiveUserIds = new Set(inactiveUserRows.map((row) => row.id));
  const activeReviews = reviews.filter(
    (review) => !review.userId || !inactiveUserIds.has(review.userId),
  );

  const byEffectiveBid = listings
    .map((listing) => ({
      listing,
      entries: entries.filter((entry) => entry.listingId === listing.id),
      reviews: activeReviews.filter(
        (review) =>
          review.listingId === listing.id && review.status === "published",
      ),
    }))
    .filter((item) => netAmount(item.entries, "OWNER_BID") >= campaign.minimumBidCents)
    .sort((a, b) => {
      const aValue =
        netAmount(a.entries, "OWNER_BID") +
        netAmount(a.entries, "COMMUNITY_BID") -
        netAmount(a.entries, "PENALTY");
      const bValue =
        netAmount(b.entries, "OWNER_BID") +
        netAmount(b.entries, "COMMUNITY_BID") -
        netAmount(b.entries, "PENALTY");
      if (bValue !== aValue) return bValue - aValue;
      const aReached =
        a.entries
          .filter((entry) => entry.type === "OWNER_BID" || entry.type === "COMMUNITY_BID")
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
          .at(-1)?.createdAt.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bReached =
        b.entries
          .filter((entry) => entry.type === "OWNER_BID" || entry.type === "COMMUNITY_BID")
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
          .at(-1)?.createdAt.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aReached !== bReached) {
        return aReached - bReached;
      }
      return a.listing.createdAt.getTime() - b.listing.createdAt.getTime();
    });

  return {
    listings: byEffectiveBid.map((item, index) =>
      toPublicListing(
        item.listing,
        item.entries,
        item.reviews,
        index + 1,
        clickStatsById.get(item.listing.id),
      ),
    ),
    entries,
    reviews: activeReviews,
    campaign,
  };
}

router.get("/listings", async (req, res): Promise<void> => {
  const query = GetListingsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { listings } = await rankedListings();
  const { search, category, sort } = query.data;
  let result = listings.filter((listing) => {
    const matchesSearch =
      !search ||
      `${listing.name} ${listing.tagline} ${listing.category}`
        .toLowerCase()
        .includes(search.toLowerCase());
    return matchesSearch && (!category || listing.category === category);
  });

  if (sort === "newest") {
    result = [...result].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  } else if (sort === "rating") {
    result = [...result].sort((a, b) => b.rating - a.rating);
  } else if (sort === "supporters") {
    result = [...result].sort((a, b) => b.supporters - a.supporters);
  } else if (sort === "controversial") {
    result = [...result].sort(
      (a, b) =>
        b.supporters + b.penalizers - (a.supporters + a.penalizers),
    );
  }

  res.json(GetListingsResponse.parse(result));
});

router.get("/campaigns/current", async (_req, res): Promise<void> => {
  const campaign = await ensureCurrentCampaign();
  const [lastWinner] = await db
    .select({
      campaignNumber: campaignsTable.number,
      finalEffectiveBidCents: campaignWinnersTable.finalEffectiveBidCents,
      slug: listingsTable.slug,
      name: listingsTable.name,
      initials: listingsTable.initials,
      accent: listingsTable.accent,
    })
    .from(campaignWinnersTable)
    .innerJoin(campaignsTable, eq(campaignWinnersTable.campaignId, campaignsTable.id))
    .innerJoin(listingsTable, eq(campaignWinnersTable.listingId, listingsTable.id))
    .orderBy(desc(campaignsTable.number))
    .limit(1);
  res.json({
    id: campaign.id,
    number: campaign.number,
    status: campaign.status,
    startAt: timestamp(campaign.startAt),
    endAt: timestamp(campaign.endAt),
    minimumBid: dollars(campaign.minimumBidCents),
    timezone: "UTC",
    ...(lastWinner
      ? {
          lastWinner: {
            campaignNumber: lastWinner.campaignNumber,
            name: lastWinner.name,
            slug: lastWinner.slug,
            initials: lastWinner.initials,
            accent: lastWinner.accent,
            effectiveBid: dollars(lastWinner.finalEffectiveBidCents),
          },
        }
      : { lastWinner: null }),
  });
});

// The homepage TOP 4 board. Before any campaign has finished, it mirrors the
// live current-campaign rankings (dynamic — can reorder mid-week). Once a
// campaign has completed, it freezes to that campaign's final top 4 for the
// entire duration of the next campaign; those frozen rows come from
// campaign_listings.final_rank, written exactly once by closeCampaign()
// (lib/campaigns.ts) and never recomputed afterward, so a later boost,
// push-down, or claim on the current campaign cannot alter them.
router.get("/campaigns/top4", async (_req, res): Promise<void> => {
  const campaign = await ensureCurrentCampaign();
  const [previousCompleted] = await db
    .select()
    .from(campaignsTable)
    .where(and(eq(campaignsTable.status, "completed"), sql`${campaignsTable.number} < ${campaign.number}`))
    .orderBy(desc(campaignsTable.number))
    .limit(1);

  if (previousCompleted) {
    const standings = await db
      .select({
        rank: campaignListingsTable.finalRank,
        effectiveBidCents: campaignListingsTable.effectiveBidCents,
        ownerBidCents: campaignListingsTable.ownerBidCents,
        id: listingsTable.id,
        name: listingsTable.name,
        slug: listingsTable.slug,
        initials: listingsTable.initials,
        accent: listingsTable.accent,
        websiteUrl: listingsTable.websiteUrl,
        demoVideoUrl: listingsTable.demoVideoUrl,
        logoUrl: listingsTable.logoUrl,
      })
      .from(campaignListingsTable)
      .innerJoin(listingsTable, eq(campaignListingsTable.listingId, listingsTable.id))
      .where(
        and(
          eq(campaignListingsTable.campaignId, previousCompleted.id),
          isNotNull(campaignListingsTable.finalRank),
        ),
      )
      .orderBy(campaignListingsTable.finalRank)
      .limit(4);

    res.json(
      GetTop4BoardResponse.parse({
        mode: "final",
        campaignNumber: previousCompleted.number,
        entries: standings.map((standing) => ({
          rank: standing.rank ?? 0,
          effectiveBid: dollars(standing.effectiveBidCents),
          ownerBid: dollars(standing.ownerBidCents),
          listing: {
            id: standing.id,
            name: standing.name,
            slug: standing.slug,
            initials: standing.initials,
            accent: standing.accent,
            websiteUrl: standing.websiteUrl,
            demoVideoUrl: standing.demoVideoUrl,
            logoUrl: standing.logoUrl ?? null,
          },
        })),
      }),
    );
    return;
  }

  const { listings } = await rankedListings();
  res.json(
    GetTop4BoardResponse.parse({
      mode: "live",
      campaignNumber: campaign.number,
      entries: listings.slice(0, 4).map((listing) => ({
        rank: listing.rank,
        effectiveBid: listing.effectiveBid,
        ownerBid: listing.ownerBid,
        listing: {
          id: listing.id,
          name: listing.name,
          slug: listing.slug,
          initials: listing.initials,
          accent: listing.accent,
          websiteUrl: listing.websiteUrl,
          demoVideoUrl: listing.demoVideoUrl,
          logoUrl: listing.logoUrl ?? null,
        },
      })),
    }),
  );
});

router.get("/analytics/public", async (_req, res): Promise<void> => {
  const [
    visitStats,
    productStats,
    allEntries,
    reviewRows,
    campaignStats,
    activeListingRows,
    inactiveUserRows,
  ] = await Promise.all([
    db
      .select({
        totalVisits: sql<string>`count(*)`,
        uniqueVisitors: sql<string>`count(distinct ${siteVisitsTable.visitorHash})`,
      })
      .from(siteVisitsTable),
    db
      .select({ activeProducts: sql<string>`count(*)` })
      .from(listingsTable)
      .where(eq(listingsTable.status, "active")),
    db
      .select()
      .from(ledgerEntriesTable)
      .where(inArray(ledgerEntriesTable.status, ["sandbox_verified", "verified"])),
    // Raw rows (not a count) so published reviews can be re-scoped in JS to
    // only those belonging to a currently active listing and active user.
    db
      .select({ listingId: reviewsTable.listingId, userId: reviewsTable.userId })
      .from(reviewsTable)
      .where(eq(reviewsTable.status, "published")),
    db
      .select({ completedCampaigns: sql<string>`count(*)` })
      .from(campaignsTable)
      .where(eq(campaignsTable.status, "completed")),
    // The public "marketplace in numbers" widget must only reflect activity
    // tied to a currently active listing and an active (non-suspended) user,
    // so archived/removed listings and banned users never inflate these
    // headline stats. Ledger entries and reviews are scoped against these
    // two id sets below; site visits have no listing/user attribution in the
    // schema, so total visits/unique visitors remain site-wide traffic.
    db.select({ id: listingsTable.id }).from(listingsTable).where(eq(listingsTable.status, "active")),
    db.select({ id: usersTable.id }).from(usersTable).where(ne(usersTable.status, "active")),
  ]);

  const activeListingIds = new Set(activeListingRows.map((row) => row.id));
  const inactiveUserIds = new Set(inactiveUserRows.map((row) => row.id));
  // A record with no user attached (anonymous community action) is treated
  // as active; only a record whose user is explicitly non-active is dropped.
  const isActiveScoped = (listingId: string | null, userId: string | null) =>
    activeListingIds.has(listingId ?? "") && (!userId || !inactiveUserIds.has(userId));

  const scopedEntries = allEntries.filter((entry) =>
    isActiveScoped(entry.listingId, entry.userId),
  );

  const ownerClaims = netEntries(scopedEntries, "OWNER_BID");
  const communityBoosts = netEntries(scopedEntries, "COMMUNITY_BID");
  const pushDowns = netEntries(scopedEntries, "PENALTY");
  const ownerClaimVolume = ownerClaims.reduce((total, entry) => total + entry.amountCents, 0);
  const communityBoostVolume = communityBoosts.reduce(
    (total, entry) => total + entry.amountCents,
    0,
  );
  const totalReviews = reviewRows.filter((row) => isActiveScoped(row.listingId, row.userId)).length;

  res.json(
    GetPublicAnalyticsResponse.parse({
      totalVisits: Number(visitStats[0]?.totalVisits ?? 0),
      uniqueVisitors: Number(visitStats[0]?.uniqueVisitors ?? 0),
      activeProducts: Number(productStats[0]?.activeProducts ?? 0),
      totalBidVolume: dollars(ownerClaimVolume + communityBoostVolume),
      ownerClaimVolume: dollars(ownerClaimVolume),
      communityBoostVolume: dollars(communityBoostVolume),
      totalBoosts: communityBoosts.length,
      totalPushDowns: pushDowns.length,
      totalReviews,
      completedCampaigns: Number(campaignStats[0]?.completedCampaigns ?? 0),
    }),
  );
});

router.post("/analytics/visit", async (req, res): Promise<void> => {
  const body = RecordAnalyticsVisitBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid analytics payload" });
    return;
  }

  const visitorHash = createHash("sha256")
    .update(`upndownbid:visitor:${body.data.visitorId}`)
    .digest("hex");
  const sessionHash = createHash("sha256")
    .update(`upndownbid:session:${body.data.sessionId}`)
    .digest("hex");

  await db
    .insert(siteVisitsTable)
    .values({
      id: randomUUID(),
      visitorHash,
      sessionHash,
      path: body.data.path,
    })
    .onConflictDoNothing();

  res.status(204).end();
});

router.get("/winners", async (_req, res): Promise<void> => {
  const [winners, finalStandings] = await Promise.all([
    db
    .select({
      campaignNumber: campaignsTable.number,
      startAt: campaignsTable.startAt,
      endAt: campaignsTable.endAt,
      finalEffectiveBidCents: campaignWinnersTable.finalEffectiveBidCents,
      declaredAt: campaignWinnersTable.declaredAt,
      listingId: listingsTable.id,
      name: listingsTable.name,
      slug: listingsTable.slug,
      category: listingsTable.category,
      initials: listingsTable.initials,
      accent: listingsTable.accent,
      logoUrl: listingsTable.logoUrl,
    })
    .from(campaignWinnersTable)
    .innerJoin(campaignsTable, eq(campaignWinnersTable.campaignId, campaignsTable.id))
    .innerJoin(listingsTable, eq(campaignWinnersTable.listingId, listingsTable.id))
    .orderBy(desc(campaignsTable.number)),
    db
      .select({
        campaignNumber: campaignsTable.number,
        finalRank: campaignListingsTable.finalRank,
        effectiveBidCents: campaignListingsTable.effectiveBidCents,
        ownerBidCents: campaignListingsTable.ownerBidCents,
        listingId: listingsTable.id,
        name: listingsTable.name,
        slug: listingsTable.slug,
        initials: listingsTable.initials,
        accent: listingsTable.accent,
        logoUrl: listingsTable.logoUrl,
      })
      .from(campaignListingsTable)
      .innerJoin(campaignsTable, eq(campaignListingsTable.campaignId, campaignsTable.id))
      .innerJoin(listingsTable, eq(campaignListingsTable.listingId, listingsTable.id))
      .where(eq(campaignsTable.status, "completed"))
      .orderBy(desc(campaignsTable.number), campaignListingsTable.finalRank),
  ]);
  const standingsByCampaign = new Map<number, typeof finalStandings>();
  for (const standing of finalStandings) {
    const current = standingsByCampaign.get(standing.campaignNumber) ?? [];
    current.push(standing);
    standingsByCampaign.set(standing.campaignNumber, current);
  }
  res.json(
    winners.map((winner) => ({
      campaignNumber: winner.campaignNumber,
      startAt: timestamp(winner.startAt),
      endAt: timestamp(winner.endAt),
      declaredAt: timestamp(winner.declaredAt),
      finalEffectiveBid: dollars(winner.finalEffectiveBidCents),
      listing: {
        id: winner.listingId,
        name: winner.name,
        slug: winner.slug,
        category: winner.category,
        initials: winner.initials,
        accent: winner.accent,
        logoUrl: winner.logoUrl ?? null,
      },
      finalRankings: (standingsByCampaign.get(winner.campaignNumber) ?? []).map((standing) => ({
        rank: standing.finalRank ?? 0,
        effectiveBid: dollars(standing.effectiveBidCents),
        ownerBid: dollars(standing.ownerBidCents),
        listing: {
          id: standing.listingId,
          name: standing.name,
          slug: standing.slug,
          initials: standing.initials,
          accent: standing.accent,
          logoUrl: standing.logoUrl ?? null,
        },
      })),
    })),
  );
});

router.get("/listings/:slug", async (req, res): Promise<void> => {
  const params = GetListingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { listings, entries, reviews } = await rankedListings();
  let listing = listings.find((item) => item.slug === params.data.slug);
  let ownerId: string | null = null;
  if (!listing) {
    const [source] = await db
      .select()
      .from(listingsTable)
      .where(and(eq(listingsTable.slug, params.data.slug), eq(listingsTable.status, "active")))
      .limit(1);
    if (source) {
      ownerId = source.ownerId ?? null;
      listing = toPublicListing(
        source,
        entries.filter((entry) => entry.listingId === source.id),
        reviews.filter((review) => review.listingId === source.id),
        0,
      );
    }
  } else {
    const [source] = await db
      .select({ ownerId: listingsTable.ownerId })
      .from(listingsTable)
      .where(eq(listingsTable.slug, params.data.slug))
      .limit(1);
    ownerId = source?.ownerId ?? null;
  }
  if (!listing) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  let owner: ReturnType<typeof publicOwnerProfile> | null = null;
  if (ownerId) {
    const [ownerUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, ownerId))
      .limit(1);
    if (ownerUser) {
      owner = publicOwnerProfile(ownerUser);
    }
  }

  const votes = await db.select().from(reviewVotesTable);
  const listingReviews = reviews
    .filter(
      (review) =>
        review.listingId === listing.id && review.status === "published",
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((review) =>
      publicReview(
        review,
        entries,
        votes.filter((vote) => vote.reviewId === review.id).length,
      ),
    );
  const transactions = entries
    .filter(
      (entry) =>
        entry.listingId === listing.id &&
        ["OWNER_BID", "COMMUNITY_BID", "PENALTY"].includes(entry.type),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 8)
    .map((entry) => ({
      id: entry.id,
      type:
        entry.type === "PENALTY"
          ? "PENALTY"
          : entry.type === "OWNER_BID"
            ? "OWNER_BID"
            : "COMMUNITY_BID",
      amount: dollars(entry.amountCents),
      status: entry.status,
      createdAt: timestamp(entry.createdAt),
    }));

  const pushDownReasonCounts = Array.from(
    entries
      .filter(
        (entry) =>
          entry.listingId === listing.id &&
          entry.type === "PENALTY" &&
          ["sandbox_verified", "verified"].includes(entry.status),
      )
      .reduce((counts, entry) => {
        const reason = asPushDownReason(entry.reason);
        if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
        return counts;
      }, new Map<PushDownReason, number>())
      .entries(),
  ).map(([reason, count]) => ({ reason, count }));

  res.json(
    GetListingResponse.parse({
      ...listing,
      reviews: listingReviews,
      transactions,
      pushDownReasonCounts,
      owner,
    }),
  );
});

// Public, unauthenticated redirect target for the leaderboard card's domain
// link. Meant for direct browser navigation (an <a href>), not the generated
// API client. The destination is always resolved from the stored listing
// record; a client can never supply or influence the redirect target.
router.get("/listings/:listingId/click", async (req, res): Promise<void> => {
  const params = z.object({ listingId: z.string().trim().min(1) }).safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  const [listing] = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.id, params.data.listingId))
    .limit(1);

  const destination = listing ? normalizedWebsiteUrl(listing.websiteUrl) : null;
  if (!listing || listing.status !== "active" || !destination) {
    res.status(404).json({ error: "Listing not found or has no website" });
    return;
  }

  // Reuses the same anonymous visitor identifier already generated on the
  // client for site-visit analytics (see /analytics/visit), hashed the same
  // way, so a repeat click from the same browser dedupes into one unique
  // click instead of inflating the count.
  const rawVisitorId = typeof req.query.vid === "string" ? req.query.vid.trim().slice(0, 200) : "";
  const visitorHash = createHash("sha256")
    .update(`upndownbid:visitor:${rawVisitorId || randomUUID()}`)
    .digest("hex");

  await db.insert(listingClicksTable).values({
    id: randomUUID(),
    listingId: listing.id,
    visitorHash,
  });

  res.redirect(302, destination);
});

// Public, unauthenticated view-tracking endpoint fired by the frontend when a
// viewer opens a listing's demo video. Deduplicated per anonymous visitor the
// same way as clicks and site visits, so the count is server-authoritative
// and cannot be inflated by repeat requests from one browser.
router.post("/listings/:listingId/demo-view", async (req, res): Promise<void> => {
  const params = RecordDemoViewParams.safeParse(req.params);
  const body = RecordDemoViewBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(404).json({ error: "Listing not found or has no demo video" });
    return;
  }

  const [listing] = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.id, params.data.listingId))
    .limit(1);
  if (!listing || listing.status !== "active" || !listing.demoVideoUrl) {
    res.status(404).json({ error: "Listing not found or has no demo video" });
    return;
  }

  const rawVisitorId = body.data.visitorId?.trim().slice(0, 200) ?? "";
  const visitorHash = createHash("sha256")
    .update(`upndownbid:visitor:${rawVisitorId || randomUUID()}`)
    .digest("hex");

  const [inserted] = await db
    .insert(listingDemoViewsTable)
    .values({ id: randomUUID(), listingId: listing.id, visitorHash })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    res.json(RecordDemoViewResponse.parse({ demoViews: listing.demoViewCount }));
    return;
  }

  const [updated] = await db
    .update(listingsTable)
    .set({ demoViewCount: sql`${listingsTable.demoViewCount} + 1` })
    .where(eq(listingsTable.id, listing.id))
    .returning();
  res.json(RecordDemoViewResponse.parse({ demoViews: updated?.demoViewCount ?? listing.demoViewCount + 1 }));
});

// Public, unauthenticated impression-tracking endpoint fired once when the
// homepage's featured-listing spotlight popup is actually shown to a
// visitor. Unlike demo views, this is intentionally not deduplicated per
// visitor -- the same listing being featured again in a later session is a
// new, meaningful impression, not a repeat of the same one.
router.post("/listings/:listingId/spotlight-impression", async (req, res): Promise<void> => {
  const params = RecordSpotlightImpressionParams.safeParse(req.params);
  const body = RecordSpotlightImpressionBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  const [listing] = await db
    .select({ id: listingsTable.id, status: listingsTable.status })
    .from(listingsTable)
    .where(eq(listingsTable.id, params.data.listingId))
    .limit(1);
  if (!listing || listing.status !== "active") {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  const rawVisitorId = body.data.visitorId?.trim().slice(0, 200) ?? "";
  const visitorHash = createHash("sha256")
    .update(`upndownbid:visitor:${rawVisitorId || randomUUID()}`)
    .digest("hex");

  await db.insert(listingSpotlightImpressionsTable).values({
    id: randomUUID(),
    listingId: listing.id,
    visitorHash,
  });

  res.json(RecordSpotlightImpressionResponse.parse({ recorded: true }));
});

router.post("/public/listings/preview", async (req, res): Promise<void> => {
  const body = z
    .object({ websiteUrl: publicUrl, ownerBid: z.coerce.number().int().min(1).max(100000) })
    .safeParse(req.body);
  const contract = body.success
    ? PreviewPublicListingBody.safeParse(body.data)
    : null;
  if (!body.success || !contract?.success) {
    res.status(400).json({ error: "Enter a valid http or https website URL and opening bid" });
    return;
  }
  const websiteUrl = normalizedWebsiteUrl(body.data.websiteUrl);
  if (!websiteUrl) {
    res.status(400).json({ error: "Website URL must use http or https" });
    return;
  }
  const ranked = await rankedListings();
  const minimumBidCents = Math.max(
    ranked.campaign.minimumBidCents,
    minimumPublicCampaignBidCents,
  );
  if (Math.round(body.data.ownerBid * 100) < minimumBidCents) {
    res.status(400).json({
      error: `The opening bid for Campaign #${ranked.campaign.number} must be at least ${dollars(minimumBidCents)} USD`,
    });
    return;
  }
  const duplicate = ranked.listings.find(
    (listing) => normalizedWebsiteUrl(listing.websiteUrl) === websiteUrl,
  );
  if (duplicate) {
    res.json(PreviewPublicListingResponse.parse({ duplicate, canonicalUrl: websiteUrl }));
    return;
  }
  res.json(PreviewPublicListingResponse.parse({
    canonicalUrl: websiteUrl,
    ...(await projectedRank(Math.round(body.data.ownerBid * 100))),
  }));
});

router.post("/public/campaign-bids", async (req, res): Promise<void> => {
  const body = publicCampaignBidBody.safeParse(req.body);
  const requestKey = idempotencyKey(req);
  if (!body.success || !requestKey) {
    res.status(400).json({ error: "A valid URL, category, email, and Idempotency-Key are required" });
    return;
  }
  const websiteUrl = normalizedWebsiteUrl(body.data.websiteUrl);
  if (!websiteUrl) {
    res.status(400).json({ error: "Website URL must use http or https" });
    return;
  }
  const demoVideoUrl = normalizedWebsiteUrl(body.data.demoVideoUrl);
  if (body.data.demoVideoUrl && !demoVideoUrl) {
    res.status(400).json({ error: "Demo video URL must use http or https" });
    return;
  }
  if (body.data.accent && !isValidHexColor(body.data.accent)) {
    res.status(400).json({ error: "Brand color must be a valid 6-digit hex color (e.g. #FF7A5C)" });
    return;
  }
  const campaign = await ensureCurrentCampaign();
  req.log.info({ event: "CAMPAIGN_VALIDATED", correlationId: requestKey, campaignId: campaign.id }, "Campaign resolved for public campaign bid");
  const ownerBidCents = Math.round(body.data.ownerBid * 100);
  const minimumBidCents = Math.max(
    campaign.minimumBidCents,
    minimumPublicCampaignBidCents,
  );
  if (ownerBidCents < minimumBidCents) {
    res.status(400).json({
      error: `The campaign bid must be at least ${dollars(minimumBidCents)} USD`,
    });
    return;
  }
  req.log.info({ event: "BID_VALIDATED", correlationId: requestKey, campaignId: campaign.id, ownerBidCents }, "Public campaign bid amount validated");
  const [existing] = await db
    .select()
    .from(listingsTable)
    .where(and(eq(listingsTable.websiteUrl, websiteUrl), eq(listingsTable.status, "active")))
    .limit(1);
  const actor = await getRequestActor(req);
  if (actor?.status !== undefined && actor.status !== "active") {
    res.status(403).json({ error: "Suspended accounts cannot place campaign claims" });
    return;
  }
  if (actor && !actor.email) {
    res.status(403).json({ error: "Verify your Clerk email before creating or managing a product" });
    return;
  }
  const ownerEmail = actor?.email ?? normalizedEmail(body.data.email);

  if (existing) {
    if (existing.ownerId && existing.ownerId !== actor?.id) {
      res.status(403).json({
        error: "This product belongs to an owner account. Sign in to its Owner Portal to manage this claim.",
      });
      return;
    }
    if (
      !existing.ownerId &&
      actor?.email &&
      existing.ownerEmail &&
      normalizedEmail(actor.email) === normalizedEmail(existing.ownerEmail)
    ) {
      await db
        .update(listingsTable)
        .set({
          ownerId: actor.id,
          ownerName: existing.ownerName || actor.displayName,
        })
        .where(
          and(
            eq(listingsTable.id, existing.id),
            isNull(listingsTable.ownerId),
          ),
        );
      existing.ownerId = actor.id;
    }
    if (
      existing.ownerId !== actor?.id &&
      (!existing.ownerEmail || normalizedEmail(existing.ownerEmail) !== ownerEmail)
    ) {
      res.status(403).json({
        error: "This product is already competing. Enter the owner email used when it was added, or use its secure management link.",
      });
      return;
    }
    const [replayedPayment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.idempotencyKey, requestKey))
      .limit(1);
    if (replayedPayment) {
      const metadata = replayedPayment.metadata as Record<string, unknown>;
      const isMatchingReplay =
        replayedPayment.listingId === existing.id &&
        replayedPayment.campaignId === campaign.id &&
        replayedPayment.userId === (actor?.id ?? null) &&
        replayedPayment.type === "OWNER_BID" &&
        replayedPayment.receiptEmail === ownerEmail &&
        metadata.publicCampaignBid === true &&
        metadata.requestedOwnerBidCents === ownerBidCents;
      if (!isMatchingReplay) {
        res.status(409).json({
          error: "Idempotency-Key was already used for a different campaign bid",
        });
        return;
      }
      const mode = existing.creationPaymentId === replayedPayment.id ? "new" : "increase";
      const replayedCheckout =
        isPayPalCheckoutEnabled() && replayedPayment.status === "pending"
          ? await createPublicCheckout({
              listingId: existing.id,
              campaignId: campaign.id,
              userId: actor?.id ?? null,
              type: "OWNER_BID",
              amountCents: replayedPayment.amountCents,
              reason: replayedPayment.reason ?? undefined,
              receiptEmail: ownerEmail,
              idempotencyKey: requestKey,
              metadata: {
                publicCampaignBid: true,
                listingId: existing.id,
                requestedOwnerBidCents: ownerBidCents,
              },
            })
          : undefined;
      const replayed = replayedCheckout?.payment ?? replayedPayment;
      const ranked = await rankedListings();
      const listing =
        ranked.listings.find((item) => item.id === existing.id) ??
        toPublicListing(existing, [], [], 0);
      res.status(200).json(PlaceCampaignBidResponse.parse({
        mode,
        campaign: {
          number: campaign.number,
          minimumBid: dollars(campaign.minimumBidCents),
          startAt: timestamp(campaign.startAt),
          endAt: timestamp(campaign.endAt),
        },
        listing,
        payment: publicPaymentReceipt(replayed, replayedCheckout?.checkoutUrl),
        ...(mode === "new"
          ? { manageUrl: publicManagePath(managementTokenForIdempotency(requestKey)) }
          : {}),
      }));
      return;
    }
    if (isPayPalCheckoutEnabled()) {
      const currentOwnerBidCents = netAmount(
        (await db.select().from(ledgerEntriesTable).where(
          and(
            eq(ledgerEntriesTable.listingId, existing.id),
            eq(ledgerEntriesTable.campaignId, campaign.id),
          ),
        )).filter((entry) => ["sandbox_verified", "verified"].includes(entry.status)),
        "OWNER_BID",
      );
      if (ownerBidCents <= currentOwnerBidCents) {
        res.status(409).json({
          error: `The new bid must be higher than this campaign's current owner bid of ${dollars(currentOwnerBidCents)} USD`,
        });
        return;
      }
      const checkout = await createPublicCheckout({
        listingId: existing.id,
        campaignId: campaign.id,
        userId: actor?.id ?? null,
        type: "OWNER_BID",
        amountCents: ownerBidCents - currentOwnerBidCents,
        reason: "Owner increased campaign bid",
        receiptEmail: ownerEmail,
        idempotencyKey: requestKey,
        metadata: {
          publicCampaignBid: true,
          listingId: existing.id,
          requestedOwnerBidCents: ownerBidCents,
        },
      });
      const ranked = await rankedListings();
      res.status(201).json(PlaceCampaignBidResponse.parse({
        mode: "increase",
        campaign: {
          number: campaign.number,
          minimumBid: dollars(campaign.minimumBidCents),
          startAt: timestamp(campaign.startAt),
          endAt: timestamp(campaign.endAt),
        },
        listing: ranked.listings.find((item) => item.id === existing.id),
        payment: publicPaymentReceipt(checkout.payment, checkout.checkoutUrl),
      }));
      return;
    }
    const ownerBidResult = await completeOwnerBidAtTarget({
      listingId: existing.id,
      campaignId: campaign.id,
      userId: actor?.id ?? null,
      targetBidCents: ownerBidCents,
      reason: "Owner increased campaign bid",
      receiptEmail: ownerEmail,
      idempotencyKey: requestKey,
      metadata: {
        publicCampaignBid: true,
        listingId: existing.id,
        requestedOwnerBidCents: ownerBidCents,
      },
    });
    if (!ownerBidResult.payment) {
      res.status(409).json({
        error: `The new bid must be higher than this campaign's current owner bid of ${dollars(ownerBidResult.currentOwnerBidCents)} USD`,
      });
      return;
    }
    const ranked = await rankedListings();
    const listing = ranked.listings.find((item) => item.id === existing.id);
    res.status(201).json({
      mode: "increase",
      campaign: {
        number: campaign.number,
        minimumBid: dollars(campaign.minimumBidCents),
        startAt: timestamp(campaign.startAt),
        endAt: timestamp(campaign.endAt),
      },
      listing,
      payment: {
        id: ownerBidResult.payment.id,
        status: ownerBidResult.payment.status,
        receiptNumber: ownerBidResult.payment.receiptNumber,
          environment: paymentEnvironment(ownerBidResult.payment),
      },
    });
    return;
  }

  if (!(await enforceActionRateLimit(res, "create_listing", publicVisitorKey(req)))) return;
  if (actor && body.data.ownerName) {
    await db
      .update(usersTable)
      .set({ displayName: body.data.ownerName.trim() })
      .where(eq(usersTable.id, actor.id));
  }
  const parsedHost = new URL(websiteUrl).hostname.replace(/^www\./, "");
  const name = parsedHost.split(".")[0]?.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "New product";
  const managementToken = managementTokenForIdempotency(requestKey);
  // No listing row is created here. It only exists once created by
  // payments.ts's finalize() when the payment underneath verifiably
  // succeeds; until then this draft only lives in the payment's metadata,
  // so an abandoned or declined checkout claims no slug or website.
  const draft = await buildPendingListingDraft({
    name,
    tagline: `${name} is competing in this week's public campaign.`,
    description: `A public campaign listing for ${websiteUrl}. Product details can be refined from its secure management link.`,
    category: body.data.category,
    websiteUrl,
    demoVideoUrl,
    ownerId: actor?.id ?? null,
    ownerEmail,
    ownerName: body.data.ownerName?.trim() || actor?.displayName || null,
    managementToken,
    accent: body.data.accent,
  });
  if (isPayPalCheckoutEnabled()) {
    const checkout = await createPublicCheckout({
      listingId: null,
      campaignId: campaign.id,
      userId: actor?.id ?? null,
      type: "OWNER_BID",
      amountCents: ownerBidCents,
      reason: "Initial campaign bid",
      receiptEmail: ownerEmail,
      idempotencyKey: requestKey,
      metadata: {
        publicCampaignBid: true,
        requestedOwnerBidCents: ownerBidCents,
        pendingListing: draft,
      },
    });
    // Reused idempotency key: prefer the draft actually stored on the
    // returned payment (the original request's) over the one just computed,
    // so a retry's response always matches what finalize() will create.
    const resolvedDraft = pendingListingDraftFrom(checkout.payment) ?? draft;
    if (resolvedDraft.websiteUrl !== websiteUrl) {
      res.status(409).json({
        error: "Idempotency-Key was already used for a different campaign bid",
      });
      return;
    }
    res.status(201).json(PlaceCampaignBidResponse.parse({
      mode: "new",
      campaign: {
        number: campaign.number,
        minimumBid: dollars(campaign.minimumBidCents),
        startAt: timestamp(campaign.startAt),
        endAt: timestamp(campaign.endAt),
      },
      listing: toPublicListing(previewListingFromDraft(resolvedDraft), [], [], 0),
      payment: publicPaymentReceipt(checkout.payment, checkout.checkoutUrl),
      manageUrl: publicManagePath(managementToken),
    }));
    return;
  }
  const payment = await createAndCompleteTestCheckout({
    listingId: null,
    campaignId: campaign.id,
    userId: actor?.id ?? null,
    type: "OWNER_BID",
    amountCents: ownerBidCents,
    reason: "Initial campaign bid",
    receiptEmail: ownerEmail,
    idempotencyKey: requestKey,
    metadata: {
      publicCampaignBid: true,
      requestedOwnerBidCents: ownerBidCents,
      pendingListing: draft,
    },
  });
  if (payment.status !== "succeeded" || !payment.listingId) {
    res.status(409).json({
      error: payment.failureMessage ?? "This website was just claimed by another transaction. Try the bid again.",
    });
    return;
  }
  const ranked = await rankedListings();
  res.status(201).json({
    mode: "new",
    campaign: {
      number: campaign.number,
      minimumBid: dollars(campaign.minimumBidCents),
      startAt: timestamp(campaign.startAt),
      endAt: timestamp(campaign.endAt),
    },
    listing: ranked.listings.find((item) => item.id === payment.listingId),
    payment: {
      id: payment.id,
      status: payment.status,
      receiptNumber: payment.receiptNumber,
      environment: paymentEnvironment(payment),
    },
    manageUrl: publicManagePath(managementToken),
  });
});

router.post("/public/listings/checkout", async (req, res): Promise<void> => {
  const [body, requestKey] = [publicCreateListingBody.safeParse(req.body), idempotencyKey(req)];
  const contract = body.success
    ? CreatePublicListingCheckoutBody.safeParse(body.data)
    : null;
  if (!body.success || !contract?.success || !requestKey) {
    res.status(400).json({ error: "A valid listing, email, and Idempotency-Key are required" });
    return;
  }
  const websiteUrl = normalizedWebsiteUrl(body.data.websiteUrl);
  if (!websiteUrl) {
    res.status(400).json({ error: "Website URL must use http or https" });
    return;
  }
  const campaign = await ensureCurrentCampaign();
  const ownerBidCents = Math.round(body.data.ownerBid * 100);
  if (ownerBidCents <= campaign.minimumBidCents) {
    res.status(400).json({
      error: `The opening bid for Campaign #${campaign.number} must be more than ${dollars(campaign.minimumBidCents)} USD`,
    });
    return;
  }
  // No listing row exists until finalize() materializes one from the
  // payment's stashed draft on a verified success -- so this response is
  // built from either the real (now-persisted) listing, once resolved, or a
  // not-yet-persisted preview rendered straight from that draft.
  const buildCheckoutResponse = async (payment: Payment, checkoutUrl?: string | null) => {
    let listing: Listing | null = null;
    if (payment.listingId) {
      const [row] = await db
        .select()
        .from(listingsTable)
        .where(eq(listingsTable.id, payment.listingId))
        .limit(1);
      listing = row ?? null;
    }
    if (!listing) {
      const draft = pendingListingDraftFrom(payment);
      if (!draft) return null;
      listing = previewListingFromDraft(draft);
    }
    const publicListing = payment.listingId
      ? (await rankedListings()).listings.find((item) => item.id === payment.listingId) ??
        toPublicListing(listing, [], [], 0)
      : toPublicListing(listing, [], [], 0);
    return CreatePublicListingCheckoutResponse.parse({
      listing: publicListing,
      payment: publicPaymentReceipt(payment, checkoutUrl ?? undefined),
      manageUrl: publicManagePath(managementTokenForIdempotency(requestKey)),
      sandbox: paymentEnvironment(payment) === "sandbox",
    });
  };
  const [repeatedPayment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.idempotencyKey, requestKey))
    .limit(1);
  if (repeatedPayment) {
    const repeatedDraft = pendingListingDraftFrom(repeatedPayment);
    if (repeatedDraft && repeatedDraft.websiteUrl !== websiteUrl) {
      res.status(409).json({
        error: "Idempotency-Key was already used for a different listing checkout",
      });
      return;
    }
    const replayedCheckout =
      isPayPalCheckoutEnabled() &&
      repeatedPayment.status === "pending" &&
      repeatedPayment.campaignId &&
      repeatedPayment.type === "OWNER_BID"
        ? await createPublicCheckout({
            listingId: repeatedPayment.listingId,
            campaignId: repeatedPayment.campaignId,
            userId: repeatedPayment.userId,
            type: "OWNER_BID",
            amountCents: repeatedPayment.amountCents,
            reason: repeatedPayment.reason ?? undefined,
            receiptEmail: repeatedPayment.receiptEmail ?? undefined,
            idempotencyKey: requestKey,
            metadata: repeatedPayment.metadata as Record<string, unknown> | undefined,
          })
        : undefined;
    const resolvedPayment = replayedCheckout?.payment ?? repeatedPayment;
    const replay = await buildCheckoutResponse(resolvedPayment, replayedCheckout?.checkoutUrl);
    if (replay) {
      res.json(replay);
      return;
    }
  }
  if (!(await enforceActionRateLimit(res, "create_listing", publicVisitorKey(req)))) return;
  const actor = await getRequestActor(req);
  if (actor?.status !== undefined && actor.status !== "active") {
    res.status(403).json({ error: "Suspended accounts cannot create product listings" });
    return;
  }
  if (actor && !actor.email) {
    res.status(403).json({ error: "Verify your Clerk email before creating or managing a product" });
    return;
  }
  const ownerEmail = actor?.email ?? normalizedEmail(body.data.email);
  if (actor && body.data.ownerName) {
    await db
      .update(usersTable)
      .set({ displayName: body.data.ownerName.trim() })
      .where(eq(usersTable.id, actor.id));
  }

  const ranked = await rankedListings();
  const duplicate = ranked.listings.find(
    (listing) => normalizedWebsiteUrl(listing.websiteUrl) === websiteUrl,
  );
  if (duplicate) {
    res.status(409).json({ error: "This website is already on the leaderboard", duplicate });
    return;
  }

  const managementToken = managementTokenForIdempotency(requestKey);
  const draft = await buildPendingListingDraft({
    name: body.data.name,
    tagline: body.data.tagline,
    description: body.data.description,
    category: body.data.category,
    websiteUrl,
    ownerId: actor?.id ?? null,
    ownerEmail,
    ownerName: body.data.ownerName?.trim() || actor?.displayName || null,
    managementToken,
  });
  const checkout = await createPublicCheckout({
    listingId: null,
    campaignId: campaign.id,
    userId: actor?.id ?? null,
    type: "OWNER_BID",
    amountCents: ownerBidCents,
    reason: "Initial owner bid",
    receiptEmail: ownerEmail,
    idempotencyKey: requestKey,
    metadata: { publicListingCreation: true, pendingListing: draft },
  });
  const response = await buildCheckoutResponse(checkout.payment, checkout.checkoutUrl);
  if (!response) {
    res.status(500).json({ error: "This listing checkout could not be completed. Try again." });
    return;
  }
  req.log.info({ paymentId: checkout.payment.id }, "Created public listing checkout");
  res.status(201).json(response);
});

router.post("/public/listings/:slug/checkout", async (req, res): Promise<void> => {
  const [params, body, requestKey] = [
    CreatePublicActionCheckoutParams.safeParse(req.params),
    publicActionBody.safeParse(req.body),
    idempotencyKey(req),
  ];
  const contract = CreatePublicActionCheckoutBody.safeParse(req.body);
  if (!params.success || !body.success || !contract.success || !requestKey) {
    res.status(400).json({ error: "A valid sandbox action, email, and Idempotency-Key are required" });
    return;
  }
  const type = contract.data.type === "penalty" ? "PENALTY" : "COMMUNITY_BID";
  const selectedPushDownReason =
    type === "PENALTY" ? asPushDownReason(body.data.reason) : null;
  const issueReasons: PushDownReason[] = [
    "Bug",
    "UI / UX",
    "Performance",
    "Missing / broken feature",
  ];
  if (type === "PENALTY" && !selectedPushDownReason) {
    res.status(400).json({ error: "Choose one Push Down reason" });
    return;
  }
  if (
    selectedPushDownReason === "Other" &&
    !body.data.reasonDescription?.trim()
  ) {
    res.status(400).json({ error: "Describe the issue when selecting Other" });
    return;
  }
  if (
    selectedPushDownReason &&
    selectedPushDownReason !== "Other" &&
    !issueReasons.includes(selectedPushDownReason) &&
    body.data.reasonDescription
  ) {
    res.status(400).json({
      error: "A description is only available for issue-related Push Down reasons",
    });
    return;
  }
  const campaign = await ensureCurrentCampaign();
  if (Math.round(body.data.amount * 100) < campaign.minimumBidCents) {
    res.status(400).json({
      error: `The minimum ${type === "PENALTY" ? "penalty" : "support"} is ${dollars(campaign.minimumBidCents)} USD for Campaign #${campaign.number}`,
    });
    return;
  }
  const [source] = await db
    .select()
    .from(listingsTable)
    .where(and(eq(listingsTable.slug, params.data.slug), eq(listingsTable.status, "active")))
    .limit(1);
  if (!source) {
    res.status(404).json({ error: "Active listing not found" });
    return;
  }
  const currentEntries = await db
    .select()
    .from(ledgerEntriesTable)
    .where(
      and(
        eq(ledgerEntriesTable.listingId, source.id),
        eq(ledgerEntriesTable.campaignId, campaign.id),
        inArray(ledgerEntriesTable.status, ["sandbox_verified", "verified"]),
      ),
    );
  if (netAmount(currentEntries, "OWNER_BID") < campaign.minimumBidCents) {
    res.status(409).json({
      error: "This product has not entered the current campaign yet. Its owner must place a fresh qualifying bid first.",
    });
    return;
  }
  const action = type === "PENALTY" ? "penalize" : "support";
  const persistedReason =
    type === "PENALTY" && selectedPushDownReason
      ? body.data.reasonDescription?.trim()
        ? `${selectedPushDownReason}: ${body.data.reasonDescription.trim()}`
        : selectedPushDownReason
      : body.data.reason;
  const normalizedReceiptEmail = normalizedEmail(body.data.email);
  const checkoutInput: CheckoutInput = {
    listingId: source.id,
    campaignId: campaign.id,
    userId: null,
    type,
    amountCents: Math.round(body.data.amount * 100),
    reason: persistedReason,
    receiptEmail: normalizedReceiptEmail,
    idempotencyKey: requestKey,
    metadata: {
      publicAction: action,
      ...(selectedPushDownReason
        ? {
            pushDownReason: selectedPushDownReason,
            pushDownDescription: body.data.reasonDescription?.trim() || null,
          }
        : {}),
    },
  };
  const [replayedPayment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.idempotencyKey, requestKey))
    .limit(1);
  if (replayedPayment) {
    const metadata = replayedPayment.metadata as Record<string, unknown>;
    const isMatchingReplay =
      replayedPayment.listingId === source.id &&
      replayedPayment.campaignId === campaign.id &&
      replayedPayment.userId === null &&
      replayedPayment.type === type &&
      replayedPayment.amountCents === Math.round(body.data.amount * 100) &&
      replayedPayment.reason === (persistedReason ?? null) &&
      replayedPayment.receiptEmail === normalizedReceiptEmail &&
      metadata.publicAction === action;
    if (!isMatchingReplay) {
      res.status(409).json({
        error: "Idempotency-Key was already used for a different sandbox action",
      });
      return;
    }
    const checkout = await createPublicCheckout(checkoutInput);
    const ranked = await rankedListings();
    res.status(200).json(CreatePublicActionCheckoutResponse.parse({
      payment: publicPaymentReceipt(checkout.payment, checkout.checkoutUrl),
      listing: ranked.listings.find((item) => item.id === source.id),
      sandbox: paymentEnvironment(checkout.payment) === "sandbox",
    }));
    return;
  }
  if (!(await enforceActionRateLimit(res, action, publicVisitorKey(req)))) return;
  const checkout = await createPublicCheckout(checkoutInput);
  const ranked = await rankedListings();
  const listing = ranked.listings.find((item) => item.id === source.id);
  req.log.info({ listingId: source.id, paymentId: checkout.payment.id, action }, "Created public action checkout");
  res.status(201).json(CreatePublicActionCheckoutResponse.parse({
    payment: publicPaymentReceipt(checkout.payment, checkout.checkoutUrl),
    listing,
    sandbox: paymentEnvironment(checkout.payment) === "sandbox",
  }));
});

router.get("/public/payments/:id", async (req, res): Promise<void> => {
  const params = publicReviewIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, params.data.id))
    .limit(1);
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  res.json(publicPaymentReceipt(payment));
});

router.get("/public/payment-environment", async (_req, res): Promise<void> => {
  res.json(
    GetPublicPaymentEnvironmentResponse.parse(await getPaymentProviderStatus()),
  );
});

router.post("/public/payments/:id/review", async (req, res): Promise<void> => {
  const [params, reviewId, body] = [
    CreatePublicReviewParams.safeParse(req.params),
    publicReviewIdParams.safeParse(req.params),
    publicReviewBody.safeParse(req.body),
  ];
  const contract = body.success ? CreatePublicReviewBody.safeParse(body.data) : null;
  if (!params.success || !reviewId.success || !body.success || !contract?.success) {
    res.status(400).json({ error: "A valid completed checkout review is required" });
    return;
  }
  if (!(await enforceActionRateLimit(res, "review", publicVisitorKey(req)))) return;
  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.id, reviewId.data.id))
    .limit(1);
  if (
    !payment ||
    payment.status !== "succeeded" ||
    !["COMMUNITY_BID", "PENALTY"].includes(payment.type) ||
    // COMMUNITY_BID/PENALTY only ever target an existing listing (deferred
    // creation only applies to new-listing OWNER_BID checkouts), so this is
    // just a type-narrowing guard, not an expected runtime path.
    !payment.listingId
  ) {
    res.status(404).json({ error: "A completed community checkout was not found" });
    return;
  }
  const [entry] = await db
    .select()
    .from(ledgerEntriesTable)
    .where(and(eq(ledgerEntriesTable.paymentId, payment.id), eq(ledgerEntriesTable.type, payment.type)))
    .limit(1);
  if (!entry) {
    res.status(409).json({ error: "This checkout has not reached the ledger yet" });
    return;
  }
  const [review] = await db
    .insert(reviewsTable)
    .values({
      id: randomUUID(),
      listingId: payment.listingId,
      campaignId: payment.campaignId,
      ledgerEntryId: entry.id,
      userId: null,
      kind: payment.type === "PENALTY" ? "penalty" : "support",
      displayName: body.data.anonymous ? "Anonymous Supporter" : body.data.displayName ?? "Anonymous Supporter",
      rating: body.data.rating,
      reason: body.data.reason,
      body: body.data.body,
    })
    .onConflictDoNothing({ target: reviewsTable.ledgerEntryId })
    .returning();
  if (!review) {
    res.status(409).json({ error: "A review has already been submitted for this checkout" });
    return;
  }
  res.status(201).json(CreatePublicReviewResponse.parse({
    id: review.id,
    listingId: review.listingId,
    kind: review.kind,
    author: review.displayName,
    rating: review.rating,
    reason: review.reason,
    body: review.body,
    createdAt: timestamp(review.createdAt),
  }));
});

router.get("/public/manage/:token", async (req, res): Promise<void> => {
  const token = GetPublicManagedListingParams.safeParse(req.params);
  if (!token.success) {
    res.status(404).json({ error: "Management link not found" });
    return;
  }
  const listing = await managedListing(token.data.token);
  if (!listing) {
    res.status(404).json({ error: "Management link is expired or revoked" });
    return;
  }
  const ranked = await rankedListings();
  const publicListing =
    ranked.listings.find((item) => item.id === listing.id) ??
    toPublicListing(listing, ranked.entries.filter((entry) => entry.listingId === listing.id), ranked.reviews.filter((review) => review.listingId === listing.id), 0);
  const activity = ranked.entries
    .filter((entry) => entry.listingId === listing.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20)
    .map((entry) => ({ id: entry.id, type: entry.type, amount: dollars(entry.amountCents), createdAt: timestamp(entry.createdAt), reason: entry.reason ?? null }));
  res.json(GetPublicManagedListingResponse.parse({
    listing: publicListing,
    ownerName: listing.ownerName ?? null,
    activity,
    managementExpiresAt: listing.managementTokenExpiresAt?.toISOString() ?? null,
  }));
});

router.patch("/public/manage/:token", async (req, res): Promise<void> => {
  const [token, body, requestKey] = [
    UpdatePublicManagedListingParams.safeParse(req.params),
    publicManagementUpdateBody.safeParse(req.body),
    idempotencyKey(req),
  ];
  const contract = body.success
    ? UpdatePublicManagedListingBody.safeParse(body.data)
    : null;
  if (!token.success || !body.success || !contract?.success) {
    res.status(400).json({ error: "Invalid product update" });
    return;
  }
  const listing = await managedListing(token.data.token);
  if (!listing) {
    res.status(404).json({ error: "Management link is expired or revoked" });
    return;
  }
  if (listing.status === "suspended") {
    res.status(403).json({ error: "A moderator suspension cannot be changed by the owner" });
    return;
  }
  const websiteUrl =
    body.data.websiteUrl === undefined ? undefined : normalizedWebsiteUrl(body.data.websiteUrl ?? null);
  if (body.data.websiteUrl && !websiteUrl) {
    res.status(400).json({ error: "Website URL must use http or https" });
    return;
  }
  const demoVideoUrl =
    body.data.demoVideoUrl === undefined
      ? undefined
      : normalizedWebsiteUrl(body.data.demoVideoUrl ?? null);
  if (body.data.demoVideoUrl && !demoVideoUrl) {
    res.status(400).json({ error: "Demo video URL must use http or https" });
    return;
  }
  if (
    body.data.logoUrl !== undefined &&
    body.data.logoUrl !== null &&
    !isValidLogoObjectPath(body.data.logoUrl)
  ) {
    res.status(400).json({ error: "Logo must be uploaded through the logo upload endpoint" });
    return;
  }
  if (body.data.logoUrl) {
    await objectStorageService.trySetObjectEntityAclPolicy(body.data.logoUrl, {
      owner: listing.id,
      visibility: "public",
    });
  }
  const campaign = await ensureCurrentCampaign();
  const currentOwnerBid = netAmount(
    (await db.select().from(ledgerEntriesTable).where(
      and(
        eq(ledgerEntriesTable.listingId, listing.id),
        eq(ledgerEntriesTable.campaignId, campaign.id),
      ),
    )).filter((entry) => ["sandbox_verified", "verified"].includes(entry.status)),
    "OWNER_BID",
  );
  const nextOwnerBid = body.data.ownerBid === undefined ? currentOwnerBid : Math.round(body.data.ownerBid * 100);
  if (nextOwnerBid > 0 && nextOwnerBid < campaign.minimumBidCents) {
    res.status(400).json({
      error: `The minimum owner bid for Campaign #${campaign.number} is ${dollars(campaign.minimumBidCents)} USD`,
    });
    return;
  }
  if (nextOwnerBid < currentOwnerBid) {
    res.status(409).json({ error: "Owner bids can only increase; a verified bid cannot be reduced directly" });
    return;
  }
  if (isLivePaymentsEnabled() && nextOwnerBid > currentOwnerBid) {
    res.status(409).json({
      error: "Live owner bids must be increased through the payment checkout endpoint",
    });
    return;
  }
  if (nextOwnerBid > currentOwnerBid && !requestKey) {
    res.status(400).json({ error: "An Idempotency-Key is required to increase the owner bid" });
    return;
  }
  let updated = (
    await db
      .update(listingsTable)
      .set({
        ...(body.data.name ? { name: body.data.name, initials: initialsFrom(body.data.name) } : {}),
        ...(body.data.tagline ? { tagline: body.data.tagline } : {}),
        ...(body.data.description ? { description: body.data.description } : {}),
        ...(body.data.category ? { category: body.data.category } : {}),
        ...(websiteUrl !== undefined ? { websiteUrl } : {}),
        ...(demoVideoUrl !== undefined ? { demoVideoUrl } : {}),
        ...(body.data.logoUrl !== undefined ? { logoUrl: body.data.logoUrl } : {}),
      })
      .where(eq(listingsTable.id, listing.id))
      .returning()
  )[0] ?? listing;
  if (nextOwnerBid > currentOwnerBid) {
    const ownerBidResult = await completeOwnerBidAtTarget({
      listingId: listing.id,
      campaignId: campaign.id,
      userId: null,
      targetBidCents: nextOwnerBid,
      reason: "Owner increased sandbox bid",
      receiptEmail: listing.ownerEmail,
      idempotencyKey: requestKey!,
      metadata: { publicOwnerManagement: true },
    });
    updated = ownerBidResult.listing;
  }
  const ranked = await rankedListings();
  res.json(UpdatePublicManagedListingResponse.parse({
    listing: ranked.listings.find((item) => item.id === updated.id),
  }));
});

router.delete("/public/manage/:token", async (req, res): Promise<void> => {
  const token = ArchivePublicManagedListingParams.safeParse(req.params);
  if (!token.success) {
    res.status(404).json({ error: "Management link not found" });
    return;
  }
  const listing = await managedListing(token.data.token);
  if (!listing) {
    res.status(404).json({ error: "Management link is expired or revoked" });
    return;
  }
  if (listing.status === "suspended") {
    res.status(403).json({ error: "A moderator suspension cannot be changed by the owner" });
    return;
  }
  await db
    .update(listingsTable)
    .set({ status: "archived", managementTokenRevokedAt: new Date() })
    .where(eq(listingsTable.id, listing.id));
  res.status(204).send();
});

router.post("/public/manage/:token/logo-upload-url", async (req, res): Promise<void> => {
  const [token, body] = [
    RequestPublicManagedListingLogoUploadUrlParams.safeParse(req.params),
    RequestPublicManagedListingLogoUploadUrlBody.safeParse(req.body),
  ];
  if (!token.success || !body.success) {
    res.status(400).json({ error: "Invalid logo upload request" });
    return;
  }
  const listing = await managedListing(token.data.token);
  if (!listing) {
    res.status(404).json({ error: "Management link is expired or revoked" });
    return;
  }
  if (listing.status === "suspended") {
    res.status(403).json({ error: "A moderator suspension cannot be changed by the owner" });
    return;
  }
  const uploadURL = await objectStorageService.getObjectEntityUploadURL();
  const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
  res.json(RequestPublicManagedListingLogoUploadUrlResponse.parse({ uploadURL, objectPath }));
});

router.post("/public/reviews/:id/vote", async (req, res): Promise<void> => {
  const [params, reviewId] = [
    VotePublicReviewParams.safeParse(req.params),
    publicReviewIdParams.safeParse(req.params),
  ];
  if (!params.success || !reviewId.success) {
    res.status(400).json({ error: "Invalid review identifier" });
    return;
  }
  const [review] = await db.select().from(reviewsTable).where(and(eq(reviewsTable.id, reviewId.data.id), eq(reviewsTable.status, "published"))).limit(1);
  if (!review) {
    res.status(404).json({ error: "Review not found" });
    return;
  }
  const visitor = publicVisitorKey(req);
  if (!(await enforceActionRateLimit(res, "review_vote", visitor))) return;
  await db.insert(reviewVotesTable).values({ id: randomUUID(), reviewId: review.id, userId: visitor }).onConflictDoNothing();
  const votes = await db.select({ id: reviewVotesTable.id }).from(reviewVotesTable).where(eq(reviewVotesTable.reviewId, review.id));
  res.json(VotePublicReviewResponse.parse({ reviewId: review.id, helpfulCount: votes.length, voted: true }));
});

router.delete("/public/reviews/:id/vote", async (req, res): Promise<void> => {
  const [params, reviewId] = [
    RemovePublicReviewVoteParams.safeParse(req.params),
    publicReviewIdParams.safeParse(req.params),
  ];
  if (!params.success || !reviewId.success) {
    res.status(400).json({ error: "Invalid review identifier" });
    return;
  }
  const visitor = publicVisitorKey(req);
  await db.delete(reviewVotesTable).where(and(eq(reviewVotesTable.reviewId, reviewId.data.id), eq(reviewVotesTable.userId, visitor)));
  const votes = await db.select({ id: reviewVotesTable.id }).from(reviewVotesTable).where(eq(reviewVotesTable.reviewId, reviewId.data.id));
  res.json(RemovePublicReviewVoteResponse.parse({ reviewId: reviewId.data.id, helpfulCount: votes.length, voted: false }));
});

router.get("/me", async (req, res): Promise<void> => {
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  res.json(GetMyProfileResponse.parse(await memberProfile(actor)));
});

router.patch("/me", async (req, res): Promise<void> => {
  const body = UpdateMyProfileBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid profile input" });
    return;
  }
  // Reject unusable/dangerous URLs (e.g. `javascript:...`) up front, before
  // touching the database, so a bad photoUrl/website never silently reaches
  // storage and a later render as a link or image src.
  const photoUrl = body.data.photoUrl !== undefined ? normalizedProfileUrl(body.data.photoUrl) : { ok: true as const, value: null };
  const website = body.data.website !== undefined ? normalizedProfileUrl(body.data.website) : { ok: true as const, value: null };
  if (!photoUrl.ok) {
    res.status(400).json({ error: "Photo URL must be a valid http(s) link" });
    return;
  }
  if (!website.ok) {
    res.status(400).json({ error: "Website must be a valid http(s) link" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const [updated] = await db
    .update(usersTable)
    .set({
      displayName: body.data.displayName.trim(),
      ...(body.data.photoUrl !== undefined ? { photoUrl: photoUrl.value } : {}),
      ...(body.data.bio !== undefined ? { bio: body.data.bio?.trim() || null } : {}),
      ...(body.data.company !== undefined ? { company: body.data.company?.trim() || null } : {}),
      ...(body.data.profileRole !== undefined ? { profileRole: body.data.profileRole?.trim() || null } : {}),
      ...(body.data.socialLinks !== undefined ? { socialLinks: body.data.socialLinks?.trim() || null } : {}),
      ...(body.data.website !== undefined ? { website: website.value } : {}),
      ...(body.data.location !== undefined ? { location: body.data.location?.trim() || null } : {}),
    })
    .where(eq(usersTable.id, actor.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Member profile not found" });
    return;
  }
  res.json(UpdateMyProfileResponse.parse(await memberProfile(updated)));
});

router.get("/me/listings", async (req, res): Promise<void> => {
  await ensureSignalRankSeed();
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const [ownedListings, ranked, helpfulVotes] = await Promise.all([
    db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.ownerId, actor.id))
      .orderBy(desc(listingsTable.updatedAt)),
    rankedListings(),
    db.select({ reviewId: reviewVotesTable.reviewId }).from(reviewVotesTable),
  ]);
  const rankById = new Map(ranked.listings.map((listing) => [listing.id, listing]));
  res.json(
    GetMyListingsResponse.parse(
      ownedListings.map((listing) =>
        memberListing(
          listing,
          ranked.entries,
          ranked.reviews,
          rankById,
          helpfulVotes,
        ),
      ),
    ),
  );
});

router.post("/me/listings", async (req, res): Promise<void> => {
  const body = CreateListingBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid listing input" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const websiteUrl = normalizedWebsiteUrl(body.data.websiteUrl);
  if (body.data.websiteUrl && !websiteUrl) {
    res.status(400).json({ error: "Website URL must use http or https" });
    return;
  }
  // Same http/https canonicalization as website URLs; a demo link only needs
  // to be a safe, well-formed URL, not a specific hostname.
  const demoVideoUrl = normalizedWebsiteUrl(body.data.demoVideoUrl);
  if (body.data.demoVideoUrl && !demoVideoUrl) {
    res.status(400).json({ error: "Demo video URL must use http or https" });
    return;
  }
  // An owner-chosen brand color must still be a real hex value -- the same
  // guarantee accentFrom() gives the auto-assigned default -- so the
  // invalid-value bug this replaces can't come back through this input.
  if (body.data.accent !== undefined && !isValidHexColor(body.data.accent)) {
    res.status(400).json({ error: "Brand color must be a valid 6-digit hex color (e.g. #FF7A5C)" });
    return;
  }
  const slug = await nextSlug(body.data.name);
  const listingId = randomUUID();
  const ownerBidCents = Math.round(body.data.ownerBid * 100);
  const campaign = await ensureCurrentCampaign();
  if (ownerBidCents > 0 && ownerBidCents < campaign.minimumBidCents) {
    res.status(400).json({
      error: `The minimum owner bid for Campaign #${campaign.number} is ${dollars(campaign.minimumBidCents)} USD`,
    });
    return;
  }
  if (isLivePaymentsEnabled() && ownerBidCents > 0) {
    res.status(409).json({
      error: "Live owner bids must be created through the payment checkout endpoint",
    });
    return;
  }
  const [created] = await db
    .insert(listingsTable)
    .values({
      id: listingId,
      ownerId: actor.id,
      name: body.data.name.trim(),
      slug,
      tagline: body.data.tagline.trim(),
      description: body.data.description.trim(),
      category: body.data.category.trim(),
      initials: initialsFrom(body.data.name),
      accent: body.data.accent ?? accentFrom(body.data.name),
      websiteUrl,
      demoVideoUrl,
      ownerBidCents: 0,
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "Unable to create listing" });
    return;
  }
  let listing = created;
  if (ownerBidCents > 0) {
    const ownerBidResult = await completeOwnerBidAtTarget({
      listingId,
      campaignId: campaign.id,
      userId: actor.id,
      targetBidCents: ownerBidCents,
      reason: "Initial owner bid",
      idempotencyKey: `listing-create:${listingId}:owner-bid`,
    });
    listing = ownerBidResult.listing;
  }
  const ranked = await rankedListings();
  const rankById = new Map(ranked.listings.map((item) => [item.id, item]));
  const response = memberListing(listing, ranked.entries, ranked.reviews, rankById);
  req.log.info({ listingId: listing.id, actorId: actor.id }, "Created member listing");
  res.status(201).json(CreateListingResponse.parse(response));
});

router.patch("/me/listings/:id", async (req, res): Promise<void> => {
  const [params, body] = [
    UpdateMyListingParams.safeParse(req.params),
    UpdateMyListingBody.safeParse(req.body),
  ];
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid listing update" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const [existing] = await db
    .select()
    .from(listingsTable)
    .where(and(eq(listingsTable.id, params.data.id), eq(listingsTable.ownerId, actor.id)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Owned listing not found" });
    return;
  }
  if (existing.status === "suspended" && body.data.status) {
    res.status(403).json({
      error: "A moderator suspension cannot be changed by the listing owner",
    });
    return;
  }
  const websiteUrl =
    body.data.websiteUrl === undefined
      ? undefined
      : normalizedWebsiteUrl(body.data.websiteUrl);
  if (body.data.websiteUrl && !websiteUrl) {
    res.status(400).json({ error: "Website URL must use http or https" });
    return;
  }
  const demoVideoUrl =
    body.data.demoVideoUrl === undefined
      ? undefined
      : normalizedWebsiteUrl(body.data.demoVideoUrl);
  if (body.data.demoVideoUrl && !demoVideoUrl) {
    res.status(400).json({ error: "Demo video URL must use http or https" });
    return;
  }
  if (body.data.accent !== undefined && !isValidHexColor(body.data.accent)) {
    res.status(400).json({ error: "Brand color must be a valid 6-digit hex color (e.g. #FF7A5C)" });
    return;
  }
  if (
    body.data.logoUrl !== undefined &&
    body.data.logoUrl !== null &&
    !isValidLogoObjectPath(body.data.logoUrl)
  ) {
    res.status(400).json({ error: "Logo must be uploaded through the logo upload endpoint" });
    return;
  }
  if (body.data.logoUrl) {
    // Mark the just-uploaded object public-readable now that it's about to
    // be attached to a real listing -- fresh uploads have no ACL policy
    // yet, so a bare GET would 404 rather than leak or deny.
    await objectStorageService.trySetObjectEntityAclPolicy(body.data.logoUrl, {
      owner: actor.id,
      visibility: "public",
    });
  }
  const nextOwnerBidCents =
    body.data.ownerBid === undefined
      ? undefined
      : Math.round(body.data.ownerBid * 100);
  const campaign = await ensureCurrentCampaign();
  const ownerEntries = await db
    .select()
    .from(ledgerEntriesTable)
    .where(
      and(
        eq(ledgerEntriesTable.listingId, existing.id),
        eq(ledgerEntriesTable.campaignId, campaign.id),
        inArray(ledgerEntriesTable.status, ["sandbox_verified", "verified"]),
      ),
    );
  const currentOwnerBidCents = netAmount(ownerEntries, "OWNER_BID");
  if (
    nextOwnerBidCents !== undefined &&
    nextOwnerBidCents > 0 &&
    nextOwnerBidCents < campaign.minimumBidCents
  ) {
    res.status(400).json({
      error: `The minimum owner bid for Campaign #${campaign.number} is ${dollars(campaign.minimumBidCents)} USD`,
    });
    return;
  }
  if (
    isLivePaymentsEnabled() &&
    nextOwnerBidCents !== undefined &&
    nextOwnerBidCents !== currentOwnerBidCents
  ) {
    res.status(409).json({
      error: "Live owner bids must be changed through the payment checkout endpoint",
    });
    return;
  }
  if (
    nextOwnerBidCents !== undefined &&
    nextOwnerBidCents < currentOwnerBidCents
  ) {
    res.status(409).json({
      error: "Lower an owner bid by refunding its verified payment; direct balance reductions are not allowed",
    });
    return;
  }
  const [updated] = await db
    .update(listingsTable)
    .set({
      ...(body.data.name
        ? {
            name: body.data.name.trim(),
            initials: initialsFrom(body.data.name),
          }
        : {}),
      ...(body.data.tagline ? { tagline: body.data.tagline.trim() } : {}),
      ...(body.data.description ? { description: body.data.description.trim() } : {}),
      ...(body.data.category ? { category: body.data.category.trim() } : {}),
      ...(websiteUrl !== undefined ? { websiteUrl } : {}),
      ...(demoVideoUrl !== undefined ? { demoVideoUrl } : {}),
      ...(body.data.status ? { status: body.data.status } : {}),
      ...(body.data.accent !== undefined ? { accent: body.data.accent } : {}),
    })
    .where(
      and(
        eq(listingsTable.id, existing.id),
        eq(listingsTable.ownerId, actor.id),
        ne(listingsTable.status, "suspended"),
      ),
    )
    .returning();
  let listing = updated;
  if (!listing) {
    const [latest] = await db
      .select({ status: listingsTable.status })
      .from(listingsTable)
      .where(and(eq(listingsTable.id, existing.id), eq(listingsTable.ownerId, actor.id)))
      .limit(1);
    if (latest?.status === "suspended") {
      res.status(403).json({
        error: "A moderator suspension cannot be changed by the listing owner",
      });
      return;
    }
    res.status(404).json({ error: "Owned listing not found" });
    return;
  }
  if (
    nextOwnerBidCents !== undefined &&
    nextOwnerBidCents > currentOwnerBidCents
  ) {
    const ownerBidResult = await completeOwnerBidAtTarget({
      listingId: existing.id,
      campaignId: campaign.id,
      userId: actor.id,
      targetBidCents: nextOwnerBidCents,
      reason: "Updated owner sandbox bid",
      idempotencyKey: `listing-update:${existing.id}:${randomUUID()}:owner-bid`,
    });
    listing = ownerBidResult.listing;
  }
  const ranked = await rankedListings();
  const rankById = new Map(ranked.listings.map((item) => [item.id, item]));
  req.log.info({ listingId: listing.id, actorId: actor.id }, "Updated member listing");
  res.json(
    UpdateMyListingResponse.parse(
      memberListing(listing, ranked.entries, ranked.reviews, rankById),
    ),
  );
});

router.delete("/me/listings/:id", async (req, res): Promise<void> => {
  const params = ArchiveMyListingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid listing identifier" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const [listing] = await db
    .update(listingsTable)
    .set({ status: "archived" })
    .where(and(eq(listingsTable.id, params.data.id), eq(listingsTable.ownerId, actor.id)))
    .returning();
  if (!listing) {
    res.status(404).json({ error: "Owned listing not found" });
    return;
  }
  req.log.info({ listingId: listing.id, actorId: actor.id }, "Archived member listing");
  res.status(204).send();
});

router.post("/me/listings/:id/logo-upload-url", async (req, res): Promise<void> => {
  const [params, body] = [
    RequestMyListingLogoUploadUrlParams.safeParse(req.params),
    RequestMyListingLogoUploadUrlBody.safeParse(req.body),
  ];
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid logo upload request" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const [existing] = await db
    .select({ id: listingsTable.id })
    .from(listingsTable)
    .where(and(eq(listingsTable.id, params.data.id), eq(listingsTable.ownerId, actor.id)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Owned listing not found" });
    return;
  }
  const uploadURL = await objectStorageService.getObjectEntityUploadURL();
  const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
  res.json(RequestMyListingLogoUploadUrlResponse.parse({ uploadURL, objectPath }));
});

router.post(
  "/me/listings/:listingId/reviews/:reviewId/reply",
  async (req, res): Promise<void> => {
    const [params, body] = [
      ReplyToOwnedListingReviewParams.safeParse(req.params),
      ReplyToOwnedListingReviewBody.safeParse(req.body),
    ];
    if (!params.success || !body.success) {
      res.status(400).json({ error: "A public owner reply is required" });
      return;
    }
    const actor = await requireActiveActor(req, res);
    if (!actor) return;
    const [listing] = await db
      .select()
      .from(listingsTable)
      .where(
        and(
          eq(listingsTable.id, params.data.listingId),
          eq(listingsTable.ownerId, actor.id),
        ),
      )
      .limit(1);
    if (!listing) {
      res.status(403).json({
        error: "Only the verified owner can reply to this product's feedback",
      });
      return;
    }
    const [review] = await db
      .select()
      .from(reviewsTable)
      .where(
        and(
          eq(reviewsTable.id, params.data.reviewId),
          eq(reviewsTable.listingId, listing.id),
          eq(reviewsTable.status, "published"),
        ),
      )
      .limit(1);
    if (!review) {
      res.status(404).json({ error: "Published feedback was not found for this product" });
      return;
    }
    const [updated] = await db
      .update(reviewsTable)
      .set({
        ownerReply: body.data.body.trim(),
        ownerReplyAuthor: listing.ownerName || actor.displayName,
        ownerReplyAt: new Date(),
      })
      .where(
        and(
          eq(reviewsTable.id, review.id),
          eq(reviewsTable.listingId, listing.id),
        ),
      )
      .returning();
    const entries = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.id, review.ledgerEntryId));
    const helpfulVotes = await db
      .select({ reviewId: reviewVotesTable.reviewId })
      .from(reviewVotesTable)
      .where(eq(reviewVotesTable.reviewId, review.id));
    const result = publicReview(updated ?? review, entries, helpfulVotes.length);
    req.log.info(
      { listingId: listing.id, reviewId: review.id, actorId: actor.id },
      "Published owner feedback reply",
    );
    res.json(ReplyToOwnedListingReviewResponse.parse(result));
  },
);

router.get("/me/transactions", async (req, res): Promise<void> => {
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const [transactions, listings] = await Promise.all([
    db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.userId, actor.id))
      .orderBy(desc(ledgerEntriesTable.createdAt))
      .limit(100),
    db.select().from(listingsTable),
  ]);
  const listingById = new Map(listings.map((listing) => [listing.id, listing.name]));
  res.json(
    GetMyTransactionsResponse.parse(
      transactions
        .filter((entry) =>
          ["OWNER_BID", "COMMUNITY_BID", "PENALTY"].includes(entry.type),
        )
        .map((entry) => ({
          id: entry.id,
          listingId: entry.listingId,
          listingName: listingById.get(entry.listingId) ?? "Archived listing",
          type: entry.type,
          amount: dollars(entry.amountCents),
          reason: entry.reason ?? null,
          status: entry.status,
          provider: entry.provider,
          createdAt: timestamp(entry.createdAt),
        })),
    ),
  );
});

router.post("/reviews/:id/vote", async (req, res): Promise<void> => {
  const params = VoteReviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid review identifier" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const [review] = await db
    .select({ id: reviewsTable.id })
    .from(reviewsTable)
    .where(eq(reviewsTable.id, params.data.id))
    .limit(1);
  if (!review) {
    res.status(404).json({ error: "Review not found" });
    return;
  }
  await db
    .insert(reviewVotesTable)
    .values({ id: randomUUID(), reviewId: review.id, userId: actor.id })
    .onConflictDoNothing();
  const votes = await db
    .select({ id: reviewVotesTable.id })
    .from(reviewVotesTable)
    .where(eq(reviewVotesTable.reviewId, review.id));
  res.json(
    VoteReviewResponse.parse({
      reviewId: review.id,
      helpfulCount: votes.length,
      voted: true,
    }),
  );
});

router.delete("/reviews/:id/vote", async (req, res): Promise<void> => {
  const params = RemoveReviewVoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid review identifier" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const [review] = await db
    .select({ id: reviewsTable.id })
    .from(reviewsTable)
    .where(eq(reviewsTable.id, params.data.id))
    .limit(1);
  if (!review) {
    res.status(404).json({ error: "Review not found" });
    return;
  }
  await db
    .delete(reviewVotesTable)
    .where(
      and(
        eq(reviewVotesTable.reviewId, review.id),
        eq(reviewVotesTable.userId, actor.id),
      ),
    );
  const votes = await db
    .select({ id: reviewVotesTable.id })
    .from(reviewVotesTable)
    .where(eq(reviewVotesTable.reviewId, review.id));
  res.json(
    RemoveReviewVoteResponse.parse({
      reviewId: review.id,
      helpfulCount: votes.length,
      voted: false,
    }),
  );
});

async function addSandboxSignal(
  slug: string,
  amount: number,
  reason: string | undefined,
  type: "COMMUNITY_BID" | "PENALTY",
  userId: string,
) {
  await ensureSignalRankSeed();
  const [listing] = await db
    .select()
    .from(listingsTable)
    .where(eq(listingsTable.slug, slug))
    .limit(1);
  if (!listing) return null;
  if (listing.status !== "active") return "suspended";
  const campaign = await ensureCurrentCampaign();
  if (Math.round(amount * 100) < campaign.minimumBidCents) return null;

  await createAndCompleteTestCheckout({
    listingId: listing.id,
    campaignId: campaign.id,
    amountCents: Math.round(amount * 100),
    userId,
    type,
    reason,
    idempotencyKey: `sandbox-signal:${type}:${listing.id}:${randomUUID()}`,
  });

  const ranked = await rankedListings();
  return ranked.listings.find((item) => item.slug === slug) ?? null;
}

async function getListingAvailability(
  slug: string,
): Promise<"active" | "suspended" | "missing"> {
  await ensureSignalRankSeed();
  const [listing] = await db
    .select({ status: listingsTable.status })
    .from(listingsTable)
    .where(eq(listingsTable.slug, slug))
    .limit(1);
  if (!listing) return "missing";
  return listing.status === "active" ? "active" : "suspended";
}

router.post("/listings/:slug/support", async (req, res): Promise<void> => {
  const [params, body] = [
    SupportListingParams.safeParse(req.params),
    SupportListingBody.safeParse(req.body),
  ];
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid sandbox support input" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  if (isLivePaymentsEnabled()) {
    res.status(409).json({
      error: "Live support must be completed through the payment checkout endpoint",
    });
    return;
  }
  const availability = await getListingAvailability(params.data.slug);
  if (availability === "suspended") {
    res.status(403).json({ error: "This listing is suspended" });
    return;
  }
  if (availability === "missing") {
    res.status(404).json({ error: "Listing not found" });
    return;
  }
  if (!(await enforceActionRateLimit(res, "support", actor.id))) return;
  const listing = await addSandboxSignal(
    params.data.slug,
    body.data.amount,
    body.data.reason,
    "COMMUNITY_BID",
    actor.id,
  );
  if (listing === "suspended") {
    res.status(403).json({ error: "This listing is suspended" });
    return;
  }
  if (!listing) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }
  req.log.info({ slug: listing.slug, amount: body.data.amount }, "Recorded sandbox support");
  res.json(SupportListingResponse.parse(listing));
});

router.post("/listings/:slug/penalize", async (req, res): Promise<void> => {
  const [params, body] = [
    PenalizeListingParams.safeParse(req.params),
    PenalizeListingBody.safeParse(req.body),
  ];
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid sandbox penalty input" });
    return;
  }
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  if (isLivePaymentsEnabled()) {
    res.status(409).json({
      error: "Live penalties must be completed through the payment checkout endpoint",
    });
    return;
  }
  const availability = await getListingAvailability(params.data.slug);
  if (availability === "suspended") {
    res.status(403).json({ error: "This listing is suspended" });
    return;
  }
  if (availability === "missing") {
    res.status(404).json({ error: "Listing not found" });
    return;
  }
  if (!(await enforceActionRateLimit(res, "penalize", actor.id))) return;
  const listing = await addSandboxSignal(
    params.data.slug,
    body.data.amount,
    body.data.reason,
    "PENALTY",
    actor.id,
  );
  if (listing === "suspended") {
    res.status(403).json({ error: "This listing is suspended" });
    return;
  }
  if (!listing) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }
  req.log.info({ slug: listing.slug, amount: body.data.amount }, "Recorded sandbox penalty");
  res.json(PenalizeListingResponse.parse(listing));
});

router.get("/activity", async (_req, res): Promise<void> => {
  const { listings, entries } = await rankedListings();
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const events = entries
    .filter((entry) =>
      ["COMMUNITY_BID", "PENALTY", "OWNER_BID"].includes(entry.type),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 12)
    .flatMap((entry) => {
      const listing = listingById.get(entry.listingId);
      if (!listing) return [];
      return [
        {
          id: entry.id,
          type:
            entry.type === "PENALTY"
              ? "penalty"
              : entry.type === "OWNER_BID"
                ? "owner"
                : "support",
          listingName: listing.name,
          amount: dollars(entry.amountCents),
          rank: listing.rank,
          createdAt: timestamp(entry.createdAt),
        },
      ];
    });

  res.json(GetActivityResponse.parse(events));
});

export default router;
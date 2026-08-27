import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  CreateFeedbackBody,
  CreateFeedbackResponse,
  CreateReportBody,
  CreateReportResponse,
  GetAdminOverviewResponse,
  ModerateReviewBody,
  ModerateReviewParams,
  ModerateReviewResponse,
  ResolveFeedbackBody,
  ResolveFeedbackParams,
  ResolveFeedbackResponse,
  ResolveReportBody,
  ResolveReportParams,
  ResolveReportResponse,
  UpdateAdminListingStatusBody,
  UpdateAdminListingStatusParams,
  UpdateAdminListingStatusResponse,
  UpdateAdminUserStatusBody,
  UpdateAdminUserStatusParams,
  UpdateAdminUserStatusResponse,
  SearchAdminUsersQueryParams,
  SearchAdminUsersResponse,
  UpdateAdminUserRoleBody,
  UpdateAdminUserRoleParams,
  UpdateAdminUserRoleResponse,
  UpdateRateLimitBody,
  UpdateRateLimitParams,
  UpdateRateLimitResponse,
} from "@workspace/api-zod";
import {
  auditEventsTable,
  campaignsTable,
  db,
  feedbackTable,
  invoicesTable,
  ledgerEntriesTable,
  listingClicksTable,
  listingsTable,
  rateLimitsTable,
  reportsTable,
  reviewVotesTable,
  reviewsTable,
  usersTable,
  type User,
} from "@workspace/db";
import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  enforceActionRateLimit,
  getRequestActor,
  requireAdmin,
  requireModerator,
} from "../lib/moderation";
import { ensureSignalRankSeed } from "../lib/signalrank-seed";
import { ensureCurrentCampaign } from "../lib/campaigns";

const router: IRouter = Router();

function toTimestamp(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toDollars(cents: number): number {
  return Math.round(cents) / 100;
}

const roleRank: Record<string, number> = { member: 0, moderator: 1, admin: 2 };

function serializeAdminUser(user: User) {
  return {
    id: user.id,
    email: user.email ?? "Private member",
    displayName: user.displayName,
    role: user.role === "moderator" ? "moderator" : user.role === "admin" ? "admin" : "member",
    status: user.status === "suspended" ? "suspended" : "active",
    createdAt: user.createdAt.toISOString(),
  };
}

function serializeFeedback(feedback: typeof feedbackTable.$inferSelect) {
  return {
    id: feedback.id,
    category: ["payment_issue", "bug"].includes(feedback.category)
      ? feedback.category
      : "other",
    message: feedback.message,
    contactEmail: feedback.contactEmail ?? null,
    userId: feedback.userId ?? null,
    path: feedback.path ?? null,
    status: ["resolved", "dismissed"].includes(feedback.status) ? feedback.status : "open",
    resolution: feedback.resolution ?? null,
    createdAt: feedback.createdAt.toISOString(),
    resolvedAt: toTimestamp(feedback.resolvedAt),
  };
}

router.post("/feedback", async (req, res): Promise<void> => {
  await ensureSignalRankSeed();
  const body = CreateFeedbackBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const actor = await getRequestActor(req);
  const visitor =
    actor?.id ??
    `guest:${createHash("sha256")
      .update(`${req.ip}|${req.get("user-agent") ?? ""}`)
      .digest("hex")
      .slice(0, 48)}`;
  if (!(await enforceActionRateLimit(res, "feedback", visitor))) return;

  const [feedback] = await db
    .insert(feedbackTable)
    .values({
      id: randomUUID(),
      category: body.data.category,
      message: body.data.message,
      contactEmail: body.data.contactEmail ?? actor?.email ?? null,
      userId: actor?.id ?? null,
      path: body.data.path ?? null,
    })
    .returning();

  res.status(201).json(CreateFeedbackResponse.parse(serializeFeedback(feedback)));
});

router.post("/reports", async (req, res): Promise<void> => {
  await ensureSignalRankSeed();
  const body = CreateReportBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const visitor = `guest:${createHash("sha256")
    .update(`${req.ip}|${req.get("user-agent") ?? ""}`)
    .digest("hex")
    .slice(0, 48)}`;
  if (!(await enforceActionRateLimit(res, "report", visitor))) return;
  const existing = await db
    .select({ id: reportsTable.id })
    .from(reportsTable)
    .where(
      and(
        eq(reportsTable.targetId, body.data.targetId),
        eq(reportsTable.reason, body.data.reason),
        eq(reportsTable.details, body.data.details ?? ""),
      ),
    )
    .limit(1);
  if (existing[0]) {
    res.status(409).json({ error: "This report has already been submitted" });
    return;
  }

  const [report] = await db
    .insert(reportsTable)
    .values({
      id: randomUUID(),
      reporterId: null,
      ...body.data,
    })
    .returning();

  res.status(201).json(
    CreateReportResponse.parse({
      ...report,
      resolution: report.resolution ?? null,
      createdAt: report.createdAt.toISOString(),
      resolvedAt: toTimestamp(report.resolvedAt),
    }),
  );
});

router.get("/admin/overview", async (req, res): Promise<void> => {
  const actor = await requireModerator(req, res);
  if (!actor) return;

  const [
    users,
    listings,
    entries,
    reviews,
    votes,
    reports,
    feedbackEntries,
    limits,
    auditEvents,
    clickAgg,
    invoices,
  ] = await Promise.all([
    db.select().from(usersTable).orderBy(desc(usersTable.createdAt)),
    db.select().from(listingsTable).orderBy(desc(listingsTable.createdAt)),
    db.select().from(ledgerEntriesTable).orderBy(desc(ledgerEntriesTable.createdAt)),
    db.select().from(reviewsTable).orderBy(desc(reviewsTable.createdAt)),
    db.select().from(reviewVotesTable),
    db.select().from(reportsTable).orderBy(desc(reportsTable.createdAt)),
    db.select().from(feedbackTable).orderBy(desc(feedbackTable.createdAt)),
    db.select().from(rateLimitsTable).orderBy(rateLimitsTable.action),
    db.select().from(auditEventsTable).orderBy(desc(auditEventsTable.createdAt)).limit(50),
    db
      .select({
        listingId: listingClicksTable.listingId,
        totalClicks: sql<string>`count(*)`,
        uniqueClicks: sql<string>`count(distinct ${listingClicksTable.visitorHash})`,
      })
      .from(listingClicksTable)
      .groupBy(listingClicksTable.listingId),
    db
      .select({
        id: invoicesTable.id,
        paymentId: invoicesTable.paymentId,
        invoiceNumber: invoicesTable.invoiceNumber,
        status: invoicesTable.status,
      })
      .from(invoicesTable),
  ]);
  const invoiceByPaymentId = new Map(invoices.map((invoice) => [invoice.paymentId, invoice]));

  const clickStatsById = new Map(
    clickAgg.map((row) => [
      row.listingId,
      { totalClicks: Number(row.totalClicks), uniqueClicks: Number(row.uniqueClicks) },
    ]),
  );

  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  // A review authored by a suspended/banned member must not keep inflating a
  // listing's displayed rating/review count here, mirroring the same
  // active-user scoping applied to the public /analytics/public and
  // /listings surfaces. Ledger-entry dollar totals (effectiveBid, support,
  // penalties, supporters, penalizers) are intentionally left unscoped: they
  // must stay identical to the verified-payment totals the weekly rollover
  // finalizes, regardless of a bidder's later account status.
  const suspendedUserIds = new Set(
    users.filter((user) => user.status !== "active").map((user) => user.id),
  );
  const adminListings = listings
    .map((listing) => {
      const listingEntries = entries.filter((entry) => entry.listingId === listing.id);
      const support = listingEntries
        .filter((entry) => entry.type === "COMMUNITY_BID")
        .reduce((sum, entry) => sum + entry.amountCents, 0);
      const penalties = listingEntries
        .filter((entry) => entry.type === "PENALTY")
        .reduce((sum, entry) => sum + entry.amountCents, 0);
      const listingReviews = reviews.filter(
        (review) =>
          review.listingId === listing.id &&
          (!review.userId || !suspendedUserIds.has(review.userId)),
      );
      const visibleReviews = listingReviews.filter((review) => review.status === "published");
      const rating = visibleReviews.length
        ? Math.round(
            (visibleReviews.reduce((sum, review) => sum + review.rating, 0) /
              visibleReviews.length) *
              10,
          ) / 10
        : 0;
      return {
        id: listing.id,
        name: listing.name,
        slug: listing.slug,
        tagline: listing.tagline,
        description: listing.description,
        category: listing.category,
        initials: listing.initials,
        accent: listing.accent,
        effectiveBid: toDollars(listing.ownerBidCents + support - penalties),
        ownerBid: toDollars(listing.ownerBidCents),
        communitySupport: toDollars(support),
        penalties: toDollars(penalties),
        supporters: new Set(
          listingEntries
            .filter((entry) => entry.type === "COMMUNITY_BID")
            .map((entry) => entry.userId ?? entry.id),
        ).size,
        penalizers: new Set(
          listingEntries
            .filter((entry) => entry.type === "PENALTY")
            .map((entry) => entry.userId ?? entry.id),
        ).size,
        rating,
        reviewCount: visibleReviews.length,
        clicks: listing.clicks,
        clickAnalytics: clickStatsById.get(listing.id) ?? { totalClicks: 0, uniqueClicks: 0 },
        createdAt: listing.createdAt.toISOString(),
        trend:
          listingEntries.filter((entry) => entry.type === "COMMUNITY_BID").length -
          listingEntries.filter((entry) => entry.type === "PENALTY").length,
        websiteUrl: listing.websiteUrl ?? null,
        demoVideoUrl: listing.demoVideoUrl ?? null,
        demoViewCount: listing.demoViewCount,
        logoUrl: listing.logoUrl ?? null,
        ownerId: listing.ownerId ?? null,
        status: listing.status === "suspended" ? "suspended" : "active",
        moderationStatus: listing.moderationStatus ?? "active",
        moderationReason: listing.moderationReason ?? null,
        moderatedAt: listing.moderatedAt ? listing.moderatedAt.toISOString() : null,
      };
    })
    .sort((left, right) => right.effectiveBid - left.effectiveBid)
    .map((listing, index) => ({ ...listing, rank: index + 1 }));

  res.json(
    GetAdminOverviewResponse.parse({
      actorRole: actor.role === "admin" ? "admin" : "moderator",
      stats: {
        users: users.length,
        listings: listings.length,
        transactions: entries.length,
        reviews: reviews.length,
        openReports: reports.filter((report) => ["open", "under_review"].includes(report.status))
          .length,
        suspendedAccounts: users.filter((user) => user.status === "suspended").length,
        suspendedListings: listings.filter((listing) => listing.status === "suspended").length,
        openFeedback: feedbackEntries.filter((item) => item.status === "open").length,
      },
      users: users.map(serializeAdminUser),
      listings: adminListings,
      transactions: entries.map((entry) => {
        const invoice = entry.paymentId ? invoiceByPaymentId.get(entry.paymentId) : undefined;
        return {
          id: entry.id,
          listingId: entry.listingId,
          listingName: listingById.get(entry.listingId)?.name ?? "Unknown listing",
          userId: entry.userId ?? null,
          type: entry.type,
          amount: toDollars(entry.amountCents),
          status: entry.status,
          provider: entry.provider,
          createdAt: entry.createdAt.toISOString(),
          invoiceId: invoice?.id ?? null,
          invoiceNumber: invoice?.invoiceNumber ?? null,
          invoiceStatus: (invoice?.status as "PAID" | "REFUNDED" | "PARTIALLY_REFUNDED" | undefined) ?? null,
        };
      }),
      reviews: reviews.map((review) => {
        const entry = entries.find((item) => item.id === review.ledgerEntryId);
        return {
          id: review.id,
          kind: review.kind === "penalty" ? "penalty" : "support",
          author: review.displayName,
          amount: toDollars(entry?.amountCents ?? 0),
          rating: review.rating,
          reason: review.reason,
          body: review.body,
          createdAt: review.createdAt.toISOString(),
          helpfulCount: votes.filter((vote) => vote.reviewId === review.id).length,
          ownerReply:
            review.ownerReply && review.ownerReplyAuthor && review.ownerReplyAt
              ? {
                  author: review.ownerReplyAuthor,
                  body: review.ownerReply,
                  createdAt: review.ownerReplyAt.toISOString(),
                }
              : null,
          listingId: review.listingId,
          status: ["hidden", "under_review"].includes(review.status)
            ? review.status
            : "published",
          moderationReason: review.moderationReason ?? null,
        };
      }),
      reports: reports.map((report) => ({
        id: report.id,
        reporterId: report.reporterId ?? null,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        details: report.details,
        status: ["under_review", "resolved", "dismissed"].includes(report.status)
          ? report.status
          : "open",
        resolution: report.resolution ?? null,
        createdAt: report.createdAt.toISOString(),
        resolvedAt: toTimestamp(report.resolvedAt),
      })),
      feedback: feedbackEntries.map(serializeFeedback),
      limits: limits.map((limit) => ({
        action: limit.action,
        maxRequests: limit.maxRequests,
        windowSeconds: limit.windowSeconds,
        updatedAt: limit.updatedAt.toISOString(),
      })),
      auditEvents: auditEvents.map((event) => ({
        id: event.id,
        actorId: event.actorId,
        actorRole: event.actorRole,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        metadata: event.metadata,
        createdAt: event.createdAt.toISOString(),
      })),
    }),
  );
});

router.patch("/admin/campaigns/current", async (req, res): Promise<void> => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const body = z.object({ minimumBid: z.coerce.number().int().min(1).max(100000) }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A whole-dollar minimum bid between $1 and $100,000 is required" });
    return;
  }
  const campaign = await ensureCurrentCampaign();
  const [updated] = await db
    .update(campaignsTable)
    .set({ minimumBidCents: Math.round(body.data.minimumBid * 100) })
    .where(eq(campaignsTable.id, campaign.id))
    .returning();
  res.json({
    id: updated?.id ?? campaign.id,
    number: updated?.number ?? campaign.number,
    minimumBid: (updated?.minimumBidCents ?? campaign.minimumBidCents) / 100,
  });
});

router.get("/admin/users", async (req, res): Promise<void> => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const parsedQuery = SearchAdminUsersQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Invalid member search" });
    return;
  }

  const search = parsedQuery.data.search?.trim();
  const verifiedMemberCondition = isNotNull(usersTable.clerkUserId);
  const searchCondition = search
    ? or(
        ilike(usersTable.displayName, `%${search}%`),
        ilike(usersTable.email, `%${search}%`),
        ilike(usersTable.clerkUserId, `%${search}%`),
      )
    : undefined;
  const users = await db
    .select()
    .from(usersTable)
    .where(
      searchCondition
        ? and(verifiedMemberCondition, inArray(usersTable.role, ["member", "moderator"]), searchCondition)
        : and(verifiedMemberCondition, inArray(usersTable.role, ["member", "moderator"])),
    )
    .orderBy(desc(usersTable.createdAt))
    .limit(50);

  res.json(SearchAdminUsersResponse.parse(users.map(serializeAdminUser)));
});

router.patch("/admin/users/:id/status", async (req, res): Promise<void> => {
  const actor = await requireModerator(req, res);
  if (!actor) return;
  const [params, body] = [
    UpdateAdminUserStatusParams.safeParse(req.params),
    UpdateAdminUserStatusBody.safeParse(req.body),
  ];
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid user moderation input" });
    return;
  }
  const outcome = await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, params.data.id))
      .limit(1);
    if (!target) return { kind: "missing" as const };
    if (roleRank[actor.role] <= roleRank[target.role]) {
      return { kind: "forbidden" as const };
    }
    const [user] = await tx
      .update(usersTable)
      .set({ status: body.data.status })
      .where(eq(usersTable.id, target.id))
      .returning();
    await tx.insert(auditEventsTable).values({
      id: randomUUID(), actorId: actor.id, actorRole: actor.role,
      action: `user.${body.data.status}`, targetType: "user", targetId: target.id,
      metadata: { reason: body.data.reason ?? null },
    });
    return { kind: "ok" as const, user };
  });
  if (outcome.kind === "missing") {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (outcome.kind === "forbidden") {
    res.status(403).json({ error: "Your role cannot change this account" });
    return;
  }
  const { user } = outcome;
  res.json(
    UpdateAdminUserStatusResponse.parse({
      id: user.id,
      email: user.email ?? "Private member",
      displayName: user.displayName,
      role: ["moderator", "admin"].includes(user.role) ? user.role : "member",
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    }),
  );
});

router.patch("/admin/users/:id/role", async (req, res): Promise<void> => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const [params, body] = [
    UpdateAdminUserRoleParams.safeParse(req.params),
    UpdateAdminUserRoleBody.safeParse(req.body),
  ];
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid user role input" });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, params.data.id))
      .limit(1);
    if (!target || !target.clerkUserId || !["member", "moderator"].includes(target.role)) {
      return { kind: "missing" as const };
    }
    if (roleRank[actor.role] <= roleRank[target.role]) {
      return { kind: "forbidden" as const };
    }
    if (target.role === body.data.role) {
      return { kind: "unchanged" as const };
    }

    const [user] = await tx
      .update(usersTable)
      .set({ role: body.data.role })
      .where(and(eq(usersTable.id, target.id), eq(usersTable.role, target.role)))
      .returning();
    if (!user) {
      return { kind: "conflict" as const };
    }
    await tx.insert(auditEventsTable).values({
      id: randomUUID(),
      actorId: actor.id,
      actorRole: actor.role,
      action: body.data.role === "moderator" ? "user.role_granted" : "user.role_revoked",
      targetType: "user",
      targetId: target.id,
      metadata: { previousRole: target.role, role: body.data.role },
    });
    return { kind: "ok" as const, user };
  });

  if (outcome.kind === "missing") {
    res.status(404).json({ error: "Verified member not found" });
    return;
  }
  if (outcome.kind === "forbidden") {
    res.status(403).json({ error: "Your role cannot change this account" });
    return;
  }
  if (outcome.kind === "unchanged") {
    res.status(409).json({ error: "User already has the requested role" });
    return;
  }
  if (outcome.kind === "conflict") {
    res.status(409).json({ error: "User role changed; refresh and try again" });
    return;
  }

  res.json(UpdateAdminUserRoleResponse.parse(serializeAdminUser(outcome.user)));
});

router.patch("/admin/listings/:id/status", async (req, res): Promise<void> => {
  const actor = await requireModerator(req, res);
  if (!actor) return;
  const [params, body] = [
    UpdateAdminListingStatusParams.safeParse(req.params),
    UpdateAdminListingStatusBody.safeParse(req.body),
  ];
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid listing moderation input" });
    return;
  }
  const [listing] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(listingsTable)
      .set({ status: body.data.status })
      .where(eq(listingsTable.id, params.data.id))
      .returning();
    if (updated[0]) {
      await tx.insert(auditEventsTable).values({
        id: randomUUID(), actorId: actor.id, actorRole: actor.role,
        action: `listing.${body.data.status}`, targetType: "listing", targetId: updated[0].id,
        metadata: { reason: body.data.reason ?? null },
      });
    }
    return updated;
  });
  if (!listing) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }
  const [clickStats] = await db
    .select({
      totalClicks: sql<string>`count(*)`,
      uniqueClicks: sql<string>`count(distinct ${listingClicksTable.visitorHash})`,
    })
    .from(listingClicksTable)
    .where(eq(listingClicksTable.listingId, listing.id));
  res.json(
    UpdateAdminListingStatusResponse.parse({
      id: listing.id,
      name: listing.name,
      slug: listing.slug,
      tagline: listing.tagline,
      description: listing.description,
      category: listing.category,
      initials: listing.initials,
      accent: listing.accent,
      rank: 0,
      effectiveBid: toDollars(listing.ownerBidCents),
      ownerBid: toDollars(listing.ownerBidCents),
      communitySupport: 0,
      penalties: 0,
      supporters: 0,
      penalizers: 0,
      rating: 0,
      reviewCount: 0,
      clicks: listing.clicks,
      clickAnalytics: {
        totalClicks: Number(clickStats?.totalClicks ?? 0),
        uniqueClicks: Number(clickStats?.uniqueClicks ?? 0),
      },
      createdAt: listing.createdAt.toISOString(),
      trend: 0,
      websiteUrl: listing.websiteUrl ?? null,
      demoVideoUrl: listing.demoVideoUrl ?? null,
      demoViewCount: listing.demoViewCount,
      logoUrl: listing.logoUrl ?? null,
      ownerId: listing.ownerId ?? null,
      status: listing.status === "suspended" ? "suspended" : "active",
    }),
  );
});

router.patch("/admin/reviews/:id/moderation", async (req, res): Promise<void> => {
  const actor = await requireModerator(req, res);
  if (!actor) return;
  const [params, body] = [
    ModerateReviewParams.safeParse(req.params),
    ModerateReviewBody.safeParse(req.body),
  ];
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid review moderation input" });
    return;
  }
  const [review] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(reviewsTable)
      .set({ status: body.data.status, moderationReason: body.data.reason ?? null })
      .where(eq(reviewsTable.id, params.data.id))
      .returning();
    if (updated[0]) {
      await tx.insert(auditEventsTable).values({
        id: randomUUID(), actorId: actor.id, actorRole: actor.role,
        action: `review.${body.data.status}`, targetType: "review", targetId: updated[0].id,
        metadata: { reason: body.data.reason ?? null },
      });
    }
    return updated;
  });
  if (!review) {
    res.status(404).json({ error: "Review not found" });
    return;
  }
  const [entry] = await db
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.id, review.ledgerEntryId))
    .limit(1);
  const votes = await db
    .select({ id: reviewVotesTable.id })
    .from(reviewVotesTable)
    .where(eq(reviewVotesTable.reviewId, review.id));
  res.json(
    ModerateReviewResponse.parse({
      id: review.id,
      kind: review.kind === "penalty" ? "penalty" : "support",
      author: review.displayName,
      amount: toDollars(entry?.amountCents ?? 0),
      rating: review.rating,
      reason: review.reason,
      body: review.body,
      createdAt: review.createdAt.toISOString(),
      helpfulCount: votes.length,
      ownerReply:
        review.ownerReply && review.ownerReplyAuthor && review.ownerReplyAt
          ? {
              author: review.ownerReplyAuthor,
              body: review.ownerReply,
              createdAt: review.ownerReplyAt.toISOString(),
            }
          : null,
      listingId: review.listingId,
      status: review.status,
      moderationReason: review.moderationReason ?? null,
    }),
  );
});

router.patch("/admin/reports/:id", async (req, res): Promise<void> => {
  const actor = await requireModerator(req, res);
  if (!actor) return;
  const [params, body] = [
    ResolveReportParams.safeParse(req.params),
    ResolveReportBody.safeParse(req.body),
  ];
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid report resolution input" });
    return;
  }
  const finalStatus = ["resolved", "dismissed"].includes(body.data.status);
  const [report] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(reportsTable)
      .set({
        status: body.data.status,
        resolution: body.data.resolution ?? null,
        resolvedById: finalStatus ? actor.id : null,
        resolvedAt: finalStatus ? new Date() : null,
      })
      .where(eq(reportsTable.id, params.data.id))
      .returning();
    if (updated[0]) {
      await tx.insert(auditEventsTable).values({
        id: randomUUID(), actorId: actor.id, actorRole: actor.role,
        action: `report.${body.data.status}`, targetType: "report", targetId: updated[0].id,
        metadata: { resolution: body.data.resolution ?? null },
      });
    }
    return updated;
  });
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(
    ResolveReportResponse.parse({
      ...report,
      reporterId: report.reporterId ?? null,
      resolution: report.resolution ?? null,
      createdAt: report.createdAt.toISOString(),
      resolvedAt: toTimestamp(report.resolvedAt),
    }),
  );
});

router.patch("/admin/feedback/:id", async (req, res): Promise<void> => {
  const actor = await requireModerator(req, res);
  if (!actor) return;
  const [params, body] = [
    ResolveFeedbackParams.safeParse(req.params),
    ResolveFeedbackBody.safeParse(req.body),
  ];
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid feedback resolution input" });
    return;
  }
  const finalStatus = ["resolved", "dismissed"].includes(body.data.status);
  const [feedback] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(feedbackTable)
      .set({
        status: body.data.status,
        resolution: body.data.resolution ?? null,
        resolvedById: finalStatus ? actor.id : null,
        resolvedAt: finalStatus ? new Date() : null,
      })
      .where(eq(feedbackTable.id, params.data.id))
      .returning();
    if (updated[0]) {
      await tx.insert(auditEventsTable).values({
        id: randomUUID(), actorId: actor.id, actorRole: actor.role,
        action: `feedback.${body.data.status}`, targetType: "feedback", targetId: updated[0].id,
        metadata: { resolution: body.data.resolution ?? null },
      });
    }
    return updated;
  });
  if (!feedback) {
    res.status(404).json({ error: "Feedback not found" });
    return;
  }
  res.json(ResolveFeedbackResponse.parse(serializeFeedback(feedback)));
});

router.patch("/admin/limits/:action", async (req, res): Promise<void> => {
  const actor = await requireModerator(req, res);
  if (!actor) return;
  const [params, body] = [
    UpdateRateLimitParams.safeParse(req.params),
    UpdateRateLimitBody.safeParse(req.body),
  ];
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid rate limit input" });
    return;
  }
  const [limit] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(rateLimitsTable)
      .set(body.data)
      .where(eq(rateLimitsTable.action, params.data.action))
      .returning();
    if (updated[0]) {
      await tx.insert(auditEventsTable).values({
        id: randomUUID(), actorId: actor.id, actorRole: actor.role,
        action: "rate_limit.updated", targetType: "rate_limit", targetId: updated[0].action,
        metadata: { maxRequests: updated[0].maxRequests, windowSeconds: updated[0].windowSeconds },
      });
    }
    return updated;
  });
  if (!limit) {
    res.status(404).json({ error: "Rate limit not found" });
    return;
  }
  res.json(
    UpdateRateLimitResponse.parse({
      action: limit.action,
      maxRequests: limit.maxRequests,
      windowSeconds: limit.windowSeconds,
      updatedAt: limit.updatedAt.toISOString(),
    }),
  );
});

export default router;
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  GetPolicyParams,
  GetPolicyResponse,
  GetPoliciesResponse,
  GetSiteSettingsResponse,
  GetAdminPoliciesResponse,
  CreatePolicyAcceptanceBody,
  CreatePolicyAcceptanceResponse,
  UpdateAdminPolicyBody,
  UpdateAdminPolicyParams,
  UpdateAdminPolicyResponse,
  UpdateAdminSiteSettingsBody,
  UpdateAdminSiteSettingsResponse,
  ModerateListingParams,
  ModerateListingBody,
  ModerateListingResponse,
} from "@workspace/api-zod";
import {
  auditEventsTable,
  db,
  listingClicksTable,
  listingsTable,
  policiesTable,
  policyAcceptancesTable,
  siteSettingsTable,
  type SiteSetting,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  enforceActionRateLimit,
  requireActiveActor,
  requireAdmin,
  requireModerator,
} from "../lib/moderation";
import { DEFAULT_SITE_SETTINGS } from "../lib/policy-content";

const router: IRouter = Router();

const KNOWN_POLICY_TYPES = [
  "terms",
  "privacy",
  "website_policy",
  "refund_policy",
  "community_guidelines",
  "grievance",
] as const;

const KNOWN_SITE_SETTING_KEYS = Object.keys(DEFAULT_SITE_SETTINGS);

function serializePolicy(policy: typeof policiesTable.$inferSelect) {
  return {
    policyType: policy.policyType,
    title: policy.title,
    content: policy.content,
    version: policy.version,
    publishedAt: policy.publishedAt?.toISOString() ?? null,
  };
}

function serializeAdminPolicy(policy: typeof policiesTable.$inferSelect) {
  return {
    ...serializePolicy(policy),
    status: policy.status === "draft" ? "draft" : "published",
    updatedById: policy.updatedById ?? null,
    updatedAt: policy.updatedAt.toISOString(),
  };
}

router.get("/policies", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(policiesTable)
    .where(eq(policiesTable.status, "published"));
  res.json(GetPoliciesResponse.parse(rows.map(serializePolicy)));
});

router.get("/policies/:policyType", async (req, res): Promise<void> => {
  const params = GetPolicyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [policy] = await db
    .select()
    .from(policiesTable)
    .where(eq(policiesTable.policyType, params.data.policyType))
    .limit(1);
  if (!policy || policy.status !== "published") {
    res.status(404).json({ error: "Policy not found" });
    return;
  }
  res.json(GetPolicyResponse.parse(serializePolicy(policy)));
});

// Shared by GET /site-settings and the PATCH response so both always agree
// on shape -- taxRatePercent is stored as text like every other setting,
// but parsed to a number here since that's what SiteSettings promises.
function serializeSiteSettings(rows: SiteSetting[]) {
  const byKey = new Map(rows.map((row) => [row.key, row.value ?? null]));
  const rawTaxRate = byKey.get("taxRatePercent");
  const taxRatePercent = rawTaxRate ? Number(rawTaxRate) : null;
  const rawSponsorshipPrice = byKey.get("sponsorshipPriceCents");
  const rawSponsorshipDuration = byKey.get("sponsorshipDurationDays");
  const sponsorshipPriceCents = rawSponsorshipPrice ? Number(rawSponsorshipPrice) : null;
  const sponsorshipDurationDays = rawSponsorshipDuration ? Number(rawSponsorshipDuration) : null;
  return {
    businessName: byKey.get("businessName") || null,
    businessAddress: byKey.get("businessAddress") || null,
    supportEmail: byKey.get("supportEmail") || null,
    grievanceOfficerName: byKey.get("grievanceOfficerName") || null,
    grievanceOfficerEmail: byKey.get("grievanceOfficerEmail") || null,
    invoiceAdminEmail: byKey.get("invoiceAdminEmail") || null,
    taxRatePercent: Number.isFinite(taxRatePercent) ? taxRatePercent : null,
    taxRegistrationNumber: byKey.get("taxRegistrationNumber") || null,
    taxLabel: byKey.get("taxLabel") || null,
    // Null means "admin has not configured an override yet" -- callers that
    // need a concrete usable value (checkout, admin panel default display)
    // fall back to the built-in defaults in lib/sponsorships.ts, not here.
    sponsorshipPriceCents: Number.isFinite(sponsorshipPriceCents) ? sponsorshipPriceCents : null,
    sponsorshipDurationDays: Number.isFinite(sponsorshipDurationDays) ? sponsorshipDurationDays : null,
  };
}

router.get("/site-settings", async (_req, res): Promise<void> => {
  const rows = await db.select().from(siteSettingsTable);
  res.json(GetSiteSettingsResponse.parse(serializeSiteSettings(rows)));
});

router.post("/policy-acceptances", async (req, res): Promise<void> => {
  const actor = await requireActiveActor(req, res);
  if (!actor) return;
  const body = CreatePolicyAcceptanceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const allowed = await enforceActionRateLimit(res, "policy_acceptance", actor.id);
  if (!allowed) return;

  const [policy] = await db
    .select({ version: policiesTable.version })
    .from(policiesTable)
    .where(eq(policiesTable.policyType, body.data.policyType))
    .limit(1);

  const [acceptance] = await db
    .insert(policyAcceptancesTable)
    .values({
      id: randomUUID(),
      userId: actor.id,
      policyType: body.data.policyType,
      policyVersion: policy?.version ?? 1,
      context: body.data.context,
    })
    .returning();

  res.status(201).json(
    CreatePolicyAcceptanceResponse.parse({
      id: acceptance.id,
      userId: acceptance.userId,
      policyType: acceptance.policyType,
      policyVersion: acceptance.policyVersion,
      context: acceptance.context,
      createdAt: acceptance.createdAt.toISOString(),
    }),
  );
});

router.get("/admin/policies", async (req, res): Promise<void> => {
  const actor = await requireModerator(req, res);
  if (!actor) return;
  const rows = await db.select().from(policiesTable);
  res.json(GetAdminPoliciesResponse.parse(rows.map(serializeAdminPolicy)));
});

router.patch("/admin/policies/:policyType", async (req, res): Promise<void> => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const params = UpdateAdminPolicyParams.safeParse(req.params);
  const body = UpdateAdminPolicyBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid policy update input" });
    return;
  }
  if (!KNOWN_POLICY_TYPES.includes(params.data.policyType as (typeof KNOWN_POLICY_TYPES)[number])) {
    res.status(404).json({ error: "Unknown policy type" });
    return;
  }
  const nextStatus = body.data.status ?? "published";

  const [policy] = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(policiesTable)
      .where(eq(policiesTable.policyType, params.data.policyType))
      .limit(1);

    const nextVersion = existing ? existing.version + 1 : 1;
    const updated = await tx
      .insert(policiesTable)
      .values({
        policyType: params.data.policyType,
        title: body.data.title,
        content: body.data.content,
        version: nextVersion,
        status: nextStatus,
        updatedById: actor.id,
        publishedAt: nextStatus === "published" ? new Date() : existing?.publishedAt ?? null,
      })
      .onConflictDoUpdate({
        target: policiesTable.policyType,
        set: {
          title: body.data.title,
          content: body.data.content,
          version: nextVersion,
          status: nextStatus,
          updatedById: actor.id,
          publishedAt: nextStatus === "published" ? new Date() : existing?.publishedAt ?? null,
        },
      })
      .returning();

    if (updated[0]) {
      await tx.insert(auditEventsTable).values({
        id: randomUUID(),
        actorId: actor.id,
        actorRole: actor.role,
        action: `policy.${nextStatus}`,
        targetType: "policy",
        targetId: updated[0].policyType,
        metadata: { version: updated[0].version },
      });
    }
    return updated;
  });

  res.json(UpdateAdminPolicyResponse.parse(serializeAdminPolicy(policy)));
});

router.patch("/admin/site-settings", async (req, res): Promise<void> => {
  const actor = await requireAdmin(req, res);
  if (!actor) return;
  const body = UpdateAdminSiteSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // taxRatePercent is the one setting that's a number over the wire but
  // text in storage (like every other site setting) -- convert it here so
  // the loop below can treat every entry identically.
  const { taxRatePercent, sponsorshipPriceCents, sponsorshipDurationDays, ...rest } = body.data;
  const entries = Object.entries(rest).filter(([key]) => KNOWN_SITE_SETTING_KEYS.includes(key)) as [
    string,
    string | null | undefined,
  ][];
  if (taxRatePercent !== undefined) {
    entries.push(["taxRatePercent", taxRatePercent === null ? null : String(taxRatePercent)]);
  }
  if (sponsorshipPriceCents !== undefined) {
    entries.push(["sponsorshipPriceCents", sponsorshipPriceCents === null ? null : String(sponsorshipPriceCents)]);
  }
  if (sponsorshipDurationDays !== undefined) {
    entries.push(["sponsorshipDurationDays", sponsorshipDurationDays === null ? null : String(sponsorshipDurationDays)]);
  }

  await db.transaction(async (tx) => {
    for (const [key, value] of entries) {
      await tx
        .insert(siteSettingsTable)
        .values({ key, value: value ?? null })
        .onConflictDoUpdate({
          target: siteSettingsTable.key,
          set: { value: value ?? null },
        });
    }
    if (entries.length > 0) {
      await tx.insert(auditEventsTable).values({
        id: randomUUID(),
        actorId: actor.id,
        actorRole: actor.role,
        action: "site_settings.updated",
        targetType: "site_settings",
        targetId: "global",
        metadata: { keys: entries.map(([key]) => key) },
      });
    }
  });

  const rows = await db.select().from(siteSettingsTable);
  res.json(UpdateAdminSiteSettingsResponse.parse(serializeSiteSettings(rows)));
});

router.patch("/admin/listings/:id/moderation", async (req, res): Promise<void> => {
  const actor = await requireModerator(req, res);
  if (!actor) return;
  const params = ModerateListingParams.safeParse(req.params);
  const body = ModerateListingBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid listing moderation input" });
    return;
  }

  const legacyStatus = ["suspended", "removed"].includes(body.data.moderationStatus)
    ? "suspended"
    : "active";

  const [listing] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(listingsTable)
      .set({
        moderationStatus: body.data.moderationStatus,
        moderationReason: body.data.reason ?? null,
        moderatedAt: new Date(),
        moderatedById: actor.id,
        status: legacyStatus,
      })
      .where(eq(listingsTable.id, params.data.id))
      .returning();
    if (updated[0]) {
      await tx.insert(auditEventsTable).values({
        id: randomUUID(),
        actorId: actor.id,
        actorRole: actor.role,
        action: `listing.moderation.${body.data.moderationStatus}`,
        targetType: "listing",
        targetId: updated[0].id,
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
    ModerateListingResponse.parse({
      id: listing.id,
      name: listing.name,
      slug: listing.slug,
      tagline: listing.tagline,
      description: listing.description,
      category: listing.category,
      initials: listing.initials,
      accent: listing.accent,
      rank: 0,
      effectiveBid: Math.round(listing.ownerBidCents) / 100,
      ownerBid: Math.round(listing.ownerBidCents) / 100,
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
      ownerId: listing.ownerId ?? null,
      status: listing.status === "suspended" ? "suspended" : "active",
      moderationStatus: listing.moderationStatus,
      moderationReason: listing.moderationReason ?? null,
      moderatedAt: listing.moderatedAt?.toISOString() ?? null,
    }),
  );
});

export default router;

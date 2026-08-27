import { randomUUID } from "node:crypto";
import {
  campaignListingsTable,
  campaignsTable,
  campaignWinnersTable,
  db,
  ledgerEntriesTable,
  listingsTable,
  paymentsTable,
  reviewsTable,
  type Campaign,
  type LedgerEntry,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { CAMPAIGN_LOCK_KEY } from "./advisory-locks";

export const DEFAULT_MINIMUM_BID_CENTS = 500;

type CampaignTotals = {
  ownerBidCents: number;
  supportTotalCents: number;
  penaltyTotalCents: number;
  effectiveBidCents: number;
  reachedAt: Date | null;
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Campaign boundaries are UTC Sunday 00:00 through the following UTC Sunday
 * 00:00. Keeping the boundary server-derived makes the race identical for all
 * visitors and prevents browser clocks from deciding the active campaign.
 */
export function campaignWindow(now = new Date()): { startAt: Date; endAt: Date } {
  const startAt = new Date(now);
  startAt.setUTCHours(0, 0, 0, 0);
  startAt.setUTCDate(startAt.getUTCDate() - startAt.getUTCDay());
  const endAt = new Date(startAt);
  endAt.setUTCDate(endAt.getUTCDate() + 7);
  return { startAt, endAt };
}

function totalsFor(entries: LedgerEntry[]): CampaignTotals {
  const refunds = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type === "REFUND" && entry.refundOfLedgerEntryId) {
      refunds.set(
        entry.refundOfLedgerEntryId,
        (refunds.get(entry.refundOfLedgerEntryId) ?? 0) + entry.amountCents,
      );
    }
  }
  const amount = (type: "OWNER_BID" | "COMMUNITY_BID" | "PENALTY") =>
    entries
      .filter((entry) => entry.type === type)
      .reduce(
        (sum, entry) => sum + Math.max(0, entry.amountCents - (refunds.get(entry.id) ?? 0)),
        0,
      );
  const ownerBidCents = amount("OWNER_BID");
  const supportTotalCents = amount("COMMUNITY_BID");
  const penaltyTotalCents = amount("PENALTY");
  const effectiveBidCents = ownerBidCents + supportTotalCents - penaltyTotalCents;

  let running = 0;
  let reachedAt: Date | null = null;
  const originalById = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of [...entries].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())) {
    if (entry.type === "OWNER_BID" || entry.type === "COMMUNITY_BID") running += entry.amountCents;
    if (entry.type === "PENALTY") running -= entry.amountCents;
    if (entry.type === "REFUND" && entry.refundOfLedgerEntryId) {
      const original = originalById.get(entry.refundOfLedgerEntryId);
      if (original?.type === "OWNER_BID" || original?.type === "COMMUNITY_BID") {
        running -= entry.amountCents;
      }
      if (original?.type === "PENALTY") running += entry.amountCents;
    }
    if (reachedAt === null && running === effectiveBidCents) reachedAt = entry.createdAt;
  }

  return {
    ownerBidCents,
    supportTotalCents,
    penaltyTotalCents,
    effectiveBidCents,
    reachedAt,
  };
}

async function closeCampaign(tx: Transaction, campaign: Campaign, completedAt: Date) {
  const entries = await tx
    .select()
    .from(ledgerEntriesTable)
    .where(
      and(
        eq(ledgerEntriesTable.campaignId, campaign.id),
        inArray(ledgerEntriesTable.status, ["sandbox_verified", "verified", "refunded"]),
      ),
    );
  const byListing = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const current = byListing.get(entry.listingId) ?? [];
    current.push(entry);
    byListing.set(entry.listingId, current);
  }

  const standings = [...byListing.entries()]
    .map(([listingId, listingEntries]) => ({ listingId, ...totalsFor(listingEntries) }))
    .filter((item) => item.ownerBidCents >= campaign.minimumBidCents)
    .sort((left, right) => {
      if (right.effectiveBidCents !== left.effectiveBidCents) {
        return right.effectiveBidCents - left.effectiveBidCents;
      }
      const leftReached = left.reachedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightReached = right.reachedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (leftReached !== rightReached) return leftReached - rightReached;
      return left.listingId.localeCompare(right.listingId);
    });

  for (const [index, item] of standings.entries()) {
    await tx
      .insert(campaignListingsTable)
      .values({
        id: randomUUID(),
        campaignId: campaign.id,
        listingId: item.listingId,
        ownerBidCents: item.ownerBidCents,
        supportTotalCents: item.supportTotalCents,
        penaltyTotalCents: item.penaltyTotalCents,
        effectiveBidCents: item.effectiveBidCents,
        rank: index + 1,
        finalRank: index + 1,
        effectiveBidReachedAt: item.reachedAt,
      })
      .onConflictDoUpdate({
        target: [campaignListingsTable.campaignId, campaignListingsTable.listingId],
        set: {
          ownerBidCents: item.ownerBidCents,
          supportTotalCents: item.supportTotalCents,
          penaltyTotalCents: item.penaltyTotalCents,
          effectiveBidCents: item.effectiveBidCents,
          rank: index + 1,
          finalRank: index + 1,
          effectiveBidReachedAt: item.reachedAt,
        },
      });
  }

  const winner = standings[0];
  if (winner) {
    await tx
      .insert(campaignWinnersTable)
      .values({
        id: randomUUID(),
        campaignId: campaign.id,
        listingId: winner.listingId,
        finalEffectiveBidCents: winner.effectiveBidCents,
        finalRank: 1,
        declaredAt: completedAt,
      })
      .onConflictDoNothing({ target: campaignWinnersTable.campaignId });
  }
  await tx
    .update(campaignsTable)
    .set({
      status: "completed",
      winnerListingId: winner?.listingId ?? null,
      winnerEffectiveBidCents: winner?.effectiveBidCents ?? null,
      completedAt,
    })
    .where(eq(campaignsTable.id, campaign.id));
}

/**
 * Returns the live weekly campaign, closing an expired week and creating the
 * next one in the same locked database transaction. This is safe to call from
 * a request path and from the scheduler; only one caller can finalize a week.
 */
export async function ensureCurrentCampaign(now = new Date()): Promise<Campaign> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(CAMPAIGN_LOCK_KEY))})`);
    const [live] = await tx
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.status, "live"))
      .orderBy(desc(campaignsTable.startAt))
      .limit(1)
      .for("update");

    if (live && live.endAt.getTime() > now.getTime()) return live;
    if (live) await closeCampaign(tx, live, now);
    if (live) {
      // Listing owner totals are a cache for the live campaign. The immutable
      // campaign listing snapshot above retains the completed week's totals;
      // reset the cache before exposing the new campaign.
      await tx
        .update(listingsTable)
        .set({ ownerBidCents: 0 })
        .where(sql`true`);
    }

    const { startAt, endAt } = campaignWindow(now);
    const [existing] = await tx
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.startAt, startAt))
      .limit(1)
      .for("update");
    if (existing) return existing;

    const [latest] = await tx
      .select({ number: campaignsTable.number })
      .from(campaignsTable)
      .orderBy(desc(campaignsTable.number))
      .limit(1);
    const [created] = await tx
      .insert(campaignsTable)
      .values({
        id: randomUUID(),
        number: (latest?.number ?? 0) + 1,
        startAt,
        endAt,
        status: "live",
        minimumBidCents: DEFAULT_MINIMUM_BID_CENTS,
      })
      .returning();
    if (!created) throw new Error("Unable to create the live campaign");
    return created;
  });
}

export async function assignLegacyRecordsToCampaign(campaignId: string): Promise<void> {
  await Promise.all([
    db
      .update(ledgerEntriesTable)
      .set({ campaignId })
      .where(isNull(ledgerEntriesTable.campaignId)),
    db.update(paymentsTable).set({ campaignId }).where(isNull(paymentsTable.campaignId)),
    db.update(reviewsTable).set({ campaignId }).where(isNull(reviewsTable.campaignId)),
  ]);
}

export async function runCampaignScheduler(): Promise<void> {
  await ensureCurrentCampaign();
}
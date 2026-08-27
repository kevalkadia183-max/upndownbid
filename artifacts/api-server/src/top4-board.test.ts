import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  db,
  campaignsTable,
  campaignListingsTable,
  ledgerEntriesTable,
  listingsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetTop4BoardResponse, GetListingsResponse } from "@workspace/api-zod";
import { createApp } from "./app";
import { ensureCurrentCampaign } from "./lib/campaigns";
import { ensureSignalRankSeed } from "./lib/signalrank-seed";

// Guards the homepage TOP 4 / WINNERS board (GET /api/campaigns/top4):
//   - "live" mode must exactly mirror the existing ranking system's current
//     top listings (no second ranking algorithm) while no prior campaign has
//     completed yet.
//   - "final" mode must serve the previous campaign's frozen top 4 straight
//     from campaign_listings.final_rank -- data written exactly once by the
//     real closeCampaign() rollover (lib/campaigns.ts) -- and that frozen
//     snapshot must never change because of ongoing activity in the current
//     live campaign.
//   - Fewer than 4 finalized listings must be handled gracefully (no
//     padding, no error).
//
// This suite runs alongside other test files against one shared disposable
// database (see test-security.mjs), so -- following the same isolation
// pattern moderation-security.test.ts uses for its own ended-campaign
// fixture -- the "previous completed campaign" here is a hand-inserted,
// clearly-marked fixture rather than a real forced weekly rollover: forcing
// ensureCurrentCampaign() to roll the actual shared "current campaign"
// forward would also finalize whatever other suites are concurrently
// relying on that campaign staying live.

let server: Server;
let baseUrl = "";
let currentCampaignId = "";

const fakeCampaignId = `campaign-top4-test-${randomUUID()}`;
const fakeCampaignNumber = -900_000_000; // guaranteed lower than any real or fixture campaign number
let winnerListingId = "";
let runnerUpListingId = "";
let lateListingId = "";
let lateLedgerEntryId = "";

before(async () => {
  await ensureSignalRankSeed();
  const campaign = await ensureCurrentCampaign();
  currentCampaignId = campaign.id;

  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (lateLedgerEntryId) {
    await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, lateLedgerEntryId));
  }
  if (lateListingId) {
    await db.delete(listingsTable).where(eq(listingsTable.id, lateListingId));
  }
  await db.delete(campaignListingsTable).where(eq(campaignListingsTable.campaignId, fakeCampaignId));
  await db.delete(campaignsTable).where(eq(campaignsTable.id, fakeCampaignId));
  if (winnerListingId) {
    await db.delete(listingsTable).where(eq(listingsTable.id, winnerListingId));
  }
  if (runnerUpListingId) {
    await db.delete(listingsTable).where(eq(listingsTable.id, runnerUpListingId));
  }
});

describe("GET /api/campaigns/top4", () => {
  it("mirrors the existing live ranking system before any campaign has completed", async () => {
    // Other test files exercise the same shared current-campaign listings
    // concurrently, so a bid can land between two separate requests. Retry
    // a tight fetch pair a few times rather than tolerating a flaky
    // mismatch or a wide race window from a single attempt.
    let board!: ReturnType<typeof GetTop4BoardResponse.parse>;
    let expected!: ReturnType<typeof GetListingsResponse.parse>;
    let lastMismatch = "";
    let matched = false;
    for (let attempt = 0; attempt < 5 && !matched; attempt += 1) {
      const top4Response = await fetch(`${baseUrl}/api/campaigns/top4`);
      const listingsResponse = await fetch(`${baseUrl}/api/listings`);
      assert.equal(top4Response.status, 200);
      assert.equal(listingsResponse.status, 200);
      board = GetTop4BoardResponse.parse(await top4Response.json());
      const listings = GetListingsResponse.parse(await listingsResponse.json());
      expected = listings.slice(0, 4);
      matched =
        board.mode === "live" &&
        board.entries.length === expected.length &&
        board.entries.every(
          (entry, index) =>
            entry.rank === expected[index].rank &&
            entry.listing.slug === expected[index].slug &&
            entry.effectiveBid === expected[index].effectiveBid,
        );
      if (!matched) {
        lastMismatch = JSON.stringify({ board, expected });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.ok(matched, `top4 live entries never matched /api/listings top ranking: ${lastMismatch}`);
  });

  it("freezes to the previous campaign's final top 4 once one has completed, gracefully handling fewer than 4 winners", async () => {
    winnerListingId = `listing-top4-winner-${randomUUID()}`;
    runnerUpListingId = `listing-top4-runnerup-${randomUUID()}`;
    await db.insert(listingsTable).values([
      {
        id: winnerListingId,
        name: "Top4 Test Winner",
        slug: `top4-test-winner-${randomUUID()}`,
        tagline: "Frozen campaign winner fixture.",
        description: "Seeded by the top4-board test suite.",
        category: "Testing",
        initials: "TW",
        accent: "#7c3aed",
        ownerBidCents: 0,
      },
      {
        id: runnerUpListingId,
        name: "Top4 Test Runner Up",
        slug: `top4-test-runnerup-${randomUUID()}`,
        tagline: "Frozen campaign runner-up fixture.",
        description: "Seeded by the top4-board test suite.",
        category: "Testing",
        initials: "TR",
        accent: "#f59e0b",
        ownerBidCents: 0,
      },
    ]);

    const startAt = new Date("2000-01-02T00:00:00.000Z"); // a Sunday, far from any real campaign window
    const endAt = new Date("2000-01-09T00:00:00.000Z");
    await db.insert(campaignsTable).values({
      id: fakeCampaignId,
      number: fakeCampaignNumber,
      status: "completed",
      startAt,
      endAt,
      completedAt: endAt,
      winnerListingId,
      winnerEffectiveBidCents: 5000,
    });
    await db.insert(campaignListingsTable).values([
      {
        id: `campaign-listing-top4-${randomUUID()}`,
        campaignId: fakeCampaignId,
        listingId: winnerListingId,
        effectiveBidCents: 5000,
        rank: 1,
        finalRank: 1,
      },
      {
        id: `campaign-listing-top4-${randomUUID()}`,
        campaignId: fakeCampaignId,
        listingId: runnerUpListingId,
        effectiveBidCents: 3000,
        rank: 2,
        finalRank: 2,
      },
    ]);

    const response = await fetch(`${baseUrl}/api/campaigns/top4`);
    assert.equal(response.status, 200);
    const board = GetTop4BoardResponse.parse(await response.json());

    assert.equal(board.mode, "final");
    assert.equal(board.campaignNumber, fakeCampaignNumber);
    assert.equal(board.entries.length, 2, "only the two finalized listings should appear, with no padding");
    assert.equal(board.entries[0].rank, 1);
    assert.equal(board.entries[0].listing.id, winnerListingId);
    assert.equal(board.entries[0].effectiveBid, 50);
    assert.equal(board.entries[1].rank, 2);
    assert.equal(board.entries[1].listing.id, runnerUpListingId);
    assert.equal(board.entries[1].effectiveBid, 30);
  });

  it("stays frozen even as the current live campaign keeps changing", async () => {
    const before = GetTop4BoardResponse.parse(
      await (await fetch(`${baseUrl}/api/campaigns/top4`)).json(),
    );

    // Simulate ongoing activity in the current live campaign: a brand-new,
    // very highly-bid listing that would otherwise dominate any live
    // ranking. It must have zero effect on the frozen "final" board above.
    lateListingId = `listing-top4-late-${randomUUID()}`;
    await db.insert(listingsTable).values({
      id: lateListingId,
      name: "Top4 Test Late Entrant",
      slug: `top4-test-late-${randomUUID()}`,
      tagline: "Should never affect a frozen winners board.",
      description: "Seeded by the top4-board test suite.",
      category: "Testing",
      initials: "TL",
      accent: "#22c55e",
      ownerBidCents: 100_00,
    });
    lateLedgerEntryId = `ledger-top4-late-${randomUUID()}`;
    await db.insert(ledgerEntriesTable).values({
      id: lateLedgerEntryId,
      listingId: lateListingId,
      campaignId: currentCampaignId,
      type: "OWNER_BID",
      amountCents: 100_00,
      status: "verified",
    });

    const after = GetTop4BoardResponse.parse(
      await (await fetch(`${baseUrl}/api/campaigns/top4`)).json(),
    );
    assert.deepEqual(after, before, "the frozen winners board must be unaffected by new live-campaign activity");
  });
});

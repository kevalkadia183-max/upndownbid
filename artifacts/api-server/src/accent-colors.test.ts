import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db, listingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateListingResponse } from "@workspace/api-zod";
import { createApp } from "./app";
import { ensureSignalRankSeed } from "./lib/signalrank-seed";
import { accentFrom, isValidHexColor, resolveAccent } from "./lib/accent-colors";

// Covers project task #76 (listing brand colors that silently fail to
// render): a listing's `accent` column is used directly as a CSS color
// value everywhere it displays (Top 4 board, listing cards, sponsorship
// grid, featured-sponsors popup). Historically it was populated from a
// fixed set of plain color names -- some valid CSS keywords ("coral",
// "blue", "violet"), some not ("amber", "mint") -- so certain listings
// rendered with no brand tint at all, silently. These tests guard the two
// fixes: (1) every freshly-created listing gets a real, guaranteed-valid
// hex accent, and (2) any legacy name (valid or not) resolves to the same
// hex color rather than being trusted as-is.

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

describe("accent-colors: legacy-name resolution", () => {
  it("returns a real hex color for every previously-used accent name, valid or not", () => {
    const legacyNames = ["coral", "blue", "violet", "amber", "mint", "CORAL", " Amber "];
    for (const name of legacyNames) {
      const resolved = resolveAccent(name, "fallback seed");
      assert.match(resolved, HEX_PATTERN, `expected ${name} to resolve to a hex color, got ${resolved}`);
    }
  });

  it("leaves an already-valid hex value untouched", () => {
    assert.equal(resolveAccent("#7c3aed", "fallback seed"), "#7c3aed");
  });

  it("deterministically falls back to the palette for a totally unrecognized value", () => {
    const resolved = resolveAccent("slate", "Probe2 Listing");
    assert.match(resolved, HEX_PATTERN);
    // Same seed must always resolve to the same fallback color.
    assert.equal(resolveAccent("slate", "Probe2 Listing"), resolved);
    assert.equal(resolveAccent("not-a-color-either", "Probe2 Listing"), resolved);
  });

  it("accentFrom always returns a valid hex color regardless of input", () => {
    for (const name of ["Beacon", "Kite", "", "a very long listing name indeed"]) {
      assert.ok(isValidHexColor(accentFrom(name)), `accentFrom(${JSON.stringify(name)}) must be valid hex`);
    }
  });
});

const CLERK_AUTH_BRAND = Symbol.for("@clerk/express.auth");

function fakeAuthHandler(userId: string | null) {
  const handler = () => ({
    tokenType: "session_token",
    actor: null,
    sessionClaims: userId ? { email: `${userId}@example.test`, email_verified: true } : null,
    sessionId: userId ? `sess_${userId}` : null,
    sessionStatus: userId ? "active" : null,
    userId,
    orgId: null,
    orgRole: null,
    orgSlug: null,
    orgPermissions: null,
    factorVerificationAge: null,
    getToken: async () => null,
    has: () => false,
    debug: () => ({}),
    isAuthenticated: Boolean(userId),
  });
  return Object.assign(handler, { [CLERK_AUTH_BRAND]: true });
}

function testClerkAuthMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const testUserId = req.header("x-test-clerk-user-id") ?? null;
    (req as unknown as { auth: unknown }).auth = fakeAuthHandler(testUserId);
    next();
  };
}

describe("POST /api/me/listings: created listings get a rendering-safe accent", () => {
  let server: Server;
  let baseUrl = "";
  const createdListingIds: string[] = [];
  const testUserId = `accent-test-owner-${randomUUID()}`;

  before(async () => {
    await ensureSignalRankSeed();
    const app = createApp({ clerkAuthMiddleware: testClerkAuthMiddleware() });
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
    for (const id of createdListingIds) {
      await db.delete(listingsTable).where(eq(listingsTable.id, id));
    }
  });

  it("assigns a real hex accent color, never a bare CSS-keyword name", async () => {
    const response = await fetch(`${baseUrl}/api/me/listings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "x-test-clerk-user-id": testUserId,
      },
      body: JSON.stringify({
        name: `Accent Test ${randomUUID()}`,
        tagline: "Verifies newly created listings always render their brand color.",
        description: "Created by the accent-colors test suite.",
        category: "Testing",
        ownerBid: 0,
      }),
    });
    assert.equal(response.status, 201);
    const listing = CreateListingResponse.parse(await response.json());
    createdListingIds.push(listing.id);

    assert.match(listing.accent, HEX_PATTERN, `expected a hex accent, got ${listing.accent}`);

    const [row] = await db
      .select({ accent: listingsTable.accent })
      .from(listingsTable)
      .where(eq(listingsTable.id, listing.id));
    assert.ok(row);
    assert.match(row!.accent, HEX_PATTERN, "the stored row itself must be hex, not just the API response");
  });

  it("stores an owner-chosen brand color exactly as submitted", async () => {
    const chosen = "#2DD4BF";
    const response = await fetch(`${baseUrl}/api/me/listings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "x-test-clerk-user-id": testUserId,
      },
      body: JSON.stringify({
        name: `Accent Choice Test ${randomUUID()}`,
        tagline: "Verifies an owner-chosen brand color is honored.",
        description: "Created by the accent-colors test suite.",
        category: "Testing",
        ownerBid: 0,
        accent: chosen,
      }),
    });
    assert.equal(response.status, 201);
    const listing = CreateListingResponse.parse(await response.json());
    createdListingIds.push(listing.id);
    assert.equal(listing.accent, chosen);
  });

  it("rejects a non-hex brand color on creation instead of silently storing it", async () => {
    const response = await fetch(`${baseUrl}/api/me/listings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "x-test-clerk-user-id": testUserId,
      },
      body: JSON.stringify({
        name: `Accent Reject Test ${randomUUID()}`,
        tagline: "Verifies an invalid brand color is rejected.",
        description: "Created by the accent-colors test suite.",
        category: "Testing",
        ownerBid: 0,
        accent: "not-a-color",
      }),
    });
    assert.equal(response.status, 400);
  });

  it("rejects a non-hex brand color on update, leaving the stored color unchanged", async () => {
    const createResponse = await fetch(`${baseUrl}/api/me/listings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "x-test-clerk-user-id": testUserId,
      },
      body: JSON.stringify({
        name: `Accent Update Test ${randomUUID()}`,
        tagline: "Verifies an invalid brand color update is rejected.",
        description: "Created by the accent-colors test suite.",
        category: "Testing",
        ownerBid: 0,
      }),
    });
    assert.equal(createResponse.status, 201);
    const listing = CreateListingResponse.parse(await createResponse.json());
    createdListingIds.push(listing.id);

    const updateResponse = await fetch(`${baseUrl}/api/me/listings/${listing.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "x-test-clerk-user-id": testUserId,
      },
      body: JSON.stringify({ accent: "chartreuse" }),
    });
    assert.equal(updateResponse.status, 400);

    const [row] = await db
      .select({ accent: listingsTable.accent })
      .from(listingsTable)
      .where(eq(listingsTable.id, listing.id));
    assert.ok(row);
    assert.equal(row!.accent, listing.accent, "a rejected update must not change the stored accent");
  });

  it("accepts a valid owner-chosen brand color on update", async () => {
    const createResponse = await fetch(`${baseUrl}/api/me/listings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "x-test-clerk-user-id": testUserId,
      },
      body: JSON.stringify({
        name: `Accent Update Success Test ${randomUUID()}`,
        tagline: "Verifies a valid brand color update is honored.",
        description: "Created by the accent-colors test suite.",
        category: "Testing",
        ownerBid: 0,
      }),
    });
    assert.equal(createResponse.status, 201);
    const listing = CreateListingResponse.parse(await createResponse.json());
    createdListingIds.push(listing.id);

    const chosen = "#EF4444";
    const updateResponse = await fetch(`${baseUrl}/api/me/listings/${listing.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "x-test-clerk-user-id": testUserId,
      },
      body: JSON.stringify({ accent: chosen }),
    });
    assert.equal(updateResponse.status, 200);

    const [row] = await db
      .select({ accent: listingsTable.accent })
      .from(listingsTable)
      .where(eq(listingsTable.id, listing.id));
    assert.ok(row);
    assert.equal(row!.accent, chosen);
  });
});

describe("POST /public/campaign-bids: brand color validation", () => {
  let server: Server;
  let baseUrl = "";

  before(async () => {
    await ensureSignalRankSeed();
    const app = createApp({ clerkAuthMiddleware: testClerkAuthMiddleware() });
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
  });

  it("rejects a public campaign bid carrying a non-hex brand color", async () => {
    const response = await fetch(`${baseUrl}/api/public/campaign-bids`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        websiteUrl: `https://campaign-accent-${randomUUID()}.example.test`,
        category: "Testing",
        ownerBid: 500,
        email: "campaign-accent@example.test",
        accent: "not-a-color",
      }),
    });
    assert.equal(response.status, 400);
  });
});

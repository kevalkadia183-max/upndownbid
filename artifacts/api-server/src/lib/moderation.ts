import { randomUUID } from "node:crypto";
import { clerkClient, getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import {
  actionRateWindowsTable,
  db,
  listingsTable,
  rateLimitsTable,
  usersTable,
  type User,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

function normalizeVerifiedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function verifiedClerkEmail(req: Request): Promise<string | null> {
  const auth = getAuth(req);
  if (!auth.userId) return null;

  const claims = auth.sessionClaims as Record<string, unknown> | undefined;
  const claimedEmail = normalizeVerifiedEmail(
    claims?.email ?? claims?.email_address ?? claims?.primary_email_address,
  );
  if (
    claimedEmail &&
    (claims?.email_verified === true || claims?.emailVerified === true)
  ) {
    return claimedEmail;
  }

  try {
    const user = await clerkClient.users.getUser(auth.userId);
    const primaryEmail =
      user.primaryEmailAddress ??
      user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId);
    if (primaryEmail?.verification?.status !== "verified") return null;
    return normalizeVerifiedEmail(primaryEmail.emailAddress);
  } catch {
    return null;
  }
}

// Exported for tests only -- production callers always go through
// getRequestActor, which already resolves the verified email and actor.
export async function associateVerifiedEmailClaims(actor: User, email: string | null) {
  if (!email) return;
  // Moderators and admins must never silently acquire ownership of a listing
  // just because their own verified email happens to match a stray unowned
  // `ownerEmail` value -- ownership auto-claim is a member-only convenience
  // for legacy pre-signup submissions, not a channel through which staff
  // accounts can end up "owning" (and thus managing/collecting on) another
  // person's listing.
  if (actor.role !== "member") return;

  await db
    .update(listingsTable)
    .set({ ownerId: actor.id })
    .where(
      and(
        isNull(listingsTable.ownerId),
        sql`lower(${listingsTable.ownerEmail}) = ${email}`,
      ),
    );
}

export async function getRequestActor(req: Request): Promise<User | null> {
  const auth = getAuth(req);
  if (!auth.userId) return null;
  const email = await verifiedClerkEmail(req);

  const [actor] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, auth.userId))
    .limit(1);
  if (actor) {
    const requestActor = { ...actor, email };
    await associateVerifiedEmailClaims(requestActor, email);
    return requestActor;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      id: randomUUID(),
      clerkUserId: auth.userId,
      // Clerk is the source of identity. The database email column remains
      // historical/profile data and must never establish ownership.
      email: null,
      displayName: "SignalRank member",
      role: "member",
      status: "active",
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    const requestActor = { ...created, email };
    await associateVerifiedEmailClaims(requestActor, email);
    return requestActor;
  }

  const [racedActor] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, auth.userId))
    .limit(1);
  if (!racedActor) return null;
  const requestActor = { ...racedActor, email };
  await associateVerifiedEmailClaims(requestActor, email);
  return requestActor;
}

export async function requireModerator(
  req: Request,
  res: Response,
): Promise<User | null> {
  const actor = await getRequestActor(req);
  if (!actor) {
    res.status(401).json({ error: "Moderator identity required" });
    return null;
  }
  if (actor.status !== "active") {
    res.status(403).json({ error: "Suspended accounts cannot moderate" });
    return null;
  }
  if (!["moderator", "admin"].includes(actor.role)) {
    res.status(403).json({ error: "Moderator role required" });
    return null;
  }
  return actor;
}

export async function requireAdmin(
  req: Request,
  res: Response,
): Promise<User | null> {
  const actor = await getRequestActor(req);
  if (!actor) {
    res.status(401).json({ error: "Admin identity required" });
    return null;
  }
  if (actor.status !== "active") {
    res.status(403).json({ error: "Suspended accounts cannot administer roles" });
    return null;
  }
  if (actor.role !== "admin") {
    res.status(403).json({ error: "Admin role required" });
    return null;
  }
  return actor;
}

export async function requireActiveActor(
  req: Request,
  res: Response,
): Promise<User | null> {
  const actor = await getRequestActor(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (actor.status !== "active") {
    res.status(403).json({ error: "Suspended accounts cannot perform this action" });
    return null;
  }
  return actor;
}

export async function enforceActionRateLimit(
  res: Response,
  action: string,
  actorId: string,
): Promise<boolean> {
  const [limit] = await db
    .select()
    .from(rateLimitsTable)
    .where(eq(rateLimitsTable.action, action))
    .limit(1);
  if (!limit) return true;

  const now = Date.now();
  const windowMs = limit.windowSeconds * 1000;
  const windowStartedAt = new Date(Math.floor(now / windowMs) * windowMs);
  const [window] = await db
    .insert(actionRateWindowsTable)
    .values({ action, actorId, windowStartedAt, count: 1 })
    .onConflictDoUpdate({
      target: [
        actionRateWindowsTable.action,
        actionRateWindowsTable.actorId,
        actionRateWindowsTable.windowStartedAt,
      ],
      set: { count: sql`${actionRateWindowsTable.count} + 1` },
      where: sql`${actionRateWindowsTable.count} < ${limit.maxRequests}`,
    })
    .returning({ count: actionRateWindowsTable.count });

  if (!window) {
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - windowStartedAt.getTime())) / 1000));
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({
      error: `Rate limit reached for ${action}. Try again in ${retryAfter} seconds.`,
    });
    return false;
  }

  return true;
}
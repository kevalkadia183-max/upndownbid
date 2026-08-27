// Single source of truth for the "pending owner claim" handoff that survives
// the Clerk auth redirect during the owner-claim flow. Both the auth pages
// (owner-sign-up.tsx, owner-sign-in.tsx) and the module that restores the
// claim after auth (campaign-bid-module.tsx) must agree on the storage key,
// shape, and validity window -- a mismatch here is exactly what causes a
// restored claim to silently vanish or a stale one to auto-submit.
export const PENDING_OWNER_CLAIM_KEY = "upndownbid:pending-owner-claim";

// A pending claim saved before an OAuth/email redirect must never be resumed
// once it is stale or the weekly campaign it targeted has rolled over -- the
// server always re-derives the current campaign on submit, but discarding a
// stale attempt client-side avoids auto-starting a payment flow for a claim
// the user no longer intends (or a campaign that no longer exists).
export const PENDING_OWNER_CLAIM_TTL_MS = 30 * 60 * 1000;

export const ABSOLUTE_MINIMUM_OWNER_CLAIM = 5;

// Note: no email/ownerName here. The claim can be saved before the user has
// authenticated at all, so we have no verified identity to attach yet -- the
// authenticated Clerk session (available once the resume effect runs) is the
// only source of truth for who is submitting it.
export type PendingOwnerClaim = {
  websiteUrl: string;
  category: string;
  ownerBid: number;
  demoVideoUrl?: string;
  accent?: string;
  idempotencyKey?: string;
  campaignId: string;
  campaignEndAt: string;
  createdAt: number;
  // Stamped with the Clerk user id of whichever authenticated session first
  // resumes this claim (never set before auth -- see the comment above). Once
  // stamped, `claimPendingOwnerClaimForUser` refuses to hand the claim to any
  // *other* user id on the same browser, so one person's abandoned/failed
  // claim (and any resulting "try payment again" state) can never surface
  // for someone else who later signs into the same browser. `undefined`
  // means an older claim saved before this field existed; it is treated the
  // same as `null` (not yet claimed by anyone).
  claimedByUserId?: string | null;
};

function isStructurallyValid(claim: Partial<PendingOwnerClaim> | null): claim is PendingOwnerClaim {
  return Boolean(
    claim &&
    claim.websiteUrl &&
    claim.category &&
    typeof claim.ownerBid === "number" &&
    Number.isInteger(claim.ownerBid) &&
    claim.ownerBid >= ABSOLUTE_MINIMUM_OWNER_CLAIM &&
    typeof claim.campaignId === "string" &&
    typeof claim.campaignEndAt === "string" &&
    typeof claim.createdAt === "number" &&
    (claim.claimedByUserId === undefined || claim.claimedByUserId === null || typeof claim.claimedByUserId === "string"),
  );
}

// localStorage (not sessionStorage) is intentional here, even though the
// claim is still TTL-bounded and re-validated server-side. Google's OAuth
// redirect is a real top-level, cross-origin round trip (app -> accounts
// google.com -> back), and on mobile browsers that hop can land the return
// leg in a context (a relaunched tab, a restored session after the OS
// suspends the browser mid-redirect, etc.) where the *session*-scoped storage
// of the original tab is no longer reachable even though the origin's
// localStorage is. Using localStorage is what makes the pending claim
// reliably survive that round trip instead of only working "most of the
// time" on desktop.
export function savePendingOwnerClaim(claim: PendingOwnerClaim) {
  try {
    window.localStorage.setItem(PENDING_OWNER_CLAIM_KEY, JSON.stringify(claim));
  } catch {
    // localStorage can throw in locked-down browser contexts (e.g. some
    // private-browsing modes). There is nothing to resume after auth in that
    // case, so the claim flow degrades to "sign in, then re-enter details"
    // rather than crashing the claim button.
  }
}

export function clearPendingOwnerClaim() {
  try {
    window.localStorage.removeItem(PENDING_OWNER_CLAIM_KEY);
  } catch {
    // See savePendingOwnerClaim.
  }
}

// Returns the saved claim only if it still parses and passes structural /
// TTL checks. Does NOT check campaign match -- callers that know the live
// campaign (the resume effect) must additionally verify
// `claim.campaignId === campaign.id`.
export function peekPendingOwnerClaim(): PendingOwnerClaim | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PENDING_OWNER_CLAIM_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingOwnerClaim>;
    if (!isStructurallyValid(parsed)) return null;
    if (Date.now() - parsed.createdAt > PENDING_OWNER_CLAIM_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Returns the saved claim only if it may be resumed by `userId`, stamping it
// as belonging to that user the first time it is consumed. This is the ONLY
// safe way to read a claim once the caller knows who is signed in -- plain
// `peekPendingOwnerClaim` has no notion of identity and must not be used to
// decide whether to auto-resume a claim after auth.
//
// - Unclaimed (no `claimedByUserId` yet): stamp it with `userId` and return
//   it. This covers the normal flow -- an anonymous visitor saves a claim,
//   then signs in; whoever completes that sign-in is presumed to be the
//   visitor who started it.
// - Already claimed by `userId`: return it unchanged (e.g. a retry after a
//   failed payment, or a page reload by the same signed-in user).
// - Already claimed by a *different* user id: this claim belongs to someone
//   else who previously authenticated on this browser. It must never be
//   resumed or surfaced (no auto-submit, no "try payment again" panel) for
//   the current user -- clear it so it cannot keep leaking to whoever else
//   signs in next.
export function claimPendingOwnerClaimForUser(userId: string): PendingOwnerClaim | null {
  const claim = peekPendingOwnerClaim();
  if (!claim) return null;
  if (claim.claimedByUserId && claim.claimedByUserId !== userId) {
    clearPendingOwnerClaim();
    return null;
  }
  if (claim.claimedByUserId !== userId) {
    const stamped: PendingOwnerClaim = { ...claim, claimedByUserId: userId };
    savePendingOwnerClaim(stamped);
    return stamped;
  }
  return claim;
}

// Whether a resumable claim exists at all. Used by the sign-up and sign-in
// pages -- which render before any campaign query has run, so they cannot
// check campaign match -- to decide whether their post-auth redirect should
// land back on the claim-resume screen instead of their normal default.
//
// This must be checked on BOTH pages: Clerk itself decides which of the two
// completes a given auth attempt (e.g. a "create account" attempt with an
// email that already has an account silently continues as a sign-in), so a
// redirect target hardcoded on only one page silently drops the claim
// whenever Clerk takes the other branch.
export function hasResumableOwnerClaim(): boolean {
  return peekPendingOwnerClaim() !== null;
}

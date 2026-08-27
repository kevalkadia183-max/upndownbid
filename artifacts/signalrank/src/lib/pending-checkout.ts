import type { PublicListing } from "./public-api";

export type PendingCheckoutType = "support" | "penalize";

export interface PendingCheckoutDetails {
  type: PendingCheckoutType;
  amount: number;
  email: string;
  reason: string;
  reasonDescription: string;
}

/** The campaign a pending checkout was started against. Used only for a
 * client-side "is this still resumable" heuristic — the server always
 * independently re-validates the current campaign before creating any
 * PayPal order, so this is not a security boundary. */
export interface PendingCheckoutCampaignContext {
  campaignId: string;
  campaignEndAt: string;
}

export interface PendingCheckoutState extends PendingCheckoutDetails, PendingCheckoutCampaignContext {
  idempotencyKey: string;
  createdAt: number;
  payment: { paymentId: string; listing: PublicListing } | null;
}

// A pending checkout must never be offered for resume once it has sat around
// too long, even within the same campaign — this is a belt-and-suspenders
// cap independent of the campaign's own end time.
const PENDING_CHECKOUT_TTL_MS = 30 * 60 * 1000;

function storageKey(slug: string, type: PendingCheckoutType): string {
  return `upndownbid:pending-checkout:${slug}:${type}`;
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Reads a browser-session-scoped pending checkout attempt for this listing + action type, if any. */
export function loadPendingCheckout(slug: string, type: PendingCheckoutType): PendingCheckoutState | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(slug, type));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingCheckoutState> | null;
    if (
      !parsed ||
      typeof parsed.idempotencyKey !== "string" ||
      parsed.type !== type ||
      typeof parsed.amount !== "number" ||
      typeof parsed.email !== "string" ||
      typeof parsed.reason !== "string" ||
      typeof parsed.reasonDescription !== "string" ||
      typeof parsed.campaignId !== "string" ||
      typeof parsed.campaignEndAt !== "string" ||
      typeof parsed.createdAt !== "number"
    ) {
      // Entries saved before campaign context existed (or otherwise malformed)
      // can never be judged resumable, so they're discarded outright.
      clearPendingCheckout(slug, type);
      return null;
    }
    return {
      idempotencyKey: parsed.idempotencyKey,
      type,
      amount: parsed.amount,
      email: parsed.email,
      reason: parsed.reason,
      reasonDescription: parsed.reasonDescription,
      campaignId: parsed.campaignId,
      campaignEndAt: parsed.campaignEndAt,
      createdAt: parsed.createdAt,
      payment: parsed.payment ?? null,
    };
  } catch {
    return null;
  }
}

/** Persists the opaque idempotency key and matching action details for the current browser session. */
export function savePendingCheckout(slug: string, state: PendingCheckoutState): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(slug, state.type), JSON.stringify(state));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) — resume just won't be offered.
  }
}

/** Clears stored pending context once a checkout is confirmed rejected or completed. */
export function clearPendingCheckout(slug: string, type: PendingCheckoutType): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(slug, type));
  } catch {
    // ignore
  }
}

/** A stored idempotency key may only be reused when the action details it was issued for still match. */
export function matchesPendingDetails(a: PendingCheckoutDetails, b: PendingCheckoutDetails): boolean {
  return (
    a.type === b.type &&
    a.amount === b.amount &&
    a.email === b.email &&
    a.reason === b.reason &&
    a.reasonDescription === b.reasonDescription
  );
}

/** True once a pending checkout has sat around longer than the explicit TTL, regardless of campaign state. */
export function isPendingCheckoutExpired(state: PendingCheckoutState, now: number = Date.now()): boolean {
  return now - state.createdAt > PENDING_CHECKOUT_TTL_MS;
}

/**
 * A pending checkout is only safe to offer for resume when it targeted the
 * campaign that is still live right now, that campaign hasn't ended, and the
 * attempt itself hasn't gone stale. This is a UX heuristic only — the server
 * independently re-validates the current campaign before creating any order.
 */
export function isPendingCheckoutForCampaign(
  state: PendingCheckoutState,
  campaign: { id: string; endAt: string },
  now: number = Date.now(),
): boolean {
  if (state.campaignId !== campaign.id) return false;
  if (new Date(campaign.endAt).getTime() <= now) return false;
  if (isPendingCheckoutExpired(state, now)) return false;
  return true;
}

import { getOrCreateVisitorId } from "@/lib/visitor-id";
import type {
  AdminFeedback,
  FeedbackInput,
  Listing,
  PublicActionCheckoutInput,
  PublicActionCheckoutResponse,
  PublicListingCheckoutInput,
  PublicListingCheckoutResponse,
  PublicListingPreview,
  PublicManagementUpdateInput,
  PublicManagedListingUpdateResponse,
  PublicPaymentReceipt,
  PublicReviewInput,
  PublicReview,
  ReportInput,
  ReviewVote,
  PublicAnalytics,
  PaymentEnvironment,
  LogoUploadUrlResponse,
  LogoUploadUrlRequestContentType,
} from "@workspace/api-client-react";

export type PublicListing = Listing;

export type CampaignBidResult = {
  mode: "new" | "increase";
  campaign: {
    number: number;
    minimumBid: number;
    startAt: string;
    endAt: string;
  };
  listing: PublicListing;
  payment: {
    id: string;
    status: string;
    receiptNumber: string | null;
    environment: "sandbox" | "live";
    checkoutUrl?: string | null;
  };
  manageUrl?: string;
};

export type CurrentCampaign = {
  id: string;
  number: number;
  status: "live" | "completed";
  startAt: string;
  endAt: string;
  minimumBid: number;
  timezone: "UTC";
  lastWinner: {
    campaignNumber: number;
    name: string;
    slug: string;
    initials: string;
    accent: string;
    effectiveBid: number;
  } | null;
};

export type CampaignWinner = {
  campaignNumber: number;
  startAt: string;
  endAt: string;
  declaredAt: string;
  finalEffectiveBid: number;
  listing: {
    id: string;
    name: string;
    slug: string;
    category: string;
    initials: string;
    accent: string;
    logoUrl?: string | null;
  };
  finalRankings: Array<{
    rank: number;
    effectiveBid: number;
    listing: {
      id: string;
      name: string;
      slug: string;
      initials: string;
      accent: string;
      logoUrl?: string | null;
    };
  }>;
};

export type Top4BoardEntry = {
  rank: number;
  effectiveBid: number;
  ownerBid: number;
  listing: {
    id: string;
    name: string;
    slug: string;
    initials: string;
    accent: string;
    websiteUrl?: string | null;
    demoVideoUrl?: string | null;
    logoUrl?: string | null;
  };
};

export type Top4Board = {
  mode: "live" | "final";
  campaignNumber: number;
  entries: Top4BoardEntry[];
};

type PublicRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
};

export class PublicApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

async function publicRequest<T>(path: string, options: PublicRequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new PublicApiError(
      "Checkout status could not be confirmed. Retry to continue with the same payment attempt.",
      null,
      true,
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new PublicApiError(
      typeof payload?.error === "string" ? payload.error : "Something went wrong. Please try again.",
      response.status,
      typeof payload?.retryable === "boolean" ? payload.retryable : response.status === 503,
    );
  }
  return payload as T;
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}

export function previewPublicListing(websiteUrl: string, ownerBid: number): Promise<PublicListingPreview> {
  return publicRequest<PublicListingPreview>("/public/listings/preview", {
    method: "POST",
    body: { websiteUrl, ownerBid },
  });
}

export function placeCampaignBid(
  data: {
    websiteUrl: string;
    category: string;
    ownerBid: number;
    email: string;
    ownerName?: string;
    demoVideoUrl?: string;
    accent?: string;
  },
  idempotencyKey: string,
): Promise<CampaignBidResult> {
  return publicRequest<CampaignBidResult>("/public/campaign-bids", {
    method: "POST",
    body: data,
    idempotencyKey,
  });
}

export function createPublicListing(
  data: PublicListingCheckoutInput,
  idempotencyKey: string,
): Promise<PublicListingCheckoutResponse> {
  return publicRequest<PublicListingCheckoutResponse>("/public/listings/checkout", { method: "POST", body: data, idempotencyKey });
}

export function checkoutPublicAction(
  slug: string,
  data: PublicActionCheckoutInput,
  idempotencyKey: string,
): Promise<PublicActionCheckoutResponse> {
  return publicRequest<PublicActionCheckoutResponse>(`/public/listings/${encodeURIComponent(slug)}/checkout`, {
    method: "POST",
    body: data,
    idempotencyKey,
  });
}

export function getPublicPaymentStatus(paymentId: string): Promise<PublicPaymentReceipt> {
  return publicRequest<PublicPaymentReceipt>(`/public/payments/${encodeURIComponent(paymentId)}`);
}

export function getPublicPaymentEnvironment(): Promise<PaymentEnvironment> {
  return publicRequest<PaymentEnvironment>("/public/payment-environment");
}

export type PayPalOrder = {
  paymentId: string;
  orderId: string;
  status: string;
};

export type PayPalCapturedPayment = {
  id: string;
  status: string;
};

export function createPayPalOrder(paymentId: string): Promise<PayPalOrder> {
  return publicRequest<PayPalOrder>("/paypal/create-order", {
    method: "POST",
    body: { paymentId },
  });
}

export function capturePayPalOrder(paymentId: string, orderId: string): Promise<PayPalCapturedPayment> {
  return publicRequest<PayPalCapturedPayment>("/paypal/capture-order", {
    method: "POST",
    body: { paymentId, orderId },
  });
}

export function createPublicReview(
  paymentId: string,
  data: PublicReviewInput,
): Promise<PublicReview> {
  return publicRequest<PublicReview>(`/public/payments/${encodeURIComponent(paymentId)}/review`, {
    method: "POST",
    body: data,
  });
}

export function updateManagedListing(
  token: string,
  data: PublicManagementUpdateInput,
  idempotencyKey?: string,
): Promise<PublicManagedListingUpdateResponse> {
  return publicRequest<PublicManagedListingUpdateResponse>(`/public/manage/${encodeURIComponent(token)}`, {
    method: "PATCH",
    body: data,
    idempotencyKey,
  });
}

export function requestManagedListingLogoUploadUrl(
  token: string,
  file: { name: string; size: number; contentType: LogoUploadUrlRequestContentType },
): Promise<LogoUploadUrlResponse> {
  return publicRequest<LogoUploadUrlResponse>(
    `/public/manage/${encodeURIComponent(token)}/logo-upload-url`,
    { method: "POST", body: file },
  );
}

export function archiveManagedListing(token: string) {
  return publicRequest<void>(`/public/manage/${encodeURIComponent(token)}`, { method: "DELETE" });
}

export function votePublicReview(reviewId: string, remove = false): Promise<ReviewVote> {
  return publicRequest<ReviewVote>(
    `/public/reviews/${encodeURIComponent(reviewId)}/vote`,
    { method: remove ? "DELETE" : "POST" },
  );
}

export function createPublicReport(data: ReportInput) {
  return publicRequest("/reports", { method: "POST", body: data });
}

export function createPublicFeedback(data: FeedbackInput): Promise<AdminFeedback> {
  return publicRequest<AdminFeedback>("/feedback", { method: "POST", body: data });
}

export function getCurrentCampaign(): Promise<CurrentCampaign> {
  return publicRequest<CurrentCampaign>("/campaigns/current");
}

export function getCampaignWinners(): Promise<CampaignWinner[]> {
  return publicRequest<CampaignWinner[]>("/winners");
}

export function getTop4Board(): Promise<Top4Board> {
  return publicRequest<Top4Board>("/campaigns/top4");
}

export function getPublicAnalytics(): Promise<PublicAnalytics> {
  return publicRequest<PublicAnalytics>("/analytics/public");
}

// Fire-and-forget-ish view tracking for a listing's demo video. Deduplicated
// server-side per anonymous visitor (same identifier as clicks/site visits),
// so this always returns the authoritative current count, not a client
// guess.
export function recordDemoView(listingId: string): Promise<{ demoViews: number }> {
  const visitorId = getOrCreateVisitorId();
  return publicRequest<{ demoViews: number }>(`/listings/${encodeURIComponent(listingId)}/demo-view`, {
    method: "POST",
    body: visitorId ? { visitorId } : {},
  });
}

// Fire-and-forget-ish impression tracking for the homepage featured-spotlight
// popup. Unlike demo views, this is intentionally not deduplicated -- the
// same listing being spotlighted again in a later session is a new,
// meaningful impression.
export function recordSpotlightImpression(listingId: string): Promise<{ recorded: boolean }> {
  const visitorId = getOrCreateVisitorId();
  return publicRequest<{ recorded: boolean }>(`/listings/${encodeURIComponent(listingId)}/spotlight-impression`, {
    method: "POST",
    body: visitorId ? { visitorId } : {},
  });
}

export function recordAnalyticsVisit(input: {
  visitorId: string;
  sessionId: string;
  path: string;
}): Promise<void> {
  return publicRequest<void>("/analytics/visit", {
    method: "POST",
    body: input,
  });
}

// Featured/Sponsored Listing product -- fully separate from the weekly
// campaign above. See lib/sponsorships.ts on the API server for the
// isolation invariant.
export type SponsoredListingSummary = {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  category: string;
  initials: string;
  accent: string;
  websiteUrl: string | null;
  demoVideoUrl: string | null;
  demoViewCount: number;
  logoUrl: string | null;
  clickAnalytics: { totalClicks: number; uniqueClicks: number };
};

export type ActiveSponsorship = {
  id: string;
  listing: SponsoredListingSummary;
  slotNumber: number;
  startAt: string | null;
  expiresAt: string | null;
};

export type SponsorshipAvailability = {
  price: number;
  durationDays: number;
  totalSlots: number;
  availableSlots: number;
};

export type SponsorshipCheckoutResult = {
  payment: {
    id: string;
    status: string;
    checkoutUrl?: string | null;
  };
  sponsorship: ActiveSponsorship;
  sandbox: boolean;
};

export function getActiveSponsorships(): Promise<{ sponsorships: ActiveSponsorship[]; totalSlots: number }> {
  return publicRequest("/sponsorships/active");
}

export function getSponsorshipAvailability(): Promise<SponsorshipAvailability> {
  return publicRequest<SponsorshipAvailability>("/sponsorships/availability");
}

export type SponsorshipEventType = "popup_impression" | "section_impression" | "click";

// Fire-and-forget-ish, mirroring recordSpotlightImpression: every occurrence
// counts, no client-side dedup beyond the popup's own session cap.
export function recordSponsorshipEvent(sponsorshipId: string, type: SponsorshipEventType): Promise<void> {
  const visitorId = getOrCreateVisitorId();
  return publicRequest<void>("/sponsorships/events", {
    method: "POST",
    body: { sponsorshipId, type, ...(visitorId ? { visitorId } : {}) },
  });
}

export function purchaseSponsorship(listingId: string, idempotencyKey: string): Promise<SponsorshipCheckoutResult> {
  return publicRequest<SponsorshipCheckoutResult>("/sponsorships/checkout", {
    method: "POST",
    body: { listingId },
    idempotencyKey,
  });
}

export function cancelSponsorship(sponsorshipId: string) {
  return publicRequest(`/sponsorships/${encodeURIComponent(sponsorshipId)}/cancel`, { method: "POST" });
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { ArrowRight, CheckCircle2, ChevronDown, Globe2, Loader2, Minus, Plus, Sparkles, Trophy, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandColorPicker, BRAND_COLOR_SWATCHES, isValidHexColor } from "@/components/brand-color-picker";
import { formatCurrency } from "@/lib/utils";
import { CATEGORY_GROUPS } from "@/lib/category-taxonomy";
import {
  newIdempotencyKey,
  placeCampaignBid,
  previewPublicListing,
  type CampaignBidResult,
  type CurrentCampaign,
  type PublicListing,
} from "@/lib/public-api";
import { getListing } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { PayPalCheckout } from "@/components/paypal-checkout";
import { PolicyAcknowledgeDialog } from "@/components/policy-acknowledge-dialog";
import { PaymentConfirmation } from "@/components/payment-confirmation";
import {
  ABSOLUTE_MINIMUM_OWNER_CLAIM,
  claimPendingOwnerClaimForUser,
  clearPendingOwnerClaim,
  savePendingOwnerClaim,
  type PendingOwnerClaim,
} from "@/lib/pending-owner-claim";
import { logClaimFlowEvent } from "@/lib/claim-flow-log";
import { OPEN_CAMPAIGN_CLAIM_EVENT } from "@/lib/claim-flow";

type CampaignBidModuleProps = {
  campaign: CurrentCampaign | undefined;
  listings: PublicListing[] | undefined;
};

const categories = CATEGORY_GROUPS.flatMap((group) => group.items);
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Everything needed to place a claim except the claimant's identity -- that
// always comes from the authenticated Clerk session at submit time, never
// from a form field, so a signed-in user is never asked for their own email
// or name and a signed-out user never has to supply it before authenticating.
type CampaignClaimRequest = {
  websiteUrl: string;
  category: string;
  ownerBid: number;
  demoVideoUrl?: string;
  accent?: string;
};

type ClaimAttempt = {
  fingerprint: string;
  idempotencyKey: string;
};

const absoluteMinimumClaim = ABSOLUTE_MINIMUM_OWNER_CLAIM;

// Removes the one-shot `resume-owner-claim` marker from the URL once the
// resume effect has acted on it, so a later refresh of `/` doesn't carry a
// stale "just returned from auth" signal.
function cleanResumeQueryParam() {
  if (typeof window === "undefined" || !window.location.search.includes("resume-owner-claim")) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("resume-owner-claim");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function claimFingerprint(claim: CampaignClaimRequest) {
  return JSON.stringify(claim);
}

function projectedPosition(
  bid: number,
  listing: PublicListing | undefined,
  listings: PublicListing[] | undefined,
) {
  if (!listings) return null;
  const projectedEffectiveBid = bid + (listing?.communitySupport ?? 0) - (listing?.penalties ?? 0);
  const competitors = listing ? listings.filter((item) => item.id !== listing.id) : listings;
  return competitors.filter((item) => item.effectiveBid > projectedEffectiveBid).length + 1;
}

export function CampaignBidModule({ campaign, listings }: CampaignBidModuleProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isSignedIn, isLoaded: isClerkLoaded, user } = useUser();
  const minimumBid = Math.max(campaign?.minimumBid ?? absoluteMinimumClaim, absoluteMinimumClaim);
  const bidIncrement = 1;
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [category, setCategory] = useState<string>(categories[0] ?? "AI");
  const [demoVideoUrl, setDemoVideoUrl] = useState("");
  const [accent, setAccent] = useState<string>(BRAND_COLOR_SWATCHES[0]);
  const [bid, setBid] = useState<number | "">(() => Math.max(minimumBid, listings?.[0]?.effectiveBid ?? 0));
  const [bidTouched, setBidTouched] = useState(false);
  const [preview, setPreview] = useState<PublicListing | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState<CampaignBidResult | null>(null);
  const [success, setSuccess] = useState<{
    listing: PublicListing;
    manageUrl?: string;
    campaignNumber: number;
    receiptNumber: string | null;
  } | null>(null);
  const [autoResumeStatus, setAutoResumeStatus] = useState<"idle" | "loading" | "error">("idle");
  const [showPolicyDialog, setShowPolicyDialog] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const claimAttempt = useRef<ClaimAttempt | null>(null);
  const autoResumeRetry = useRef<{ claim: CampaignClaimRequest; idempotencyKey: string } | null>(null);
  const restoredPendingClaim = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  // The detailed claim form (URL, category, demo link, bid stepper) stays
  // collapsed behind a compact CTA on the Discover page by default -- only
  // opened on request, or automatically whenever something needs it visible
  // (arriving via the /add-product or #campaign-bid entry points, or a saved
  // claim resuming after auth). This keeps the page compact without ever
  // removing the actual claim fields or logic.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const expandFromEntryPoint = () => {
      if (window.location.pathname.endsWith("/add-product") || window.location.hash === "#campaign-bid") {
        setExpanded(true);
      }
    };
    expandFromEntryPoint();
    window.addEventListener(OPEN_CAMPAIGN_CLAIM_EVENT, expandFromEntryPoint);
    window.addEventListener("hashchange", expandFromEntryPoint);
    return () => {
      window.removeEventListener(OPEN_CAMPAIGN_CLAIM_EVENT, expandFromEntryPoint);
      window.removeEventListener("hashchange", expandFromEntryPoint);
    };
  }, []);

  useEffect(() => {
    setBid((current) => current === "" ? current : Math.max(minimumBid, current));
  }, [minimumBid]);

  useEffect(() => {
    // Auth is asynchronous and campaign data loads separately, so wait for
    // both before deciding whether a saved claim can still be resumed — we
    // must never auto-submit a claim without knowing the live campaign.
    if (!isClerkLoaded || restoredPendingClaim.current) return;
    if (window.location.search.includes("resume-owner-claim")) {
      logClaimFlowEvent("AUTH_CALLBACK", undefined, { isSignedIn });
    }
    if (!isSignedIn || !campaign) return;
    if (!user?.id) return;
    // Never resume a claim saved (or already claimed) by a *different*
    // authenticated user on this browser -- see claimPendingOwnerClaimForUser.
    const claim = claimPendingOwnerClaimForUser(user.id);
    if (!claim) {
      cleanResumeQueryParam();
      return;
    }
    logClaimFlowEvent("SESSION_CONFIRMED", claim.idempotencyKey);
    restoredPendingClaim.current = true;
    // A claim saved for a campaign that has since rolled over (or that has
    // simply sat too long) is discarded silently — the user is already
    // signed in, so they can just re-enter details for the current campaign.
    const stillCurrentCampaign = claim.campaignId === campaign.id && new Date(campaign.endAt).getTime() > Date.now();
    if (!stillCurrentCampaign) {
      logClaimFlowEvent("PENDING_TRANSACTION_DISCARDED", claim.idempotencyKey, { reason: "campaign_ended_or_changed" });
      clearPendingOwnerClaim();
      cleanResumeQueryParam();
      toast({
        variant: "destructive",
        title: "This campaign has ended",
        description: "Please start a new claim in the current campaign.",
      });
      return;
    }
    logClaimFlowEvent("CAMPAIGN_VALIDATED", claim.idempotencyKey, { campaignId: claim.campaignId });
    setExpanded(true);
    setWebsiteUrl(claim.websiteUrl);
    setCategory(claim.category);
    setBid(claim.ownerBid);
    setDemoVideoUrl(claim.demoVideoUrl ?? "");
    if (claim.accent && isValidHexColor(claim.accent)) setAccent(claim.accent);
    setBidTouched(true);
    const restoredRequest: CampaignClaimRequest = {
      websiteUrl: claim.websiteUrl,
      category: claim.category,
      ownerBid: claim.ownerBid,
      ...(claim.demoVideoUrl ? { demoVideoUrl: claim.demoVideoUrl } : {}),
      ...(claim.accent && isValidHexColor(claim.accent) ? { accent: claim.accent } : {}),
    };
    const idempotencyKey = claim.idempotencyKey || newIdempotencyKey();
    claimAttempt.current = {
      fingerprint: claimFingerprint(restoredRequest),
      idempotencyKey,
    };
    autoResumeRetry.current = { claim: restoredRequest, idempotencyKey };
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    logClaimFlowEvent("PENDING_TRANSACTION_RESTORED", idempotencyKey);
    cleanResumeQueryParam();
    void submitClaim(restoredRequest, idempotencyKey, { auto: true });
    // submitClaim is stable across renders for this effect's purposes (it only
    // reads state via closures re-created each render); including it would
    // require restructuring around refs for no behavioral benefit here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClerkLoaded, isSignedIn, campaign, user?.id]);

  const bidAmount = typeof bid === "number" ? bid : 0;
  const validBid = Number.isInteger(bidAmount) && bidAmount >= minimumBid;

  useEffect(() => {
    const trimmedUrl = websiteUrl.trim();
    if (!trimmedUrl || !validBid) {
      setPreview(null);
      setPreviewReady(false);
      setPreviewError("");
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const result = await previewPublicListing(trimmedUrl, bidAmount);
        setPreview(result.duplicate ?? null);
        setPreviewReady(true);
        setPreviewError("");
      } catch (error) {
        setPreview(null);
        setPreviewReady(false);
        setPreviewError(error instanceof Error ? error.message : "Enter a valid website URL.");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [websiteUrl, bidAmount, minimumBid, validBid]);

  useEffect(() => {
    if (preview && bidAmount <= preview.ownerBid) {
      setBid(Math.max(minimumBid, Math.floor(preview.ownerBid) + 1));
      setBidTouched(true);
    }
  }, [preview, bidAmount, minimumBid]);

  const currentTop = listings?.[0]?.effectiveBid ?? 0;
  const amountToReachTop = Math.max(minimumBid, currentTop);

  useEffect(() => {
    if (bidTouched) return;
    setBid((current) => (current === amountToReachTop ? current : amountToReachTop));
  }, [amountToReachTop, bidTouched]);
  const rank = useMemo(
    () => validBid ? projectedPosition(bidAmount, preview ?? undefined, listings) : null,
    [bidAmount, preview, listings, validBid],
  );
  const claimTop = rank === 1;
  const bidFloor = Math.max(minimumBid, preview ? Math.floor(preview.ownerBid) + 1 : minimumBid);
  const heading = claimTop
    ? `Claim #1 for ${formatCurrency(bidAmount)}`
    : rank
      ? `Claim ${formatCurrency(bidAmount)} → projected #${rank}`
      : `Enter at least ${formatCurrency(minimumBid)}`;
  const buttonLabel = preview
     ? "Increase claim"
    : claimTop
      ? "Claim #1"
      : rank
        ? `Claim for #${rank}`
        : "Preview your claim";
  // Whether the payment/resume area below the button should be visible at
  // all -- kept as one condition so the JSX doesn't have to repeat it.
  const showPaymentArea = Boolean(pendingCheckout) || autoResumeStatus === "loading" || autoResumeStatus === "error";

  function claimRequest(): CampaignClaimRequest | null {
    const normalizedUrl = websiteUrl.trim();
    if (!normalizedUrl || !category.trim() || !validBid || !isValidHexColor(accent)) {
      return null;
    }
    const trimmedDemoUrl = demoVideoUrl.trim();
    return {
      websiteUrl: normalizedUrl,
      category,
      ownerBid: bidAmount,
      ...(trimmedDemoUrl ? { demoVideoUrl: trimmedDemoUrl } : {}),
      accent,
    };
  }

  function idempotencyKeyFor(claim: CampaignClaimRequest) {
    const fingerprint = claimFingerprint(claim);
    if (claimAttempt.current?.fingerprint === fingerprint) {
      return claimAttempt.current.idempotencyKey;
    }
    const idempotencyKey = newIdempotencyKey();
    claimAttempt.current = { fingerprint, idempotencyKey };
    return idempotencyKey;
  }

  function continueToOwnerSignUp(claim: CampaignClaimRequest) {
    if (!campaign) {
      toast({
        variant: "destructive",
        title: "Campaign details are still loading",
        description: "Please wait a moment and try again.",
      });
      return;
    }
    const pendingClaim: PendingOwnerClaim = {
      ...claim,
      idempotencyKey: idempotencyKeyFor(claim),
      campaignId: campaign.id,
      campaignEndAt: campaign.endAt,
      createdAt: Date.now(),
      // Not yet claimed by anyone -- no one is authenticated at this point.
      // Stamped by claimPendingOwnerClaimForUser once someone signs in.
      claimedByUserId: null,
    };
    savePendingOwnerClaim(pendingClaim);
    logClaimFlowEvent("PENDING_TRANSACTION_SAVED", pendingClaim.idempotencyKey, { campaignId: pendingClaim.campaignId });
    logClaimFlowEvent("AUTH_STARTED", pendingClaim.idempotencyKey);
    // Clerk's own sign-up screen already offers Google and email/password --
    // there is no app-rendered "choose how to continue" step in between.
    window.location.assign(`${basePath}/owner/sign-up`);
  }

  async function submitClaim(claim: CampaignClaimRequest, idempotencyKey: string, options?: { auto?: boolean }) {
    if (submitting) return;
    // The authenticated Clerk session is the only source of the claimant's
    // email -- submitClaim is only ever invoked once signed in (either the
    // user was already signed in, or auth just completed), so a missing
    // email here means something upstream regressed, not a normal path.
    const ownerEmail = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress;
    if (!ownerEmail) {
      logClaimFlowEvent("TRANSACTION_FAILED", idempotencyKey, { auto: Boolean(options?.auto), message: "missing_authenticated_email" });
      if (options?.auto) setAutoResumeStatus("error");
      else toast({ variant: "destructive", title: "Sign in required", description: "Please sign in to complete this claim." });
      return;
    }
    setSubmitting(true);
    if (options?.auto) setAutoResumeStatus("loading");
    logClaimFlowEvent("BID_VALIDATED", idempotencyKey, { auto: Boolean(options?.auto) });
    try {
      const result = await placeCampaignBid({ ...claim, email: ownerEmail }, idempotencyKey);
      if (result.payment.status !== "succeeded") {
        setPendingCheckout(result);
        setPaymentConfirmed(false);
        if (options?.auto) setAutoResumeStatus("idle");
        return;
      }
      logClaimFlowEvent("TRANSACTION_FINALIZED", idempotencyKey, { paymentId: result.payment.id });
      setSuccess({
        listing: result.listing,
        manageUrl: result.manageUrl,
        campaignNumber: result.campaign.number,
        receiptNumber: result.payment.receiptNumber,
      });
      if (options?.auto) setAutoResumeStatus("idle");
      clearPendingOwnerClaim();
      await queryClient.invalidateQueries();
      toast({
        title: result.mode === "increase" ? "Campaign claim increased" : "You are in this week's campaign",
        description: `${result.listing.name} is now ranked #${result.listing.rank}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      logClaimFlowEvent("TRANSACTION_FAILED", idempotencyKey, { auto: Boolean(options?.auto), message });
      if (options?.auto) {
        setAutoResumeStatus("error");
      } else {
        toast({
          variant: "destructive",
          title: "Claim was not completed",
          description: message,
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // The primary action opens the policy acknowledgement gate first; once
  // acknowledged, signed-out visitors are sent to Clerk (which itself offers
  // Google and email/password) and signed-in users go straight to PayPal.
  function handlePrimaryClick() {
    const claim = claimRequest();
    if (!campaign || !rank || !claim || submitting || !isClerkLoaded) return;
    setShowPolicyDialog(true);
  }

  async function proceedAfterPolicyAcknowledged() {
    const claim = claimRequest();
    setShowPolicyDialog(false);
    if (!campaign || !rank || !claim || submitting || !isClerkLoaded) return;
    if (!isSignedIn) return continueToOwnerSignUp(claim);
    await submitClaim(claim, idempotencyKeyFor(claim));
  }

  // Kept collapsed to a compact CTA by default so the Discover page doesn't
  // spend a large chunk of vertical space on the claim form before anyone
  // has asked for it. Anything mid-flow (payment, resume-after-auth,
  // success) forces it open regardless of the collapsed default.
  const showFull = expanded || Boolean(success) || showPaymentArea;

  if (!showFull) {
    return (
      <section ref={sectionRef} id="campaign-bid" className="mb-7 scroll-mt-20 overflow-hidden rounded-2xl border border-primary/25 bg-card shadow-sm" aria-label="Claim a campaign spot">
        <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary">
              <Zap className="h-3.5 w-3.5" /> Want to be seen here?
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Claim a live position from {formatCurrency(minimumBid)}. Higher positions get more visibility.
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
              Current #1 <strong className="text-foreground">{formatCurrency(currentTop)}</strong>
              <span className="mx-2 text-border">·</span>
              Next spot from <strong className="text-primary">{formatCurrency(amountToReachTop)}</strong>
            </p>
          </div>
          <Button onClick={() => setExpanded(true)} className="shrink-0 gap-1.5" data-testid="button-claim-a-spot">
            Claim a spot <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} id="campaign-bid" className="mb-7 scroll-mt-20 overflow-hidden rounded-2xl border border-primary/25 bg-card shadow-sm" aria-label="This week's campaign claim">
      <div data-campaign-bid-banner className="border-b border-primary/15 bg-primary/[0.06] px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div data-campaign-bid-banner-label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            <Sparkles className="h-3.5 w-3.5" /> This week&apos;s campaign
          </div>
          <div className="rounded-full border border-primary/20 bg-background/70 px-2.5 py-1 font-mono text-[10px] font-bold text-primary">
            Campaign #{campaign?.number ?? "…"}
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
           New spots start at {formatCurrency(minimumBid)}. Claim with more to move higher in this week&apos;s live race.
        </p>
      </div>

      {success ? (
        <div className="p-5 text-center sm:p-7">
          <CheckCircle2 className="mx-auto h-11 w-11 text-secondary" />
          <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Claim submitted successfully</p>
          <h2 className="mt-2 text-2xl font-bold">You&apos;re now #{success.listing.rank}.</h2>
          <dl className="mx-auto mt-4 grid max-w-sm grid-cols-2 gap-y-2 rounded-xl border border-border/60 bg-muted/20 p-4 text-left text-sm">
            <dt className="text-muted-foreground">Listing</dt>
            <dd className="text-right font-medium">{success.listing.name}</dd>
            <dt className="text-muted-foreground">Campaign</dt>
            <dd className="text-right font-medium">#{success.campaignNumber}</dd>
            <dt className="text-muted-foreground">Amount paid</dt>
            <dd className="text-right font-medium">{formatCurrency(success.listing.ownerBid)}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="text-right font-medium text-secondary">Succeeded{success.receiptNumber ? ` · ${success.receiptNumber}` : ""}</dd>
          </dl>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Button asChild variant="outline"><Link href={`/listing/${success.listing.slug}`}>View live ranking</Link></Button>
            <Button asChild><Link href="/owner/dashboard">Open Owner Portal</Link></Button>
            {success.manageUrl && <Button asChild><Link href={success.manageUrl}>Save secure management link</Link></Button>}
          </div>
        </div>
      ) : (
        <div data-campaign-bid-layout className="grid grid-cols-1 min-w-0 gap-0 lg:grid-cols-[minmax(0,1fr)_270px]">
          <div data-campaign-bid-content className="min-w-0 p-5 sm:p-6">
            <p data-campaign-bid-heading className="text-center text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{heading}</p>
            <div data-campaign-bid-controls className="mx-auto mt-3 flex min-w-0 max-w-md items-center gap-2">
              <Button data-campaign-bid-stepper type="button" variant="outline" size="icon" className="h-12 w-12 shrink-0 rounded-xl" onClick={() => { setBidTouched(true); setBid((value) => Math.max(bidFloor, (typeof value === "number" ? value : bidFloor) - bidIncrement)); }} aria-label="Lower campaign claim">
                <Minus className="h-4 w-4" />
              </Button>
              <div className="relative min-w-0 flex-1">
                <span data-campaign-bid-currency className="absolute left-4 top-3.5 font-mono text-xl text-muted-foreground">$</span>
                <Input
                  type="number"
                  min={bidFloor}
                  step={bidIncrement}
                  value={bid}
                  onChange={(event) => {
                    setBidTouched(true);
                    const value = event.target.value;
                    setBid(value === "" ? "" : Number(value));
                  }}
                  className="h-12 min-w-0 rounded-xl border-primary/25 bg-primary/[0.03] pl-9 text-center font-mono text-2xl font-bold"
                  data-testid="input-campaign-bid"
                />
              </div>
              <Button data-campaign-bid-stepper type="button" variant="outline" size="icon" className="h-12 w-12 shrink-0 rounded-xl" onClick={() => { setBidTouched(true); setBid((value) => Math.min(100000, (typeof value === "number" ? value : minimumBid) + bidIncrement)); }} aria-label="Raise campaign claim">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div data-campaign-bid-summary className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-mono text-[11px]">
              <span className="text-muted-foreground">Current #1 <strong className="ml-1 text-foreground">{formatCurrency(currentTop)}</strong></span>
              <span className="text-muted-foreground">Reach #1 from <strong className="ml-1 text-primary">{formatCurrency(amountToReachTop)}</strong></span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Website / app URL</span>
                <div className="relative">
                  <Globe2 className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input type="text" inputMode="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="yourproduct.com or https://..." className="h-10 pl-9 font-mono text-xs" data-testid="input-campaign-url" />
                </div>
              </label>
              <label className="block space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Category</span>
                <div className="relative">
                  <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 w-full appearance-none rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" data-testid="select-campaign-category">
                    {CATEGORY_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.items.map((option) => <option key={option} value={option}>{option}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                </div>
              </label>
              <label className="block space-y-2 sm:col-span-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Demo video URL (optional)</span>
                <div className="relative">
                  <Input
                    type="text"
                    inputMode="url"
                    value={demoVideoUrl}
                    onChange={(event) => setDemoVideoUrl(event.target.value)}
                    placeholder="https://youtube.com/watch?v=... or https://vimeo.com/..."
                    className="h-10 pr-9 font-mono text-xs"
                    data-testid="input-campaign-demo-url"
                  />
                  {demoVideoUrl && (
                    <button
                      type="button"
                      onClick={() => setDemoVideoUrl("")}
                      className="absolute right-2 top-2.5 text-[10px] font-bold uppercase text-muted-foreground hover:text-destructive"
                      data-testid="button-clear-campaign-demo-url"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">Add a YouTube, Shorts, or Vimeo link and a "Demo" button appears on your listing.</p>
              </label>
              <div className="sm:col-span-2">
                <BrandColorPicker value={accent} onChange={setAccent} testIdPrefix="campaign-accent" />
              </div>
            </div>
            {preview && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm" data-testid="campaign-existing-product">
                <strong>This product is already competing.</strong>
                <span className="ml-2 text-muted-foreground">Current rank #{preview.rank} · ranking power {formatCurrency(preview.effectiveBid)}</span>
              </div>
            )}
            {previewError && <p className="mt-3 text-xs font-medium text-destructive">{previewError}</p>}
            <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
              {isSignedIn
                ? "Your final rank can still change when another verified product gains higher ranking power."
                : "Signing in takes one step and uses your Google or email account — no separate profile form."}
            </p>
          </div>
          <aside className="border-t border-border/60 bg-muted/[0.18] p-5 lg:border-l lg:border-t-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Your projected rank</p>
            <div className="mt-2 font-mono text-6xl font-bold text-primary">{rank ? `#${rank}` : "—"}</div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Based on the live ranking power, including community boosts and push downs.</p>
            {!showPaymentArea && (
              <>
                <Button
                  className="mt-6 h-11 w-full font-bold uppercase tracking-wider"
                  disabled={!previewReady || !rank || Boolean(previewError) || submitting || !isClerkLoaded || !isValidHexColor(accent)}
                  onClick={handlePrimaryClick}
                  data-testid="button-open-campaign-checkout"
                >
                  {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing PayPal</> : buttonLabel}
                </Button>
                <p className="mt-3 text-center text-[10px] text-muted-foreground">Minimum {formatCurrency(minimumBid)} · whole-dollar claims</p>
              </>
            )}
          </aside>
        </div>
      )}

      {showPaymentArea && (
        <div className="border-t border-primary/20 bg-primary/[0.04] p-5 sm:p-6" data-testid="campaign-claim-payment">
          <div className="mx-auto max-w-xl">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-primary"><Trophy className="h-3.5 w-3.5" /> Complete your payment</div>
            <p className="mt-2 text-sm text-muted-foreground">You&apos;re claiming with {formatCurrency(bidAmount)} for projected #{rank} in Campaign #{campaign?.number}. Another completed transaction can still change this position.</p>
            {pendingCheckout && !paymentConfirmed ? (
              <div className="mt-5">
                <PaymentConfirmation
                  listingName={pendingCheckout.listing.name}
                  amount={bidAmount}
                  campaignNumber={pendingCheckout.campaign.number}
                  lineLabel="Claim amount"
                  onConfirm={() => setPaymentConfirmed(true)}
                />
              </div>
            ) : pendingCheckout ? (
              <div className="mt-5">
                <PayPalCheckout
                  paymentId={pendingCheckout.payment.id}
                  onCompleted={async () => {
                    logClaimFlowEvent("TRANSACTION_FINALIZED", pendingCheckout.payment.id);
                    // pendingCheckout.listing is only a pre-payment preview
                    // (rendered from the not-yet-persisted draft, so its
                    // ownerBid/rank are placeholders) -- now that the payment
                    // has verifiably succeeded and the real listing row/rank
                    // exist, refetch it so the success screen shows the
                    // actual amount charged and rank, not zeros.
                    let finalListing = pendingCheckout.listing;
                    try {
                      finalListing = await getListing(pendingCheckout.listing.slug);
                    } catch {
                      // Fall back to the preview rather than blocking the
                      // already-successful payment on a display refresh.
                    }
                    setSuccess({
                      listing: finalListing,
                      manageUrl: pendingCheckout.manageUrl,
                      campaignNumber: pendingCheckout.campaign.number,
                      receiptNumber: pendingCheckout.payment.receiptNumber,
                    });
                    setPendingCheckout(null);
                    setPaymentConfirmed(false);
                    clearPendingOwnerClaim();
                    void queryClient.invalidateQueries();
                    toast({
                      title: "Campaign claim verified",
                      description: `${finalListing.name} is now ranked #${finalListing.rank}.`,
                    });
                  }}
                />
              </div>
            ) : autoResumeStatus === "loading" ? (
              <div className="mt-5 flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground" data-testid="campaign-claim-auto-loading">
                <Loader2 className="h-5 w-5 animate-spin" />
                Preparing secure payment...
              </div>
            ) : (
              <div className="mt-5 flex flex-col items-center gap-3 py-4 text-center" data-testid="campaign-claim-auto-error">
                <p className="text-sm font-medium text-destructive">Your account is ready. We couldn&apos;t start payment yet. Try payment again.</p>
                <Button
                  onClick={() => autoResumeRetry.current && void submitClaim(autoResumeRetry.current.claim, autoResumeRetry.current.idempotencyKey, { auto: true })}
                  data-testid="button-retry-campaign-claim-payment"
                >
                  Try payment again
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      <PolicyAcknowledgeDialog
        open={showPolicyDialog}
        onOpenChange={setShowPolicyDialog}
        onConfirm={() => void proceedAfterPolicyAcknowledged()}
        confirmLabel={isSignedIn ? buttonLabel : "Continue to sign in"}
        pending={submitting}
      />
    </section>
  );
}

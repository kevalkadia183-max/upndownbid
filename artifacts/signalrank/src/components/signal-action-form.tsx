import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, TrendingDown } from "lucide-react";
import { useGetListings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { checkoutPublicAction, getCurrentCampaign, newIdempotencyKey, PublicApiError, type PublicListing } from "@/lib/public-api";
import { cn, formatCurrency } from "@/lib/utils";
import { PayPalCheckout } from "@/components/paypal-checkout";
import { PolicyAcknowledgeDialog } from "@/components/policy-acknowledge-dialog";
import { PaymentConfirmation } from "@/components/payment-confirmation";
import {
  clearPendingCheckout,
  isPendingCheckoutForCampaign,
  loadPendingCheckout,
  matchesPendingDetails,
  savePendingCheckout,
  type PendingCheckoutDetails,
} from "@/lib/pending-checkout";

interface SignalActionFormProps {
  slug: string;
  type: "support" | "penalize";
  defaultAmount?: number;
  effectiveBid: number;
  onSuccess?: (result: { paymentId: string; listing: PublicListing; type: "support" | "penalty" }) => void;
}

const quickAmounts = [5, 10, 25, 50, 100];
const supportReasons = ["Great product", "Great idea", "Useful", "Deserves more visibility", "Supporting the founder", "Better than alternatives"];
const penaltyReasons = ["Bug", "UI / UX", "Performance", "Missing / broken feature", "I’m a competitor", "Just for fun", "Other"];
const issueReasons = new Set(["Bug", "UI / UX", "Performance", "Missing / broken feature"]);

export function SignalActionForm({ slug, type, defaultAmount = 10, effectiveBid, onSuccess }: SignalActionFormProps) {
  const [resumed] = useState(() => loadPendingCheckout(slug, type));
  const [amount, setAmount] = useState(resumed?.amount ?? defaultAmount);
  const [email, setEmail] = useState(resumed?.email ?? "");
  const [reason, setReason] = useState(resumed?.reason ?? "");
  const [reasonDescription, setReasonDescription] = useState(resumed?.reasonDescription ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(resumed && !resumed.payment ? "You have a pending checkout from an earlier session." : "");
  const [retryableError, setRetryableError] = useState(Boolean(resumed && !resumed.payment));
  // A resumed payment is only trusted for PayPal rendering once we've
  // confirmed its saved campaign is still the live one — never optimistically
  // reopen PayPal for a payment that may belong to a campaign that ended.
  const [pendingCheckout, setPendingCheckout] = useState<{ paymentId: string; listing: PublicListing } | null>(null);
  const [resumeCampaignChecked, setResumeCampaignChecked] = useState(false);
  const [showPolicyDialog, setShowPolicyDialog] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const idempotencyKey = useRef(resumed?.idempotencyKey ?? newIdempotencyKey());
  const resumedDetails = useRef<PendingCheckoutDetails | null>(
    resumed
      ? { type, amount: resumed.amount, email: resumed.email, reason: resumed.reason, reasonDescription: resumed.reasonDescription }
      : null,
  );
  const { data: listings } = useGetListings();
  const { data: campaign } = useQuery({
    queryKey: ["current-campaign"],
    queryFn: getCurrentCampaign,
    staleTime: 30_000,
  });
  const minimumAmount = campaign?.minimumBid ?? 5;

  useEffect(() => {
    if (!campaign || resumeCampaignChecked) return;
    setResumeCampaignChecked(true);
    if (!resumed) return;
    if (isPendingCheckoutForCampaign(resumed, campaign)) {
      if (resumed.payment) setPendingCheckout(resumed.payment);
      return;
    }
    // The campaign this attempt targeted has ended (or the attempt is too
    // old) — silently discard it instead of surfacing a stale/technical error.
    clearPendingCheckout(slug, type);
    resumedDetails.current = null;
    idempotencyKey.current = newIdempotencyKey();
    setError("");
    setRetryableError(false);
  }, [campaign, resumeCampaignChecked, resumed, slug, type]);
  const impact = type === "support" ? amount : -amount;
  const projectedBid = Math.max(0, effectiveBid + impact);
  const projectedRank = useMemo(() => {
    const otherBids = (listings ?? []).filter((listing) => listing.slug !== slug).map((listing) => listing.effectiveBid);
    return otherBids.filter((bid) => bid > projectedBid).length + 1;
  }, [listings, projectedBid, slug]);
  const reasons = type === "support" ? supportReasons : penaltyReasons;

  function hasValidPushDownReason() {
    return (
      type !== "penalize" ||
      Boolean(
        reason &&
          (reason !== "Other" || Boolean(reasonDescription.trim())) &&
          (!reasonDescription.trim() || issueReasons.has(reason)),
      )
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!campaign || !email || amount < minimumAmount || submitting || !hasValidPushDownReason()) return;
    setShowPolicyDialog(true);
  }

  async function performSubmit() {
    setShowPolicyDialog(false);
    if (!campaign || !email || amount < minimumAmount || submitting || !hasValidPushDownReason()) return;
    const currentDetails: PendingCheckoutDetails = { type, amount, email, reason, reasonDescription };
    if (resumedDetails.current && !matchesPendingDetails(resumedDetails.current, currentDetails)) {
      // The action details changed since the stored attempt — the old key no longer applies.
      idempotencyKey.current = newIdempotencyKey();
      resumedDetails.current = null;
    }
    setSubmitting(true);
    setError("");
    setRetryableError(false);
    const campaignContext = { campaignId: campaign.id, campaignEndAt: campaign.endAt, createdAt: Date.now() };
    savePendingCheckout(slug, { idempotencyKey: idempotencyKey.current, ...currentDetails, ...campaignContext, payment: null });
    try {
      const result = await checkoutPublicAction(slug, {
        type: type === "support" ? "support" : "penalty",
        amount,
        email,
        reason: reason || undefined,
        reasonDescription:
          type === "penalize" && issueReasons.has(reason)
            ? reasonDescription.trim() || undefined
            : type === "penalize" && reason === "Other"
              ? reasonDescription.trim()
              : undefined,
      }, idempotencyKey.current);
      if (result.payment.status !== "succeeded") {
        setPendingCheckout({ paymentId: result.payment.id, listing: result.listing });
        setPaymentConfirmed(false);
        resumedDetails.current = currentDetails;
        savePendingCheckout(slug, {
          idempotencyKey: idempotencyKey.current,
          ...currentDetails,
          ...campaignContext,
          payment: { paymentId: result.payment.id, listing: result.listing },
        });
        return;
      }
      clearPendingCheckout(slug, type);
      onSuccess?.({ paymentId: result.payment.id, listing: result.listing, type: type === "support" ? "support" : "penalty" });
    } catch (actionError) {
      const isRetryable =
        actionError instanceof PublicApiError
          ? actionError.retryable
          : false;
      setRetryableError(isRetryable);
      setError(
        isRetryable
          ? actionError instanceof Error
            ? actionError.message
            : "Checkout status could not be confirmed. Retry to continue with the same payment attempt."
          : actionError instanceof Error
            ? actionError.message
            : "Could not complete checkout.",
      );
      if (!isRetryable) {
        idempotencyKey.current = newIdempotencyKey();
        resumedDetails.current = null;
        clearPendingCheckout(slug, type);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" data-testid={`form-${type}-listing`}>
      <label className="block space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{type === "support" ? "Boost amount" : "Push Down amount"} (min {formatCurrency(minimumAmount)})</span>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted-foreground">$</span>
          <Input type="number" min={minimumAmount} max={10000} value={amount} onChange={(event) => setAmount(Math.max(minimumAmount, Number(event.target.value) || minimumAmount))} className="h-10 bg-muted/30 pl-7 font-mono text-sm" data-testid={`input-${type}-amount`} />
        </div>
      </label>
      <div className="flex flex-wrap gap-2" aria-label="Quick amount choices">
        {quickAmounts.map((quickAmount) => <Button key={quickAmount} type="button" variant={amount === quickAmount ? (type === "support" ? "secondary" : "destructive") : "outline"} size="sm" className="h-7 text-[10px] font-mono" onClick={() => setAmount(quickAmount)}>${quickAmount}</Button>)}
      </div>
      <label className="block space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Email for this private payment record</span>
        <Input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="h-10 bg-muted/30 font-mono text-sm" />
        <span className="block text-[10px] text-muted-foreground">This is not an account and is never shown publicly.</span>
      </label>
      {type === "support" ? (
        <label className="block space-y-2">
          <span className="flex justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">Reason <span className="font-normal opacity-60">(optional)</span></span>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={120} placeholder="Tell the community why…" className="min-h-16 resize-none bg-muted/30 font-mono text-xs" />
          <span className="flex flex-wrap gap-1.5">
            {reasons.map((value) => <button key={value} type="button" className={cn("rounded border px-2 py-1 text-[9px] font-mono", reason === value ? "border-secondary/50 bg-secondary/15 text-secondary" : "border-border/50 text-muted-foreground hover:bg-muted/40")} onClick={() => setReason(reason === value ? "" : value)}>{value}</button>)}
          </span>
        </label>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Primary reason</legend>
          <div className="flex flex-wrap gap-1.5" data-testid="push-down-reasons">
            {penaltyReasons.map((value) => <button key={value} type="button" aria-pressed={reason === value} className={cn("rounded border px-2 py-1.5 text-[10px] font-mono", reason === value ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-border/50 text-muted-foreground hover:bg-muted/40")} onClick={() => { setReason(value); setReasonDescription(""); }}>{value}</button>)}
          </div>
          {issueReasons.has(reason) && (
            <label className="block space-y-1.5">
              <span className="text-[10px] font-medium text-muted-foreground">Short issue description <span className="opacity-70">(optional)</span></span>
              <Textarea value={reasonDescription} onChange={(event) => setReasonDescription(event.target.value)} maxLength={120} placeholder="What should the owner know?" className="min-h-16 resize-none bg-muted/30 font-mono text-xs" data-testid="input-push-down-description" />
            </label>
          )}
          {reason === "Other" && (
            <label className="block space-y-1.5">
              <span className="text-[10px] font-medium text-muted-foreground">Short description <span className="text-destructive">(required)</span></span>
              <Textarea required value={reasonDescription} onChange={(event) => setReasonDescription(event.target.value)} maxLength={120} placeholder="Describe the reason for this Push Down" className="min-h-16 resize-none bg-muted/30 font-mono text-xs" data-testid="input-push-down-other-description" />
            </label>
          )}
          {(reason === "I’m a competitor" || reason === "Just for fun") && <p className="text-[10px] text-muted-foreground">No description is collected for this reason.</p>}
        </fieldset>
      )}
      <div className="space-y-2 rounded border border-border/40 bg-muted/20 p-3 font-mono text-[11px]" data-testid={`preview-${type}-bid`}>
        <div className="flex justify-between text-muted-foreground"><span>Current ranking power</span><span>{formatCurrency(effectiveBid)}</span></div>
        <div className={cn("flex justify-between font-bold", type === "support" ? "text-secondary" : "text-destructive")}><span>Your {type === "support" ? "boost" : "push down"}</span><span>{type === "support" ? "+" : "−"}{formatCurrency(amount)}</span></div>
        <div className="flex justify-between border-t border-border/40 pt-2 text-foreground"><span className="font-bold">Projected ranking power</span><span className="font-bold">{formatCurrency(projectedBid)}</span></div>
        <div className="flex justify-between text-primary"><span className="font-bold">Projected rank</span><span className="font-bold">#{projectedRank}</span></div>
      </div>
      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
          {retryableError && " Your next attempt will reuse the same payment attempt."}
        </p>
      )}
      {pendingCheckout && !paymentConfirmed ? (
        <PaymentConfirmation
          listingName={pendingCheckout.listing.name}
          amount={amount}
          lineLabel={type === "support" ? "Boost amount" : "Push Down amount"}
          onConfirm={() => setPaymentConfirmed(true)}
        />
      ) : pendingCheckout ? (
        <PayPalCheckout
          paymentId={pendingCheckout.paymentId}
          onCompleted={() => {
            clearPendingCheckout(slug, type);
            setPaymentConfirmed(false);
            onSuccess?.({
              paymentId: pendingCheckout.paymentId,
              listing: pendingCheckout.listing,
              type: type === "support" ? "support" : "penalty",
            });
          }}
        />
      ) : resumed?.payment && !resumeCampaignChecked ? (
        <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your pending checkout…
        </div>
      ) : (
        <Button type="submit" className={cn("h-11 w-full font-bold uppercase tracking-wider", type === "support" ? "bg-secondary text-secondary-foreground hover:bg-secondary/90" : "bg-destructive text-destructive-foreground hover:bg-destructive/90")} disabled={submitting || !campaign || (type === "penalize" && (!reason || (reason === "Other" && !reasonDescription.trim())))} data-testid={`button-submit-${type}`}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : type === "support" ? <ArrowUpRight className="mr-2 h-4 w-4" /> : <TrendingDown className="mr-2 h-4 w-4" />}
          {submitting ? "Processing" : retryableError ? (type === "support" ? "RETRY BOOST" : "RETRY PUSH DOWN") : type === "support" ? "BOOST" : "PUSH DOWN"}
        </Button>
      )}
      <p className="text-center text-[10px] text-muted-foreground">Campaign #{campaign?.number ?? "…"} only — verified signals reset at the next Sunday close.</p>
      <PolicyAcknowledgeDialog
        open={showPolicyDialog}
        onOpenChange={setShowPolicyDialog}
        onConfirm={() => void performSubmit()}
        confirmLabel={type === "support" ? "Boost" : "Push down"}
        pending={submitting}
      />
    </form>
  );
}
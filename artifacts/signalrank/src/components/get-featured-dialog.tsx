import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { PaymentConfirmation } from "@/components/payment-confirmation";
import { PayPalCheckout } from "@/components/paypal-checkout";
import { PolicyAcknowledgeDialog } from "@/components/policy-acknowledge-dialog";
import {
  getSponsorshipAvailability,
  newIdempotencyKey,
  purchaseSponsorship,
  PublicApiError,
  type SponsorshipCheckoutResult,
} from "@/lib/public-api";

type GetFeaturedDialogProps = {
  listingId: string;
  listingName: string;
  trigger: React.ReactNode;
  defaultOpen?: boolean;
};

// Purchase entry point for the Featured/Sponsored product -- fully separate
// from campaign claim/boost/penalty checkouts. Slot availability and price
// are always read live from the server; nothing here can be forced from the
// client if a slot has already filled up.
export function GetFeaturedDialog({ listingId, listingName, trigger, defaultOpen = false }: GetFeaturedDialogProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { data: availability, isLoading } = useQuery({
    queryKey: ["sponsorship-availability"],
    queryFn: getSponsorshipAvailability,
    enabled: open,
    staleTime: 10_000,
  });
  const [showPolicyDialog, setShowPolicyDialog] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SponsorshipCheckoutResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  useEffect(() => {
    if (!open) {
      setShowPolicyDialog(false);
      setPaymentConfirmed(false);
      setError("");
      setResult(null);
      setIdempotencyKey(newIdempotencyKey());
    }
  }, [open]);

  async function performPurchase() {
    setShowPolicyDialog(false);
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const purchase = await purchaseSponsorship(listingId, idempotencyKey);
      setResult(purchase);
      if (purchase.payment.status === "succeeded") {
        setPaymentConfirmed(true);
      }
    } catch (purchaseError) {
      setError(
        purchaseError instanceof PublicApiError
          ? purchaseError.message
          : "Could not start your Featured Sponsorship purchase. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const soldOut = availability !== undefined && availability.availableSlots <= 0;
  const succeeded = result?.payment.status === "succeeded";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md border-border/60 bg-card" data-testid="dialog-get-featured">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-4 w-4 fill-violet-500 text-violet-500" /> Get Featured
          </DialogTitle>
          <DialogDescription className="font-mono text-xs leading-relaxed">
            A Featured/Sponsored slot is a separate product from the weekly campaign — it never affects {listingName}&apos;s
            ranking, only its visibility in the dedicated Featured section and entry popup.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !availability ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking slot availability…
          </div>
        ) : succeeded ? (
          <div className="space-y-3 text-center" data-testid="get-featured-success">
            <Star className="mx-auto h-10 w-10 fill-violet-500 text-violet-500" />
            <p className="text-sm font-bold text-foreground">You&apos;re featured!</p>
            <dl className="mx-auto grid max-w-xs grid-cols-2 gap-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-3 text-left text-xs">
              <dt className="text-muted-foreground">Slot</dt>
              <dd className="text-right font-bold">#{result?.sponsorship.slotNumber}</dd>
              <dt className="text-muted-foreground">Starts</dt>
              <dd className="text-right font-bold">{result?.sponsorship.startAt ? new Date(result.sponsorship.startAt).toLocaleDateString() : "—"}</dd>
              <dt className="text-muted-foreground">Expires</dt>
              <dd className="text-right font-bold">{result?.sponsorship.expiresAt ? new Date(result.sponsorship.expiresAt).toLocaleDateString() : "—"}</dd>
            </dl>
            <Button className="w-full" onClick={() => setOpen(false)} data-testid="button-get-featured-done">
              Done
            </Button>
          </div>
        ) : result && !paymentConfirmed ? (
          <PaymentConfirmation
            listingName={listingName}
            amount={availability.price}
            lineLabel={`Featured slot · ${availability.durationDays} days`}
            onConfirm={() => setPaymentConfirmed(true)}
          />
        ) : result ? (
          <PayPalCheckout
            paymentId={result.payment.id}
            onCompleted={() => setResult((current) => (current ? { ...current, payment: { ...current.payment, status: "succeeded" } } : current))}
          />
        ) : soldOut ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-6 text-center text-xs text-muted-foreground" data-testid="get-featured-sold-out">
            All 4 Featured slots are currently taken. Check back once one expires or is cancelled.
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-3 font-mono text-xs">
              <div className="flex justify-between"><dt className="text-muted-foreground">Price</dt><dd className="font-bold">{formatCurrency(availability.price)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Duration</dt><dd className="font-bold">{availability.durationDays} days</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Slots available</dt><dd className="font-bold text-violet-600 dark:text-violet-300">{availability.availableSlots} of {availability.totalSlots}</dd></div>
            </dl>
            {error && <p className="text-xs font-medium text-destructive" role="alert">{error}</p>}
            <Button
              className="h-11 w-full bg-violet-600 font-bold uppercase tracking-wider text-white hover:bg-violet-600/90"
              disabled={submitting}
              onClick={() => setShowPolicyDialog(true)}
              data-testid="button-start-get-featured"
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {submitting ? "Starting checkout" : `Get featured for ${formatCurrency(availability.price)}`}
            </Button>
          </div>
        )}
      </DialogContent>
      <PolicyAcknowledgeDialog
        open={showPolicyDialog}
        onOpenChange={setShowPolicyDialog}
        onConfirm={() => void performPurchase()}
        confirmLabel="Get featured"
        pending={submitting}
      />
    </Dialog>
  );
}

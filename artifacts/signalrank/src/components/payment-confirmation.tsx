import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

type PaymentConfirmationProps = {
  listingName: string;
  amount: number;
  campaignNumber?: number;
  lineLabel: string;
  onConfirm: () => void;
};

// A single, explicit confirmation step shown before the PayPal button is
// rendered for any real-money action (claim, boost, or push down). Nothing
// downstream (PayPalCheckout, order creation) mounts until the user has seen
// the exact amount/listing/campaign and ticked the acknowledgement box.
export function PaymentConfirmation({ listingName, amount, campaignNumber, lineLabel, onConfirm }: PaymentConfirmationProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div className="space-y-4 rounded-xl border border-primary/25 bg-primary/[0.04] p-4" data-testid="payment-confirmation">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
        <ShieldCheck className="h-3.5 w-3.5" /> Confirm before paying
      </div>
      <dl className="space-y-1.5 rounded-lg border border-border/50 bg-card p-3 font-mono text-xs">
        <div className="flex justify-between"><dt className="text-muted-foreground">Listing</dt><dd className="font-bold">{listingName}</dd></div>
        {campaignNumber !== undefined && (
          <div className="flex justify-between"><dt className="text-muted-foreground">Campaign</dt><dd className="font-bold">#{campaignNumber}</dd></div>
        )}
        <div className="flex justify-between"><dt className="text-muted-foreground">{lineLabel}</dt><dd className="font-bold">{formatCurrency(amount)}</dd></div>
        <div className="flex justify-between border-t border-border/40 pt-1.5"><dt className="text-muted-foreground">Total charged today</dt><dd className="font-bold text-primary">{formatCurrency(amount)}</dd></div>
      </dl>
      <label className="flex items-start gap-2.5 text-xs" data-testid="checkbox-payment-confirmation-label">
        <Checkbox
          checked={acknowledged}
          onCheckedChange={(value) => setAcknowledged(value === true)}
          data-testid="checkbox-payment-confirmation"
          className="mt-0.5"
        />
        <span className="text-muted-foreground">
          I understand this payment is processed immediately and, once verified, is final under the{" "}
          <a href="/refund-policy" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            Refund & Cancellation Policy
          </a>
          .
        </span>
      </label>
      <Button
        type="button"
        className="h-11 w-full font-bold uppercase tracking-wider"
        disabled={!acknowledged}
        onClick={onConfirm}
        data-testid="button-confirm-payment"
      >
        Confirm and pay
      </Button>
    </div>
  );
}

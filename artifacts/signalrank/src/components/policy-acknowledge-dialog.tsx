import { useState } from "react";
import { Link } from "wouter";
import { TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

type PolicyAcknowledgeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  confirmLabel: string;
  pending?: boolean;
};

// A pre-submission warning that must be explicitly acknowledged (checkbox)
// before a listing/claim is created or a payment is started. Resets its own
// checkbox state whenever it is reopened so a later flow can't silently
// reuse an earlier acknowledgement.
export function PolicyAcknowledgeDialog({
  open,
  onOpenChange,
  onConfirm,
  confirmLabel,
  pending = false,
}: PolicyAcknowledgeDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setAcknowledged(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md border-border/60 bg-card" data-testid="dialog-policy-acknowledge">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-amber-500" />
            Before you continue
          </DialogTitle>
          <DialogDescription className="font-mono text-xs leading-relaxed">
            Signals and rankings on this platform are driven by real, verified payments. Ranking changes take effect once a
            payment is confirmed and are not reversed for a change of mind. Submitted content is public and subject to
            moderation.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2.5 rounded-md border border-border/50 bg-muted/20 p-3 text-xs" data-testid="checkbox-policy-acknowledge-label">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(value) => setAcknowledged(value === true)}
            data-testid="checkbox-policy-acknowledge"
            className="mt-0.5"
          />
          <span className="text-muted-foreground">
            I have read and agree to the{" "}
            <Link href="/terms" target="_blank" className="text-primary underline underline-offset-2">
              Terms & Conditions
            </Link>
            ,{" "}
            <Link href="/website-policy" target="_blank" className="text-primary underline underline-offset-2">
              Website & Content Policy
            </Link>
            ,{" "}
            <Link href="/refund-policy" target="_blank" className="text-primary underline underline-offset-2">
              Refund & Cancellation Policy
            </Link>{" "}
            and{" "}
            <Link href="/community-guidelines" target="_blank" className="text-primary underline underline-offset-2">
              Community Guidelines
            </Link>
            .
          </span>
        </label>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-policy-acknowledge-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!acknowledged || pending}
            onClick={onConfirm}
            data-testid="button-policy-acknowledge-confirm"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

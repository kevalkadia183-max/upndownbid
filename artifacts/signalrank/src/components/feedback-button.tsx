import { useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { Loader2, MessageCircleWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { createPublicFeedback } from "@/lib/public-api";

const categoryOptions: { value: "payment_issue" | "bug" | "other"; label: string }[] = [
  { value: "payment_issue", label: "Payment failed or looks wrong" },
  { value: "bug", label: "Something is broken" },
  { value: "other", label: "Other feedback" },
];

export function FeedbackButton() {
  const { toast } = useToast();
  const { isSignedIn, user } = useUser();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<"payment_issue" | "bug" | "other">("payment_issue");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const signedInEmail = isSignedIn
    ? user?.primaryEmailAddress?.emailAddress ?? ""
    : "";

  async function handleSubmit() {
    if (!message.trim()) {
      toast({ title: "Add a short description before sending", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await createPublicFeedback({
        category,
        message: message.trim(),
        contactEmail: (contactEmail || signedInEmail || undefined) as string | undefined,
        path: location,
      });
      toast({ title: "Thanks — we received your feedback", description: "We'll follow up if we need more details." });
      setMessage("");
      setContactEmail("");
      setCategory("payment_issue");
      setOpen(false);
    } catch (error) {
      toast({
        title: "Could not send feedback",
        description: error instanceof Error ? error.message : "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          className="fixed right-4 bottom-24 md:bottom-6 z-40 h-12 w-12 rounded-full border-4 border-foreground bg-primary text-primary-foreground neo-shadow hover:bg-primary/90"
          aria-label="Report a payment issue or bug"
          data-testid="button-feedback-fab"
        >
          <MessageCircleWarning className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="dialog-feedback">
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>
            Payment problems, bugs, or anything else that felt off. This goes straight to the team.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="feedback-category">Category</Label>
            <Select value={category} onValueChange={(value) => setCategory(value as typeof category)}>
              <SelectTrigger id="feedback-category" data-testid="select-feedback-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="feedback-message">What happened?</Label>
            <Textarea
              id="feedback-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Describe the payment issue or bug in a few sentences..."
              data-testid="input-feedback-message"
            />
          </div>
          {!isSignedIn && (
            <div className="grid gap-1.5">
              <Label htmlFor="feedback-email">Email (optional, so we can follow up)</Label>
              <Input
                id="feedback-email"
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="you@example.com"
                data-testid="input-feedback-email"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting} data-testid="button-feedback-submit">
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Send feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

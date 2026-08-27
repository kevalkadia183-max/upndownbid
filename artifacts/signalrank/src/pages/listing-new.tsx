import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useSignUp } from "@clerk/react";
import { createListing, updateMyProfile } from "@workspace/api-client-react";
import { ArrowLeft, CheckCircle2, ChevronDown, ExternalLink, Loader2, Minus, Plus, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { newIdempotencyKey, previewPublicListing, getCurrentCampaign, type PublicListing } from "@/lib/public-api";
import { formatCurrency } from "@/lib/utils";
import { CATEGORY_GROUPS } from "@/lib/category-taxonomy";
import { PolicyAcknowledgeDialog } from "@/components/policy-acknowledge-dialog";
import { BrandColorPicker, BRAND_COLOR_SWATCHES, isValidHexColor } from "@/components/brand-color-picker";

const categories = CATEGORY_GROUPS.flatMap((group) => group.items);

type Preview = {
  canonicalUrl: string;
  rank?: number;
  currentTop?: number;
  toReachTop?: number;
  duplicate?: PublicListing;
};

function hostnameName(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").split(".")[0]
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return "";
  }
}

function looksLikeWebsiteUrl(value: string) {
  const candidate = value.trim();
  if (!candidate || candidate.endsWith(".") || candidate.endsWith("/")) return false;
  try {
    const parsed = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    return parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

export default function ListingNewPage() {
  const [, setLocation] = useLocation();
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [demoVideoUrl, setDemoVideoUrl] = useState("");
  const [accent, setAccent] = useState<string>(BRAND_COLOR_SWATCHES[0]);
  const [ownerBid, setOwnerBid] = useState(6);
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ listing: PublicListing } | null>(null);
  const [showPolicyDialog, setShowPolicyDialog] = useState(false);
  const attemptKey = useRef(newIdempotencyKey());
  const { signUp, fetchStatus } = useSignUp();
  const { data: campaign } = useQuery({
    queryKey: ["current-campaign"],
    queryFn: getCurrentCampaign,
    staleTime: 30_000,
  });
  const minimumBid = campaign?.minimumBid ?? 5;

  useEffect(() => {
    if (!websiteUrl || ownerBid <= minimumBid || !looksLikeWebsiteUrl(websiteUrl)) {
      setPreview(null);
      setPreviewError("");
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const response = await previewPublicListing(websiteUrl, ownerBid);
        setPreview(response);
        setPreviewError("");
        if (!name && !response.duplicate) setName(hostnameName(websiteUrl));
      } catch (error) {
        setPreview(null);
        setPreviewError(error instanceof Error ? error.message : "Enter a valid website URL.");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [websiteUrl, ownerBid, name, minimumBid]);

  const canCheckout =
    Boolean(preview && !preview.duplicate) &&
    category &&
    name.trim() &&
    tagline.trim() &&
    description.trim() &&
    isValidHexColor(accent) &&
    ownerName.trim().length >= 2 &&
    email.includes("@") &&
    password.length >= 8 &&
    password === passwordConfirmation &&
    ownerBid > minimumBid;

  async function createOwnerListing() {
    await updateMyProfile({ displayName: ownerName.trim() });
    const listing = await createListing({
      websiteUrl,
      category,
      name: name.trim(),
      tagline: tagline.trim(),
      description: description.trim(),
      ownerBid,
      accent,
      demoVideoUrl: demoVideoUrl.trim() || undefined,
    });
    setSuccess({ listing });
  }

  async function submitVerification(event: React.FormEvent) {
    event.preventDefault();
    if (!signUp || !verificationCode.trim() || submitting) return;
    setSubmitting(true);
    try {
      await signUp.verifications.verifyEmailCode({ code: verificationCode.trim() });
      if (signUp.status !== "complete") {
        throw new Error("Email verification is not complete yet. Check the code and try again.");
      }
      await signUp.finalize({ navigate: () => undefined });
      await createOwnerListing();
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Could not verify your owner account.");
      attemptKey.current = newIdempotencyKey();
    } finally {
      setSubmitting(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canCheckout || submitting) return;
    setShowPolicyDialog(true);
  }

  async function performSubmit() {
    if (!canCheckout || submitting) return;
    setShowPolicyDialog(false);
    setSubmitting(true);
    setPreviewError("");
    try {
      const { error } = await signUp.password({
        emailAddress: email.trim().toLowerCase(),
        password,
      });
      if (error) {
        throw new Error(error.message ?? "Could not create your owner account.");
      }
      await signUp.verifications.sendEmailCode();
      setAwaitingVerification(true);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Could not create your owner account.");
      attemptKey.current = newIdempotencyKey();
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12 md:py-20">
        <Card className="border-primary/30 bg-card p-7 text-center shadow-lg md:p-10">
          <CheckCircle2 className="mx-auto h-12 w-12 text-secondary" />
          <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Sandbox checkout complete</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">You&apos;re on the board.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
              {success.listing.name} is now ranked #{success.listing.rank} with ranking power of {formatCurrency(success.listing.effectiveBid)}.
          </p>
          <p className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-3 font-mono text-xs text-muted-foreground">
             Your owner account is protected by Clerk. Your email stays private and your founder profile is never shown in public rankings.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <Button asChild variant="outline" className="h-11 border-border/60 font-bold uppercase tracking-wider">
              <Link href={`/listing/${success.listing.slug}`}><ExternalLink className="mr-2 h-4 w-4" /> View product</Link>
            </Button>
            <Button asChild className="h-11 font-bold uppercase tracking-wider">
              <Link href="/owner/dashboard">Open owner workspace</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 md:py-12">
      <Link href="/" className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary">
        <ArrowLeft className="h-3 w-3" /> Back to discovery
      </Link>
      <div className="mt-7 max-w-2xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Add your product</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-5xl">Put your website on the leaderboard.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
           Enter Campaign {campaign ? `#${campaign.number}` : ""} with a fresh starting claim above the {formatCurrency(minimumBid)} minimum. Create your private owner account to manage your product and reply to community feedback.
        </p>
      </div>

      <form onSubmit={awaitingVerification ? submitVerification : submit} className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
        <Card className="space-y-6 border-border/60 bg-card p-5 shadow-sm md:p-7">
          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider">Website URL</span>
            <Input
              type="url"
              required
              placeholder="https://yourwebsite.com"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              className="h-11 font-mono"
              data-testid="input-add-product-url"
            />
            <span className="text-[11px] text-muted-foreground">Required. We normalize secure http/https URLs and prevent duplicate listings.</span>
          </label>

          {preview?.duplicate && (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-4" data-testid="duplicate-listing-notice">
              <p className="font-bold">This website is already on the leaderboard.</p>
                 <p className="mt-1 text-sm text-muted-foreground">Current rank #{preview.duplicate.rank} · Ranking power {formatCurrency(preview.duplicate.effectiveBid)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline"><Link href={`/listing/${preview.duplicate.slug}`}>View listing</Link></Button>
                 <Button asChild size="sm"><Link href={`/listing/${preview.duplicate.slug}?action=support`}>BOOST</Link></Button>
              </div>
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider">Category</span>
              <div className="relative">
                <select value={category} onChange={(event) => setCategory(event.target.value)} required className="h-11 w-full appearance-none rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" data-testid="select-add-product-category">
                  <option value="" disabled>Select a category</option>
                  {CATEGORY_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.items.map((option) => <option key={option} value={option}>{option}</option>)}
                    </optgroup>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted-foreground" />
              </div>
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider">Product name</span>
              <Input required placeholder="Your product name" value={name} onChange={(event) => setName(event.target.value)} className="h-11" />
            </label>
          </div>
          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider">Short description</span>
            <Input required maxLength={160} placeholder="What does your product do?" value={tagline} onChange={(event) => setTagline(event.target.value)} className="h-11" />
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider">Product details</span>
            <Textarea required maxLength={2000} placeholder="Give the community useful context about your product." value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-28" />
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider">Demo video URL (optional)</span>
            <div className="relative">
              <Input
                type="text"
                inputMode="url"
                maxLength={2048}
                placeholder="https://youtube.com/watch?v=... or https://vimeo.com/..."
                value={demoVideoUrl}
                onChange={(event) => setDemoVideoUrl(event.target.value)}
                className="h-11 pr-9 font-mono"
                data-testid="input-add-product-demo-url"
              />
              {demoVideoUrl && (
                <button
                  type="button"
                  onClick={() => setDemoVideoUrl("")}
                  className="absolute right-2 top-3 text-[10px] font-bold uppercase text-muted-foreground hover:text-destructive"
                  data-testid="button-clear-add-product-demo-url"
                >
                  Clear
                </button>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground">Optional. A YouTube, Shorts, or Vimeo link shows a "Demo" button on your listing.</span>
          </label>
          <BrandColorPicker value={accent} onChange={setAccent} testIdPrefix="add-product-accent" />
          <div className="space-y-4 rounded-xl border border-primary/25 bg-primary/5 p-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider">Owner account</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Use this secure account to manage your product and respond to public feedback.</p>
            </div>
            {!awaitingVerification ? (
              <>
                <label className="block space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider">Your name</span>
                  <Input required minLength={2} maxLength={80} placeholder="Founder or team name" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} className="h-11" data-testid="input-owner-name" />
                </label>
                <label className="block space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider">Email</span>
                  <Input required type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 font-mono" data-testid="input-add-product-email" />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider">Password</span>
                    <Input required type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11" data-testid="input-owner-password" />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider">Confirm password</span>
                    <Input required type="password" minLength={8} autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} className="h-11" data-testid="input-owner-password-confirmation" />
                  </label>
                </div>
                {passwordConfirmation && password !== passwordConfirmation && <p className="text-xs font-medium text-destructive">Passwords do not match.</p>}
                <p className="text-[11px] text-muted-foreground">Your password is sent directly to Clerk and is never stored by upndownbid.</p>
              </>
            ) : (
              <label className="block space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider">Email verification code</span>
                <Input required inputMode="numeric" autoComplete="one-time-code" placeholder="Enter the code from your email" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} className="h-11 font-mono" data-testid="input-owner-verification-code" />
                <span className="text-[11px] text-muted-foreground">We sent a verification code to {email}. Confirm it to create your account and complete the sandbox claim.</span>
              </label>
            )}
          </div>
        </Card>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="border-primary/30 bg-primary/5 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-primary">
              <Rocket className="h-4 w-4" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em]">Claim your spot</span>
            </div>
             <p className="mt-4 text-xs font-bold uppercase tracking-wider">Starting claim</p>
            <div className="mt-3 flex items-center gap-2">
              <Button type="button" size="icon" variant="outline" onClick={() => setOwnerBid((value) => Math.max(minimumBid + 1, value - 25))}><Minus className="h-4 w-4" /></Button>
              <div className="relative flex-1">
                <span className="absolute left-3 top-3 font-mono text-sm text-muted-foreground">$</span>
                <Input type="number" min={minimumBid + 1} max={100000} value={ownerBid} onChange={(event) => setOwnerBid(Math.max(minimumBid + 1, Number(event.target.value) || minimumBid + 1))} className="h-11 pl-7 text-center font-mono text-lg font-bold" data-testid="input-owner-bid" />
              </div>
              <Button type="button" size="icon" variant="outline" onClick={() => setOwnerBid((value) => Math.min(100000, value + 25))}><Plus className="h-4 w-4" /></Button>
            </div>
             <p className="mt-2 text-[10px] text-muted-foreground">Campaign minimum: {formatCurrency(minimumBid)}. Starting claims must be a whole dollar above the minimum and do not carry into the next campaign.</p>
            <div className="mt-5 rounded-lg border border-border/50 bg-card p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Projected rank</p>
              <div className="mt-1 font-mono text-4xl font-bold text-primary">{preview?.duplicate ? `#${preview.duplicate.rank}` : preview?.rank ? `#${preview.rank}` : "—"}</div>
              <p className="mt-1 text-xs text-muted-foreground">Based on the current leaderboard.</p>
              <dl className="mt-4 space-y-2 border-t border-border/40 pt-3 text-xs">
                <div className="flex justify-between"><dt className="text-muted-foreground">Current #1</dt><dd className="font-mono font-bold">{preview?.currentTop ? formatCurrency(preview.currentTop) : "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">To reach #1</dt><dd className="font-mono font-bold">{preview?.toReachTop ? formatCurrency(preview.toReachTop) : "—"}</dd></div>
              </dl>
            </div>
            {previewError && <p className="mt-3 text-xs font-medium text-destructive">{previewError}</p>}
            <Button type="submit" disabled={awaitingVerification ? !verificationCode.trim() || submitting || fetchStatus === "fetching" : !canCheckout || submitting || fetchStatus === "fetching"} className="mt-5 h-12 w-full font-bold uppercase tracking-wider" data-testid="button-continue-add-product">
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {awaitingVerification ? "Verifying owner account" : "Creating owner account"}</> : awaitingVerification ? "Verify and claim spot" : "Create account and claim"}
            </Button>
            <p className="mt-3 text-center text-[10px] text-muted-foreground">Sandbox only — no card details or real funds are collected.</p>
          </Card>
        </aside>
      </form>
      <PolicyAcknowledgeDialog
        open={showPolicyDialog}
        onOpenChange={setShowPolicyDialog}
        onConfirm={() => void performSubmit()}
        confirmLabel="Create account and claim"
        pending={submitting}
      />
    </div>
  );
}
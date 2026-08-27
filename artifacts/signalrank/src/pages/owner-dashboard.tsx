import { useState, useRef, useEffect, useMemo } from "react";
import { Link, Redirect } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import {
  type Invoice,
  type ListingUpdate,
  type MemberListing,
  type MemberProfile,
  type MemberProfileUpdate,
  type Review,
  useGetMyProfile,
  useGetMyListings,
  useGetMyInvoices,
  downloadMyInvoicePdf,
  useUpdateMyListing,
  useUpdateMyProfile,
  useReplyToOwnedListingReview,
  useArchiveMyListing,
  requestMyListingLogoUploadUrl,
  getGetMyListingsQueryKey,
  getGetMyProfileQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { initialsFromName, normalizedHref, socialLinkTokens } from "@/lib/profile-display";
import { GetFeaturedDialog } from "@/components/get-featured-dialog";
import { BrandColorPicker, isValidHexColor } from "@/components/brand-color-picker";
import { ListingAvatar } from "@/components/listing-avatar";
import { LogoUploadControl } from "@/components/logo-upload-control";
import {
  LogOut,
  TrendingUp,
  Settings,
  Edit2,
  ExternalLink,
  Zap,
  Activity,
  User,
  ShieldAlert,
  Star,
  ActivitySquare,
  MousePointerClick,
  MapPin,
  Globe,
  Link2,
  Briefcase,
  Trash2,
  AlertTriangle,
  ChevronDown,
  Receipt,
  Download,
} from "lucide-react";

export default function OwnerDashboard() {
  const { user, isLoaded: isClerkLoaded } = useUser();
  const { signOut } = useClerk();

  const { data: profile, isLoading: isProfileLoading } = useGetMyProfile({
    query: {
      enabled: isClerkLoaded && !!user,
      queryKey: getGetMyProfileQueryKey(),
    }
  });

  const { data: listings, isLoading: isListingsLoading } = useGetMyListings({
    query: {
      enabled: isClerkLoaded && !!user,
      queryKey: getGetMyListingsQueryKey(),
    }
  });
  if (!isClerkLoaded || isProfileLoading || isListingsLoading) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-5xl animate-pulse">
        <div className="h-8 bg-muted rounded w-48 mb-8"></div>
        <div className="space-y-6">
          <div className="h-48 bg-muted rounded-xl"></div>
          <div className="h-48 bg-muted rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/owner/sign-in" />;
  }

  const totalClicks = (listings ?? []).reduce((sum, listing) => sum + (listing.clickAnalytics?.totalClicks ?? 0), 0);
  const activeListings = (listings ?? []).filter((listing) => listing.status !== "archived");
  const archivedListings = (listings ?? []).filter((listing) => listing.status === "archived");

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            <User className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" />
            Owner Portal
          </h1>
          <p className="mt-1 text-xs font-mono text-muted-foreground sm:text-sm">
            Manage your listings and view performance signals.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => signOut()}
          className="h-9 shrink-0 self-start rounded-md border-border/60 bg-card/60 text-xs font-bold uppercase tracking-wider hover:bg-muted sm:self-auto"
        >
          <LogOut className="mr-2 h-3.5 w-3.5" />
          Sign Out
        </Button>
      </div>

      <ProfileSummaryCard profile={profile} />

      {!!listings?.length && (
        <div className="mb-6 flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:mb-8 sm:p-5" data-testid="stat-total-clicks">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <MousePointerClick className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-2xl font-bold text-foreground">{formatNumber(totalClicks)}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total website clicks across all products</div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <h2 className="text-lg font-bold uppercase tracking-wider text-foreground border-b border-border/40 pb-2">
          My Products
        </h2>

        {!activeListings.length ? (
          <div className="border border-border/50 border-dashed rounded-xl p-12 text-center bg-card/30 flex flex-col items-center justify-center">
            <ActivitySquare className="w-8 h-8 text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-bold mb-2 text-foreground">No products yet</h3>
            <p className="text-xs font-mono text-muted-foreground mb-6 max-w-sm">
              You haven't claimed any products. Browse the public ledger to claim an active campaign spot.
            </p>
            <Button asChild className="h-10 rounded bg-primary text-xs font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90">
              <Link href="/">
                <Zap className="mr-2 h-4 w-4" /> Go to Ledger
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-6">
            {activeListings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </div>

      {archivedListings.length > 0 && (
        <div className="mt-8">
          <ArchivedListingsSection listings={archivedListings} />
        </div>
      )}

      <div className="mt-8">
        <InvoicesSection />
      </div>
    </div>
  );
}

function InvoicesSection() {
  const { toast } = useToast();
  const { data: invoices, isLoading } = useGetMyInvoices();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function handleDownload(invoice: Invoice) {
    setDownloadingId(invoice.id);
    try {
      const blob = await downloadMyInvoicePdf(invoice.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: "Could not download invoice",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  }

  if (isLoading || !invoices?.length) return null;

  return (
    <div className="space-y-4" data-testid="section-invoices">
      <h2 className="text-lg font-bold uppercase tracking-wider text-foreground border-b border-border/40 pb-2">
        Invoices
      </h2>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <div className="divide-y divide-border/40">
          {invoices.map((invoice) => (
            <div
              key={invoice.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
              data-testid={`invoice-row-${invoice.id}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Receipt className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{invoice.invoiceNumber}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {invoice.listingName ?? "—"} · {new Date(invoice.issuedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 rounded font-mono text-[10px] uppercase tracking-wider",
                    invoice.status === "PAID" && "border-primary/40 bg-primary/10 text-primary",
                    invoice.status === "REFUNDED" && "border-destructive/40 bg-destructive/10 text-destructive",
                    invoice.status === "PARTIALLY_REFUNDED" && "border-amber-500/40 bg-amber-500/10 text-amber-600",
                  )}
                >
                  {invoice.status.replace("_", " ")}
                </Badge>
                <span className="font-mono text-sm font-bold text-foreground">
                  {formatCurrency(invoice.total)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload(invoice)}
                  disabled={downloadingId === invoice.id}
                  className="h-8 rounded border-border/60 text-xs font-bold uppercase tracking-wider"
                  data-testid={`button-download-invoice-${invoice.id}`}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {downloadingId === invoice.id ? "..." : "PDF"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArchivedListingsSection({ listings }: { listings: MemberListing[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border/50 bg-card/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
        data-testid="button-toggle-archived-listings"
      >
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Deleted products ({listings.length})
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/50 p-4 pt-3">
          {listings.map((listing) => (
            <div key={listing.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2" data-testid={`archived-listing-${listing.id}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{listing.name}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{listing.websiteUrl}</p>
              </div>
              <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wider font-mono rounded bg-muted/50 border-border/50 text-muted-foreground">
                Deleted
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileSummaryCard({ profile }: { profile: MemberProfile | undefined }) {
  const displayName = profile?.displayName?.trim() || "Unnamed owner";
  const roleAndCompany = [profile?.profileRole?.trim(), profile?.company?.trim()].filter(Boolean).join(" at ");
  const hasOptionalDetails = Boolean(
    profile?.bio?.trim() || profile?.location?.trim() || profile?.website?.trim() || profile?.socialLinks?.trim() || roleAndCompany,
  );
  const socialTokens = useMemo(
    () => (profile?.socialLinks?.trim() ? socialLinkTokens(profile.socialLinks.trim()) : []),
    [profile?.socialLinks],
  );

  return (
    <div
      className="mb-6 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm sm:mb-8"
      data-testid="profile-summary-card"
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:gap-5 sm:p-6">
        <Avatar className="h-16 w-16 shrink-0 rounded-xl border border-border/50 bg-primary/5 text-primary sm:h-20 sm:w-20">
          {profile?.photoUrl ? <AvatarImage src={profile.photoUrl} alt={displayName} className="object-cover" /> : null}
          <AvatarFallback className="rounded-xl bg-primary/10 text-lg font-bold text-primary sm:text-xl">
            {initialsFromName(profile?.displayName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold tracking-tight text-foreground sm:text-xl" data-testid="text-profile-display-name">
                {displayName}
              </h2>
              {roleAndCompany && (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs font-mono text-muted-foreground sm:text-sm">
                  <Briefcase className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{roleAndCompany}</span>
                </p>
              )}
            </div>
            <ProfileEditDialog profile={profile} />
          </div>

          {!hasOptionalDetails ? (
            <p className="mt-3 text-xs font-mono text-muted-foreground">
              Add a bio, role, and links so buyers and moderators know who they're dealing with.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {profile?.bio?.trim() && (
                <p className="text-sm leading-relaxed text-foreground/90">{profile.bio.trim()}</p>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-mono text-muted-foreground">
                {profile?.location?.trim() && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {profile.location.trim()}
                  </span>
                )}
                {profile?.website?.trim() && (
                  <a
                    href={normalizedHref(profile.website.trim())}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-primary hover:underline"
                  >
                    <Globe className="h-3.5 w-3.5 shrink-0" />
                    <span className="max-w-[14rem] truncate">{profile.website.trim()}</span>
                  </a>
                )}
                {socialTokens.map((token, index) =>
                  token.href ? (
                    <a
                      key={`${token.text}-${index}`}
                      href={token.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <Link2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="max-w-[14rem] truncate">{token.text}</span>
                    </a>
                  ) : (
                    <span key={`${token.text}-${index}`}>{token.text}</span>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ListingCard({ listing }: { listing: MemberListing }) {
  return (
    <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm flex flex-col">
      <div className="p-6 md:p-8 flex flex-col md:flex-row gap-6 items-start">
        <div className="relative shrink-0">
          <ListingAvatar
            logoUrl={listing.logoUrl}
            initials={listing.initials}
            accent={listing.accent}
            alt={listing.name}
            className="w-16 h-16 shadow-sm md:w-20 md:h-20 text-2xl"
          />
          <div className="absolute -bottom-2 -right-2 bg-background text-foreground w-7 h-7 rounded border border-border/50 flex items-center justify-center shadow-sm font-mono font-bold text-[10px]">
            #{listing.rank}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono rounded bg-muted/30 border-border/50 px-2 py-0.5 text-muted-foreground">
              {listing.category}
            </Badge>
            <Badge variant="outline" className={cn(
              "text-[10px] uppercase tracking-wider font-mono rounded px-2 py-0.5",
              listing.status === "active" ? "bg-primary/10 border-primary/20 text-primary" : "bg-muted/50 border-border/50 text-muted-foreground"
            )}>
              {listing.status}
            </Badge>
          </div>
          
          <h3 className="text-xl font-bold tracking-tight text-foreground mb-1 flex items-center gap-2">
            {listing.name}
            {listing.websiteUrl && (
              <a href={listing.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </h3>
          
          <p className="text-sm font-mono text-muted-foreground line-clamp-2">
            {listing.tagline}
          </p>
        </div>

        <div className="w-full md:w-auto flex flex-col md:items-end border-t border-border/30 md:border-t-0 pt-4 md:pt-0 shrink-0">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Ranking Power</span>
          <span className="font-mono text-2xl font-bold text-foreground mb-3">{formatCurrency(listing.effectiveBid)}</span>
          <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
            <GetFeaturedDialog
              listingId={listing.id}
              listingName={listing.name}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-violet-500/40 text-violet-600 hover:bg-violet-500/10 dark:text-violet-300"
                  data-testid={`button-get-featured-${listing.id}`}
                >
                  <Star className="h-3.5 w-3.5 fill-current" /> Get Featured
                </Button>
              }
            />
            <ListingEditDialog listing={listing} />
            <DeleteListingDialog listing={listing} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border/70 border-t border-border/70">
        <div className="bg-card/90 p-4 flex flex-col items-center justify-center">
          <div className="flex items-center gap-1.5 text-secondary font-mono text-lg font-bold mb-1">
            <TrendingUp className="w-4 h-4" />
            {listing.supporters}
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Boosts</span>
        </div>
        
        <div className="bg-card/90 p-4 flex flex-col items-center justify-center">
          <div className="flex items-center gap-1.5 text-destructive font-mono text-lg font-bold mb-1">
            <ShieldAlert className="w-4 h-4" />
            {listing.penalizers}
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Push Downs</span>
        </div>
        
        <div className="bg-card/90 p-4 flex flex-col items-center justify-center">
          <div className="flex items-center gap-1.5 text-primary font-mono text-lg font-bold mb-1">
            <Star className="w-4 h-4 fill-primary/20" />
            {listing.rating.toFixed(1)}
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Avg Rating</span>
        </div>
        
        <div className="bg-card/90 p-4 flex flex-col items-center justify-center">
          <div className="flex items-center gap-1.5 text-foreground font-mono text-lg font-bold mb-1">
            <Activity className="w-4 h-4" />
            {listing.reviewCount}
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Reviews</span>
        </div>

        <div className="bg-card/90 p-4 flex flex-col items-center justify-center" data-testid={`listing-clicks-${listing.id}`}>
          <div className="flex items-center gap-1.5 text-foreground font-mono text-lg font-bold mb-1">
            <MousePointerClick className="w-4 h-4" />
            {formatNumber(listing.clickAnalytics?.totalClicks ?? 0)}
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Clicks</span>
        </div>
      </div>
      {listing.feedback?.length ? (
        <div className="border-t border-border/60 p-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Community feedback</p>
          <div className="mt-3 grid gap-3">
            {listing.feedback.slice(0, 5).map((review) => (
              <div key={review.id} className="rounded-lg border border-border/50 bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold">{review.author} <span className="font-normal text-muted-foreground">· {review.kind === "penalty" ? "Push Down" : "Boost"}</span></p>
                    <p className="mt-1 text-xs text-muted-foreground">{review.reason}</p>
                  </div>
                  <OwnerReplyDialog listingId={listing.id} review={review} />
                </div>
                {review.body && <p className="mt-2 font-mono text-xs leading-relaxed text-foreground/90">{review.body}</p>}
                {review.ownerReply && <p className="mt-2 rounded bg-primary/[0.06] px-2 py-1.5 text-xs text-primary">Your reply: {review.ownerReply.body}</p>}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OwnerReplyDialog({ listingId, review }: { listingId: string; review: Review }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(review.ownerReply?.body ?? "");
  const reply = useReplyToOwnedListingReview();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  async function submit() {
    if (!body.trim()) return;
    try {
      const updated = await reply.mutateAsync({ listingId, reviewId: review.id, data: { body: body.trim() } });
      queryClient.setQueryData<MemberListing[]>(getGetMyListingsQueryKey(), (current) =>
        current?.map((listing) =>
          listing.id !== listingId
            ? listing
            : {
                ...listing,
                feedback: listing.feedback.map((item) =>
                  item.id === review.id ? updated : item,
                ),
              },
        ),
      );
      setOpen(false);
      toast({ title: "Reply published", description: "Your response is now visible on the public product page." });
    } catch (error) {
      toast({ variant: "destructive", title: "Could not publish reply", description: error instanceof Error ? error.message : "Try again." });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-[10px]">{review.ownerReply ? "Edit reply" : "Reply"}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg border-border/60 bg-card">
        <DialogHeader>
          <DialogTitle>Reply as the owner</DialogTitle>
          <DialogDescription>Your response is public and does not modify or remove the original feedback.</DialogDescription>
        </DialogHeader>
        <Textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={1000} className="min-h-28" placeholder="Write a helpful public response…" />
        <Button onClick={() => void submit()} disabled={!body.trim() || reply.isPending}>{reply.isPending ? "Publishing…" : "Publish reply"}</Button>
      </DialogContent>
    </Dialog>
  );
}

type ProfileForm = Required<MemberProfileUpdate>;

function profileForm(profile: MemberProfile | undefined): ProfileForm {
  return {
    displayName: profile?.displayName ?? "",
    photoUrl: profile?.photoUrl ?? null,
    bio: profile?.bio ?? null,
    company: profile?.company ?? null,
    profileRole: profile?.profileRole ?? null,
    socialLinks: profile?.socialLinks ?? null,
    website: profile?.website ?? null,
    location: profile?.location ?? null,
  };
}

function ProfileEditDialog({ profile }: { profile: MemberProfile | undefined }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProfileForm>(() => profileForm(profile));
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateProfile = useUpdateMyProfile();

  useEffect(() => {
    if (open) {
      setForm(profileForm(profile));
    }
  }, [open, profile]);

  const handleSave = async () => {
    try {
      const updated = await updateProfile.mutateAsync({
        data: {
          displayName: form.displayName.trim(),
          photoUrl: form.photoUrl?.trim() || null,
          bio: form.bio?.trim() || null,
          company: form.company?.trim() || null,
          profileRole: form.profileRole?.trim() || null,
          socialLinks: form.socialLinks?.trim() || null,
          website: form.website?.trim() || null,
          location: form.location?.trim() || null,
        },
      });
      toast({ title: "Profile updated", description: "Your optional account details have been saved." });
      queryClient.setQueryData<MemberProfile>(getGetMyProfileQueryKey(), updated);
      setOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message || "Failed to update profile." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 rounded-md border-border/60 bg-card/60 text-xs font-bold uppercase tracking-wider hover:bg-muted" data-testid="button-edit-profile">
          <Settings className="w-3.5 h-3.5 mr-2" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md border-border/60 bg-card">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Edit Profile</DialogTitle>
          <DialogDescription className="text-xs font-mono">
            These owner details are optional and can be updated any time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Display Name</Label>
            <Input 
              value={form.displayName} 
              onChange={(e) => setForm({ ...form, displayName: e.target.value })} 
              className="font-mono text-sm bg-background border-border/60 h-10 rounded-md" 
              placeholder="Your name"
              data-testid="input-profile-display-name"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2"><Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Photo URL</Label><Input value={form.photoUrl ?? ""} onChange={(e) => setForm({ ...form, photoUrl: e.target.value })} placeholder="https://…" data-testid="input-profile-photo-url" /></label>
            <label className="space-y-2"><Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Location</Label><Input value={form.location ?? ""} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, country" data-testid="input-profile-location" /></label>
            <label className="space-y-2"><Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Company</Label><Input value={form.company ?? ""} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Company name" data-testid="input-profile-company" /></label>
            <label className="space-y-2"><Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Role</Label><Input value={form.profileRole ?? ""} onChange={(e) => setForm({ ...form, profileRole: e.target.value })} placeholder="Founder, designer…" data-testid="input-profile-role" /></label>
          </div>
          <label className="block space-y-2"><Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Website</Label><Input value={form.website ?? ""} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" data-testid="input-profile-website" /></label>
          <label className="block space-y-2"><Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Social links</Label><Input value={form.socialLinks ?? ""} onChange={(e) => setForm({ ...form, socialLinks: e.target.value })} placeholder="LinkedIn, X, or other links" data-testid="input-profile-social-links" /></label>
          <label className="block space-y-2"><Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bio</Label><Textarea value={form.bio ?? ""} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={1000} placeholder="A short introduction" data-testid="textarea-profile-bio" /></label>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t border-border/40">
          <Button variant="outline" onClick={() => setOpen(false)} className="h-9 rounded-md text-xs font-bold uppercase tracking-wider" data-testid="button-cancel-profile">Cancel</Button>
          <Button onClick={handleSave} disabled={updateProfile.isPending || !form.displayName.trim()} className="h-9 rounded-md bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider hover:bg-primary/90" data-testid="button-save-profile">
            {updateProfile.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ListingForm = Required<Pick<ListingUpdate, "name" | "tagline" | "description" | "category" | "websiteUrl" | "status" | "accent">> & {
  demoVideoUrl: string;
};

function listingForm(listing: MemberListing): ListingForm {
  return {
    name: listing.name,
    tagline: listing.tagline,
    description: listing.description,
    category: listing.category,
    websiteUrl: listing.websiteUrl,
    status: listing.status,
    accent: listing.accent,
    demoVideoUrl: listing.demoVideoUrl ?? "",
  };
}

function ListingEditDialog({ listing }: { listing: MemberListing }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateListing = useUpdateMyListing();

  const [formData, setFormData] = useState<ListingForm>(() => listingForm(listing));
  const [logoUrl, setLogoUrl] = useState<string | null>(listing.logoUrl);

  const initializedForId = useRef<string | null>(null);

  useEffect(() => {
    if (open && initializedForId.current !== listing.id) {
      initializedForId.current = listing.id;
      setFormData(listingForm(listing));
      setLogoUrl(listing.logoUrl);
    }
  }, [open, listing]);

  const handleSave = async () => {
    try {
      const updated = await updateListing.mutateAsync({
        id: listing.id,
        data: {
          name: formData.name,
          tagline: formData.tagline,
          description: formData.description,
          category: formData.category,
          websiteUrl: formData.websiteUrl?.trim() || null,
          status: formData.status,
          accent: formData.accent.trim(),
          demoVideoUrl: formData.demoVideoUrl.trim() || null,
        }
      });

      toast({ title: "Product updated", description: "Changes have been successfully saved." });

      queryClient.setQueryData<MemberListing[]>(getGetMyListingsQueryKey(), (current) =>
        current?.map((item) => item.id === listing.id ? updated : item),
      );

      setOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Update failed", description: err.message || "Could not save changes." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 flex-1 rounded-md border-border/60 bg-card/60 px-3 text-[10px] font-bold uppercase tracking-wider hover:bg-muted md:flex-none">
          <Edit2 className="w-3 h-3 mr-1.5" />
          Edit Product
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl border-border/60 bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <Edit2 className="w-5 h-5 text-primary" />
            Edit {listing.name}
          </DialogTitle>
          <DialogDescription className="text-xs font-mono">
            Update your product profile details.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <LogoUploadControl
            logoUrl={logoUrl}
            initials={listing.initials}
            accent={formData.accent}
            listingName={formData.name || listing.name}
            requestUploadUrl={(file) => requestMyListingLogoUploadUrl(listing.id, {
              name: file.name,
              size: file.size,
              contentType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml",
            })}
            saveLogoUrl={async (nextLogoUrl) => {
              const updated = await updateListing.mutateAsync({
                id: listing.id,
                data: { logoUrl: nextLogoUrl },
              });
              queryClient.setQueryData<MemberListing[]>(getGetMyListingsQueryKey(), (current) =>
                current?.map((item) => item.id === listing.id ? updated : item),
              );
            }}
            onSaved={(nextLogoUrl) => {
              setLogoUrl(nextLogoUrl);
              toast({
                title: nextLogoUrl ? "Logo uploaded" : "Logo removed",
                description: nextLogoUrl
                  ? "Your new logo is now shown across the site."
                  : "Your listing now uses its initials avatar.",
              });
            }}
          />
          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Product Name</Label>
            <Input 
              value={formData.name} 
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="font-mono text-sm bg-background border-border/60 h-10 rounded-md" 
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Category</Label>
              <Input 
                value={formData.category} 
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="font-mono text-sm bg-background border-border/60 h-10 rounded-md" 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Website URL</Label>
              <Input 
                value={formData.websiteUrl ?? ""}
                onChange={(e) => setFormData({ ...formData, websiteUrl: e.target.value })}
                className="font-mono text-sm bg-background border-border/60 h-10 rounded-md" 
                placeholder="https://"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tagline</Label>
            <Input 
              value={formData.tagline} 
              onChange={(e) => setFormData({ ...formData, tagline: e.target.value })}
              className="font-mono text-sm bg-background border-border/60 h-10 rounded-md" 
            />
          </div>
          
          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</Label>
            <Textarea 
              value={formData.description} 
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="font-mono text-sm bg-background border-border/60 min-h-32 rounded-md resize-none" 
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Demo Video URL (optional)</Label>
              {formData.demoVideoUrl && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, demoVideoUrl: "" })}
                  className="text-[10px] font-bold uppercase text-muted-foreground hover:text-destructive"
                  data-testid="button-clear-edit-demo-url"
                >
                  Clear
                </button>
              )}
            </div>
            <Input
              value={formData.demoVideoUrl}
              onChange={(e) => setFormData({ ...formData, demoVideoUrl: e.target.value })}
              className="font-mono text-sm bg-background border-border/60 h-10 rounded-md"
              placeholder="https://youtube.com/watch?v=... or https://vimeo.com/..."
              data-testid="input-edit-demo-url"
            />
            <p className="text-[10px] text-muted-foreground">A YouTube, Shorts, or Vimeo link shows a "Demo" button on your listing.</p>
          </div>

          <BrandColorPicker
            value={formData.accent}
            onChange={(next) => setFormData({ ...formData, accent: next })}
            testIdPrefix="edit-listing-accent"
          />

          <div className="space-y-2 pt-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</Label>
            <div className="flex gap-3">
              <Button 
                type="button"
                variant="outline" 
                className={cn("h-9 rounded flex-1 text-xs font-bold uppercase tracking-wider border-border/60", formData.status === "active" && "bg-primary/10 border-primary/30 text-primary")}
                onClick={() => setFormData({ ...formData, status: "active" })}
              >
                Active
              </Button>
              <Button 
                type="button"
                variant="outline" 
                className={cn("h-9 rounded flex-1 text-xs font-bold uppercase tracking-wider border-border/60", formData.status === "archived" && "bg-muted/50 border-muted-foreground/30 text-muted-foreground")}
                onClick={() => setFormData({ ...formData, status: "archived" })}
              >
                Archived
              </Button>
            </div>
          </div>
        </div>
        
        <div className="flex justify-end gap-3 pt-4 border-t border-border/40">
          <Button variant="outline" onClick={() => setOpen(false)} className="h-9 rounded-md text-xs font-bold uppercase tracking-wider">Cancel</Button>
          <Button onClick={handleSave} disabled={updateListing.isPending || !formData.name || !isValidHexColor(formData.accent)} className="h-9 rounded-md bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider hover:bg-primary/90">
            {updateListing.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteListingDialog({ listing }: { listing: MemberListing }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const archiveListing = useArchiveMyListing();

  const isInCampaign = listing.status === "active" && listing.rank > 0;

  const handleDelete = async () => {
    try {
      await archiveListing.mutateAsync({ id: listing.id });
      queryClient.setQueryData<MemberListing[]>(getGetMyListingsQueryKey(), (current) =>
        current?.map((item) => item.id === listing.id ? { ...item, status: "archived" } : item),
      );
      toast({ title: "Product deleted", description: `${listing.name} has been removed from the ledger.` });
      setOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Delete failed", description: err.message || "Could not delete this product." });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 flex-1 rounded-md border-destructive/40 bg-card/60 px-3 text-[10px] font-bold uppercase tracking-wider text-destructive hover:bg-destructive/10 md:flex-none"
          data-testid={`button-delete-listing-${listing.id}`}
        >
          <Trash2 className="w-3 h-3 mr-1.5" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-border/60 bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Trash2 className="h-5 w-5 text-destructive" />
            Delete {listing.name}?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs font-mono">
            This removes the product from the public ledger and can't be undone from here. If you need it back, you'll have to re-claim it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {isInCampaign && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.08] p-3 text-xs text-destructive" data-testid="alert-listing-in-campaign">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-bold">Heads up:</span> {listing.name} is currently ranked #{listing.rank} in this week's active campaign. Deleting it now forfeits its spot and any owner bid or community support already applied — none of it will be refunded.
            </p>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete-listing">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
            disabled={archiveListing.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-delete-listing"
          >
            {archiveListing.isPending ? "Deleting…" : "Yes, delete it"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { useParams, Link, useSearch } from "wouter";
import { useGetListing, getGetListingQueryKey, type ListingDetailOwner } from "@workspace/api-client-react";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SignalActionForm } from "@/components/signal-action-form";
import { DemoButton, DemoViewCount } from "@/components/demo-video";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ListingAvatar } from "@/components/listing-avatar";
import { 
  ArrowLeft,
  ArrowUpRight,
  TrendingDown,
  Activity,
  ShieldAlert,
  Star,
  Clock,
  ExternalLink,
  Flag,
  Info,
  Share2,
  Search,
  Zap,
  ThumbsUp,
  Loader2,
  MapPin,
  Globe,
  Link2,
  Briefcase,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { createPublicReport, createPublicReview, getCurrentCampaign, type CurrentCampaign, votePublicReview } from "@/lib/public-api";
import { clearPendingCheckout, isPendingCheckoutForCampaign, loadPendingCheckout, type PendingCheckoutState, type PendingCheckoutType } from "@/lib/pending-checkout";
import { initialsFromName, normalizedHref, socialLinkTokens } from "@/lib/profile-display";
import { usePaymentEnvironment } from "@/hooks/use-payment-environment";

/**
 * Reads a stored pending checkout and only returns it when it still targets
 * the live campaign. A stale entry (ended/rolled-over campaign, or one saved
 * before campaign context existed) is cleared outright rather than shown as
 * a resumable banner. Returns null while the campaign hasn't loaded yet, so
 * we never guess at resumability without knowing the current campaign.
 */
function readValidPendingCheckout(
  slug: string,
  type: PendingCheckoutType,
  campaign: CurrentCampaign | undefined,
): PendingCheckoutState | null {
  const state = loadPendingCheckout(slug, type);
  if (!state) return null;
  if (!campaign) return null;
  if (!isPendingCheckoutForCampaign(state, campaign)) {
    clearPendingCheckout(slug, type);
    return null;
  }
  return state;
}

export default function ListingDetail() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearch();
  const [supportOpen, setSupportOpen] = useState(false);
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<"all" | "support" | "penalty">("all");
  const { toast } = useToast();
  const [reviewCheckout, setReviewCheckout] = useState<{ paymentId: string; type: "support" | "penalty"; listingName: string } | null>(null);
  const [pendingSupport, setPendingSupport] = useState<PendingCheckoutState | null>(null);
  const [pendingPenalty, setPendingPenalty] = useState<PendingCheckoutState | null>(null);
  const { isLive } = usePaymentEnvironment();

  const { data: listing, isLoading, error } = useGetListing(slug, {
    query: {
      enabled: !!slug,
      queryKey: getGetListingQueryKey(slug)
    }
  });
  const { data: campaign } = useQuery({
    queryKey: ["current-campaign"],
    queryFn: getCurrentCampaign,
    staleTime: 30_000,
  });

  useEffect(() => {
    const action = new URLSearchParams(search).get("action");
    if (action === "support") setSupportOpen(true);
    if (action === "penalty") setPenaltyOpen(true);
  }, [search]);

  useEffect(() => {
    if (!slug || !campaign) return;
    setPendingSupport(readValidPendingCheckout(slug, "support", campaign));
    setPendingPenalty(readValidPendingCheckout(slug, "penalize", campaign));
  }, [slug, campaign]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl animate-pulse">
        <div className="h-4 w-24 bg-muted rounded mb-6"></div>
        <div className="bg-card border border-border/50 rounded-xl p-6 mb-6">
          <div className="flex gap-6 items-start">
            <div className="w-20 h-20 bg-muted rounded-xl"></div>
            <div className="flex-1 space-y-3">
              <div className="h-6 bg-muted rounded w-1/4"></div>
              <div className="h-4 bg-muted rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="container mx-auto px-4 py-24 text-center max-w-lg">
        <div className="w-16 h-16 bg-muted/50 rounded-lg flex items-center justify-center mx-auto mb-6 border border-border/50">
          <Search className="w-8 h-8 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold mb-2 text-foreground uppercase tracking-wider">Signal Not Found</h1>
        <p className="text-sm font-mono text-muted-foreground mb-6">
          The requested profile could not be located on the public ledger.
        </p>
        <Button asChild size="sm" className="rounded-md px-6 bg-primary text-primary-foreground">
          <Link href="/">Return to Ledger</Link>
        </Button>
      </div>
    );
  }

  const listingToShare = listing;
  const visibleReviews = listing.reviews?.filter((review) => reviewFilter === "all" || review.kind === reviewFilter) ?? [];

  async function shareListing() {
    try {
      if (navigator.share) {
        await navigator.share({ title: listingToShare.name, text: listingToShare.tagline, url: window.location.href });
        return;
      }
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "Link copied", description: "The product profile link is ready to share." });
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      toast({ variant: "destructive", title: "Could not share", description: "Try copying the page URL from your browser." });
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors group" data-testid="link-back">
          <ArrowLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          Back to Ledger
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 rounded-md border-border/60 bg-card/60 px-2.5 text-[10px] font-bold uppercase tracking-wider hover:bg-muted" onClick={shareListing} data-testid="button-share-listing">
            <Share2 className="mr-1.5 h-3 w-3" /> Share
          </Button>
          <ReportDialog targetId={listing.id} targetType="listing" targetName={listing.name}>
            <Button variant="outline" size="sm" className="h-8 rounded-md border-border/60 bg-card/60 px-2.5 text-[10px] font-bold uppercase tracking-wider text-destructive hover:bg-destructive/10" data-testid="button-report-listing">
              <Flag className="mr-1.5 h-3 w-3" /> Report
            </Button>
          </ReportDialog>
        </div>
      </div>
      {campaign && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Campaign #{campaign.number}</p>
            <p className="mt-1 text-xs text-muted-foreground">This product&apos;s claim, boosts, push downs, reviews, and rank are scoped to the active weekly campaign.</p>
          </div>
          <span className="font-mono text-xs font-bold text-foreground">{formatCurrency(campaign.minimumBid)} minimum</span>
        </div>
      )}

      {/* Profile Header */}
      <div className="bg-card border border-border/60 rounded-xl p-6 md:p-8 mb-6 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none -z-10 -translate-y-1/2 translate-x-1/3"></div>

        <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
          <div className="relative shrink-0">
            <ListingAvatar
              logoUrl={listing.logoUrl}
              initials={listing.initials}
              accent={listing.accent}
              alt={listing.name}
              className="w-20 h-20 shadow-sm md:w-24 md:h-24 text-3xl"
            />
            <div className="absolute -bottom-2 -right-2 bg-background text-foreground w-8 h-8 rounded border border-border/50 flex items-center justify-center shadow-sm font-mono font-bold text-xs" title={`Rank #${listing.rank}`}>
              #{listing.rank}
            </div>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono rounded bg-muted/30 border-border/50 px-2 py-0.5 text-muted-foreground">
                {listing.category}
              </Badge>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-mono rounded bg-primary/10 border-primary/20 px-2 py-0.5 text-primary">
                Active Node
              </Badge>
            </div>
            
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground mb-1">
              {listing.name}
            </h1>
            
            <p className="text-sm font-mono text-muted-foreground max-w-2xl truncate">
              {listing.tagline}
            </p>
          </div>

          <div className="w-full md:w-auto md:ml-auto flex flex-col md:items-end border-t border-border/30 md:border-t-0 pt-4 md:pt-0 shrink-0">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Ranking Power</span>
            <span className="font-mono text-3xl md:text-4xl font-bold text-foreground mb-2">{formatCurrency(listing.effectiveBid)}</span>
            
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono">
              <div className="flex items-center gap-1.5 text-muted-foreground" title="Owner Claim">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50"></div>
                <span>{formatCurrency(listing.ownerBid)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-secondary" title="Community Boosts">
                <div className="w-1.5 h-1.5 rounded-full bg-secondary"></div>
                <span>+{formatCurrency(listing.communitySupport)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-destructive" title="Push Downs">
                <div className="w-1.5 h-1.5 rounded-full bg-destructive"></div>
                <span>-{formatCurrency(listing.penalties)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70",
          listing.demoVideoUrl ? "sm:grid-cols-6" : "sm:grid-cols-5",
        )}
        aria-label="Product community statistics"
      >
        {[
          { label: "Boosts", value: listing.supporters, color: "text-secondary", id: "supporters" },
          { label: "Push Downs", value: listing.penalizers, color: "text-destructive", id: "penalizers" },
          { label: "Reviews", value: listing.reviewCount, color: "text-primary", id: "reviews" },
          { label: "Rating", value: `${listing.rating.toFixed(1)}/5`, color: "text-foreground", id: "rating" },
          { label: "Website Clicks", value: formatNumber(listing.clickAnalytics?.totalClicks ?? 0), color: "text-foreground", id: "clicks" },
          ...(listing.demoVideoUrl
            ? [{ label: "Demo Views", value: formatNumber(listing.demoViewCount ?? 0), color: "text-foreground", id: "demo-views" }]
            : []),
        ].map((metric) => (
          <div className="bg-card/80 p-3 text-center" key={metric.id} data-testid={`listing-stat-${metric.id}`}>
            <div className={cn("font-mono text-base font-bold", metric.color)}>{metric.value}</div>
            <div className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{metric.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-8 space-y-6">
            <div className="bg-card border border-border/60 rounded-xl p-6 text-sm font-mono text-muted-foreground leading-relaxed">
            <p>{listing.description}</p>
              {(listing.websiteUrl || listing.demoVideoUrl) && (
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  {listing.websiteUrl && (
                    <Button asChild variant="outline" size="sm" className="h-8 text-xs font-mono rounded bg-muted/30 border-border/50 gap-2 hover:bg-muted/50">
                      <a
                        href={listing.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="link-visit-website"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Visit Website
                      </a>
                    </Button>
                  )}
                  {listing.demoVideoUrl && (
                    <DemoButton listingId={listing.id} demoVideoUrl={listing.demoVideoUrl} />
                  )}
                  {listing.demoVideoUrl && (
                    <DemoViewCount demoVideoUrl={listing.demoVideoUrl} demoViewCount={listing.demoViewCount} />
                  )}
                </div>
              )}
          </div>

          <OwnerProfileCard owner={listing.owner} />

          <Tabs defaultValue="signals" className="w-full">
            <TabsList className="w-full justify-start border-b border-border/40 rounded-none bg-transparent h-auto p-0 gap-6 mb-6">
              <TabsTrigger 
                value="signals" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground px-1 py-2 text-sm font-bold uppercase tracking-wider transition-colors"
                data-testid="tab-signals"
              >
                Community Activity
              </TabsTrigger>
              <TabsTrigger 
                value="ledger" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground px-1 py-2 text-sm font-bold uppercase tracking-wider transition-colors"
                data-testid="tab-ledger"
              >
                Ledger Data
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="signals" className="space-y-4 outline-none">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-1 rounded-md border border-border/50 bg-muted/20 p-1" role="tablist" aria-label="Review type">
                  {[
                    { value: "all" as const, label: "All reviews", id: "tab-all-reviews" },
                    { value: "support" as const, label: "Boost reviews", id: "tab-support-reviews" },
                    { value: "penalty" as const, label: "Push Down reviews", id: "tab-penalty-reviews" },
                  ].map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      role="tab"
                      aria-selected={reviewFilter === tab.value}
                      className={cn("rounded px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground transition-colors", reviewFilter === tab.value && "bg-primary text-primary-foreground")}
                      onClick={() => setReviewFilter(tab.value)}
                      data-testid={tab.id}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold bg-muted/30 px-2 py-1 rounded border border-border/50">
                  <Star className="w-3 h-3 text-primary fill-primary/20" />
                  <span className="text-foreground">{listing.rating.toFixed(1)}</span>
                  <span className="text-muted-foreground">AVG RATING</span>
                </div>
              </div>
              {listing.pushDownReasonCounts?.length ? (
                <section className="rounded-lg border border-destructive/20 bg-destructive/[0.04] p-3" aria-label="Push Down reason summary">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-destructive">Push Down reasons</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {listing.pushDownReasonCounts.map((item) => (
                      <span key={item.reason} className="rounded-full border border-destructive/20 bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                        {item.reason} <strong className="ml-1 text-destructive">{item.count}</strong>
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {visibleReviews.length ? (
                <div className="grid gap-3">
                  {visibleReviews.map((review) => (
                    <div key={review.id} className="bg-card border border-border/50 rounded-lg p-4 transition-colors hover:border-border/80" data-testid={`review-${review.id}`}>
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-muted/50 flex items-center justify-center font-bold text-xs text-foreground border border-border/50 font-mono uppercase">
                            {review.author.substring(0, 2)}
                          </div>
                          <div>
                            <div className="font-bold text-sm text-foreground flex items-center gap-2">
                              {review.author}
                              {review.kind === 'support' ? (
                                <span className="px-1.5 py-0.5 text-[9px] rounded font-mono uppercase tracking-wider bg-secondary/10 text-secondary border border-secondary/20">Booster</span>
                              ) : (
                                <span className="px-1.5 py-0.5 text-[9px] rounded font-mono uppercase tracking-wider bg-destructive/10 text-destructive border border-destructive/20">Push Down</span>
                              )}
                            </div>
                            <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Clock className="w-3 h-3" />
                              {new Date(review.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5">
                          {Array(5).fill(0).map((_, i) => (
                            <Star 
                              key={i} 
                              className={cn(
                                "w-3 h-3",
                                i < review.rating ? "text-primary fill-primary/30" : "text-muted-foreground/30"
                              )} 
                            />
                          ))}
                        </div>
                      </div>
                      
                      {review.reason && (
                        <div className="bg-muted/20 p-2.5 rounded-md border border-border/40 text-[11px] font-mono mb-3">
                          <span className="font-bold text-foreground mr-2">CONTEXT:</span>
                          <span className="text-muted-foreground">{review.reason}</span>
                        </div>
                      )}
                      
                      <p className="text-foreground/90 font-mono text-xs leading-relaxed mb-4">{review.body}</p>
                       {review.ownerReply && (
                         <div className="mb-4 rounded-md border border-primary/20 bg-primary/[0.05] p-3 text-xs">
                           <p className="font-bold text-primary">Owner response <span className="font-normal text-muted-foreground">from {review.ownerReply.author}</span></p>
                           <p className="mt-1 font-mono leading-relaxed text-foreground/90">{review.ownerReply.body}</p>
                           <p className="mt-1 text-[10px] text-muted-foreground">{new Date(review.ownerReply.createdAt).toLocaleDateString()}</p>
                         </div>
                       )}
                      
                      <div className="flex items-center justify-between border-t border-border/40 pt-3">
                        <ReviewVoteButton reviewId={review.id} initialCount={(review as unknown as { helpfulCount?: number }).helpfulCount ?? 0} slug={listing.slug} />
                        <ReportDialog targetId={review.id} targetType="review" targetName={`review by ${review.author}`}>
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-destructive">
                            <Flag className="w-3 h-3 mr-1.5" /> Report
                          </Button>
                        </ReportDialog>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border border-border/50 border-dashed rounded-lg p-12 text-center bg-card/30 flex flex-col items-center justify-center">
                  <Activity className="w-6 h-6 text-muted-foreground/50 mb-3" />
                   <h3 className="text-sm font-bold mb-1 text-foreground">No community activity yet</h3>
                   <p className="text-[11px] font-mono text-muted-foreground">Be the first to boost or push down this product.</p>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="ledger" className="outline-none">
              <div className="bg-card border border-border/50 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-muted/30 border-b border-border/50">
                      <tr>
                        <th className="p-3 font-bold uppercase tracking-wider text-muted-foreground">Date</th>
                        <th className="p-3 font-bold uppercase tracking-wider text-muted-foreground">Type</th>
                        <th className="p-3 font-bold uppercase tracking-wider text-muted-foreground text-right">Amount</th>
                        <th className="p-3 font-bold uppercase tracking-wider text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {listing.transactions?.map((tx) => (
                        <tr key={tx.id} className="hover:bg-muted/20 transition-colors" data-testid={`transaction-${tx.id}`}>
                          <td className="p-3 text-muted-foreground">
                            {new Date(tx.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-3">
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider border",
                                tx.type === 'OWNER_BID' && "bg-primary/10 text-primary border-primary/20",
                                tx.type === 'COMMUNITY_BID' && "bg-secondary/10 text-secondary border-secondary/20",
                                tx.type === 'PENALTY' && "bg-destructive/10 text-destructive border-destructive/20"
                              )}
                            >
                              {tx.type === "OWNER_BID" ? "CLAIM" : tx.type === "COMMUNITY_BID" ? "BOOST" : "PUSH DOWN"}
                            </span>
                          </td>
                          <td className={cn(
                            "p-3 text-right font-bold",
                            tx.type === 'PENALTY' ? "text-destructive" : "text-foreground"
                          )}>
                            {tx.type === 'PENALTY' ? '-' : '+'}{formatCurrency(tx.amount)}
                          </td>
                          <td className="p-3">
                            <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary/70"></span>
                              {tx.status.replace('_', ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {!listing.transactions?.length && (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-muted-foreground">
                            No ledger data recorded.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Action Sidebar */}
        <div className="order-first space-y-4 lg:order-last lg:col-span-4">
          <div className="bg-card border border-border/60 rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-4 flex items-center gap-2 border-b border-border/40 pb-2">
              <Zap className="w-3.5 h-3.5 text-primary" />
              Submit Signal
            </h3>
            
            {(pendingSupport || pendingPenalty) && (
              <div className="mb-4 space-y-2">
                {pendingSupport && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-secondary/50 bg-secondary/10 p-3 text-xs" data-testid="banner-resume-support">
                    <div>
                      <p className="font-bold uppercase tracking-wider text-secondary">Pending boost checkout</p>
                      <p className="mt-0.5 text-muted-foreground">A {formatCurrency(pendingSupport.amount)} boost was interrupted. Resume to finish it safely.</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => setSupportOpen(true)} data-testid="button-resume-support">Resume</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => { clearPendingCheckout(slug, "support"); setPendingSupport(null); }} data-testid="button-discard-support">Discard</Button>
                    </div>
                  </div>
                )}
                {pendingPenalty && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-destructive/50 bg-destructive/10 p-3 text-xs" data-testid="banner-resume-penalize">
                    <div>
                      <p className="font-bold uppercase tracking-wider text-destructive">Pending push down checkout</p>
                      <p className="mt-0.5 text-muted-foreground">A {formatCurrency(pendingPenalty.amount)} push down was interrupted. Resume to finish it safely.</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" size="sm" variant="destructive" onClick={() => setPenaltyOpen(true)} data-testid="button-resume-penalize">Resume</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => { clearPendingCheckout(slug, "penalize"); setPendingPenalty(null); }} data-testid="button-discard-penalize">Discard</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-3">
              <Dialog
                open={supportOpen}
                onOpenChange={(open) => {
                  setSupportOpen(open);
                  if (!open) setPendingSupport(readValidPendingCheckout(slug, "support", campaign));
                }}
              >
                <DialogTrigger asChild>
                  <Button aria-label={`Boost ${listing.name}`} className="w-full h-12 rounded bg-secondary text-sm font-bold uppercase tracking-wider text-secondary-foreground transition-colors hover:bg-secondary/90" data-testid="button-trigger-support">
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                    BOOST
                  </Button>
                </DialogTrigger>
                <DialogContent className="rounded-xl sm:max-w-md border-border/60 bg-card">
                  <DialogHeader className="mb-4">
                    <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                      <ArrowUpRight className="text-secondary w-5 h-5" />
                      Help {listing.name} rise
                    </DialogTitle>
                    <DialogDescription className="text-xs font-mono mt-1">
                      Choose an amount to boost this product&apos;s ranking.
                    </DialogDescription>
                  </DialogHeader>
                  <SignalActionForm slug={listing.slug} type="support" effectiveBid={listing.effectiveBid} onSuccess={(result) => {
                    setSupportOpen(false);
                    setReviewCheckout({ paymentId: result.paymentId, type: result.type, listingName: listing.name });
                  }} />
                </DialogContent>
              </Dialog>

              <Dialog
                open={penaltyOpen}
                onOpenChange={(open) => {
                  setPenaltyOpen(open);
                  if (!open) setPendingPenalty(readValidPendingCheckout(slug, "penalize", campaign));
                }}
              >
                <DialogTrigger asChild>
                  <Button aria-label={`Push ${listing.name} down`} className="w-full h-12 rounded border-destructive/30 bg-destructive/10 text-sm font-bold uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/20" variant="outline" data-testid="button-trigger-penalize">
                    <ShieldAlert className="mr-2 h-4 w-4" />
                    PUSH DOWN
                  </Button>
                </DialogTrigger>
                <DialogContent className="rounded-xl sm:max-w-md border-border/60 bg-card">
                  <DialogHeader className="mb-4">
                    <DialogTitle className="flex items-center gap-2 text-lg font-bold text-destructive">
                      <TrendingDown className="w-5 h-5" />
                      Push {listing.name} down
                    </DialogTitle>
                    <DialogDescription className="text-xs font-mono mt-1">
                      Choose an amount to reduce this product&apos;s ranking power.
                    </DialogDescription>
                  </DialogHeader>
                  <SignalActionForm slug={listing.slug} type="penalize" effectiveBid={listing.effectiveBid} onSuccess={(result) => {
                    setPenaltyOpen(false);
                    setReviewCheckout({ paymentId: result.paymentId, type: result.type, listingName: listing.name });
                  }} />
                </DialogContent>
              </Dialog>
            </div>

            <div className="mt-4 bg-primary/5 p-3 rounded border border-primary/10 text-[10px] font-mono text-muted-foreground text-center leading-relaxed">
              {isLive ? "Signals are real PayPal payments." : "Signals operate in Sandbox Mode. Simulated funds."}
            </div>
          </div>
          <section className="rounded-xl border border-border/60 bg-card/70 p-4" aria-label={`About ${listing.name}`}>
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">About {listing.name}</h3>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{listing.description}</p>
            <dl className="mt-4 grid grid-cols-2 gap-y-2 border-t border-border/40 pt-3 font-mono text-[10px]">
              <div>
                <dt className="text-muted-foreground">Category</dt>
                <dd className="mt-0.5 font-bold text-foreground">{listing.category}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Listed</dt>
                <dd className="mt-0.5 font-bold text-foreground">{new Date(listing.createdAt).toLocaleDateString()}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
      <ReviewPrompt checkout={reviewCheckout} onClose={() => setReviewCheckout(null)} slug={listing.slug} />
    </div>
  );
}

/** Public-facing counterpart of owner-dashboard's ProfileSummaryCard: shows
 * the same optional profile fields (name, role/company, location, bio,
 * website, social links) for buyers and visitors, but read-only and with
 * no fallback prompt when the owner hasn't filled anything in -- an
 * unclaimed listing or a bare profile simply renders nothing here. */
function OwnerProfileCard({ owner }: { owner: ListingDetailOwner | undefined }) {
  const socialTokens = useMemo(
    () => (owner?.socialLinks?.trim() ? socialLinkTokens(owner.socialLinks.trim()) : []),
    [owner?.socialLinks],
  );

  if (!owner) return null;

  const displayName = owner.displayName?.trim();
  const roleAndCompany = [owner.profileRole?.trim(), owner.company?.trim()].filter(Boolean).join(" at ");
  const hasAnyDetail = Boolean(
    displayName || roleAndCompany || owner.bio?.trim() || owner.location?.trim() || owner.website?.trim() || socialTokens.length,
  );
  if (!hasAnyDetail) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm" data-testid="owner-profile-card">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:gap-5">
        <Avatar className="h-14 w-14 shrink-0 rounded-xl border border-border/50 bg-primary/5 text-primary sm:h-16 sm:w-16">
          {owner.photoUrl ? <AvatarImage src={owner.photoUrl} alt={displayName || "Owner"} className="object-cover" /> : null}
          <AvatarFallback className="rounded-xl bg-primary/10 text-base font-bold text-primary sm:text-lg">
            {initialsFromName(displayName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Product owner</p>
          {displayName && (
            <h3 className="mt-0.5 truncate text-base font-bold tracking-tight text-foreground sm:text-lg" data-testid="text-owner-display-name">
              {displayName}
            </h3>
          )}
          {roleAndCompany && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
              <Briefcase className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{roleAndCompany}</span>
            </p>
          )}

          {owner.bio?.trim() && (
            <p className="mt-3 text-sm leading-relaxed text-foreground/90">{owner.bio.trim()}</p>
          )}

          {(owner.location?.trim() || owner.website?.trim() || socialTokens.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-mono text-muted-foreground">
              {owner.location?.trim() && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {owner.location.trim()}
                </span>
              )}
              {owner.website?.trim() && (
                <a
                  href={normalizedHref(owner.website.trim())}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-primary hover:underline"
                  data-testid="link-owner-website"
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-[14rem] truncate">{owner.website.trim()}</span>
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
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewVoteButton({ reviewId, initialCount, slug }: { reviewId: string, initialCount: number, slug: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [voted, setVoted] = useState(false);
  const [pending, setPending] = useState(false);

  const handleVote = async () => {
    setPending(true);
    try {
      await votePublicReview(reviewId, voted);
      setVoted(!voted);
      await queryClient.invalidateQueries({ queryKey: getGetListingQueryKey(slug) });
      toast({ title: voted ? "Vote removed" : "Vote recorded", description: "Thanks for helping the community." });
    } catch (error) {
      toast({ variant: "destructive", title: "Vote failed", description: error instanceof Error ? error.message : "Could not update your vote." });
    } finally {
      setPending(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="h-7 text-[10px] font-bold uppercase tracking-wider border-border/60 bg-muted/10 hover:bg-muted/30" onClick={handleVote} disabled={pending}>
      <ThumbsUp className="w-3 h-3 mr-1.5" />
      {voted ? "Helpful — undo" : `Helpful (${initialCount})`}
    </Button>
  );
}
function ReportDialog({ targetId, targetType, targetName, children }: { targetId: string, targetType: "listing" | "review", targetName: string, children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return;
    setPending(true);
    try {
      await createPublicReport({
        targetId,
        targetType,
        reason,
        details: details || undefined,
      });
      toast({ title: "Report submitted", description: "Our moderation team will review this shortly." });
      setOpen(false);
      setReason("");
      setDetails("");
    } catch (error) {
      toast({ variant: "destructive", title: "Report failed", description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md border-border/60 bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="w-4 h-4 text-destructive" />
            Report {targetName}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Help keep the sandbox network safe by reporting violations.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-foreground">Reason</label>
            <select 
              value={reason} 
              onChange={(e) => setReason(e.target.value)}
              className="w-full h-10 px-3 py-2 rounded-md font-mono text-sm bg-muted/20 border border-border/60"
              required
            >
              <option value="" disabled>Select a reason...</option>
              <option value="spam">Spam or misleading</option>
              <option value="inappropriate">Inappropriate content</option>
              <option value="manipulation">Vote manipulation</option>
              <option value="other">Other violation</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-foreground">Additional Details</label>
            <Textarea 
              value={details} 
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Provide more context..."
              className="font-mono bg-muted/20 border-border/60"
              maxLength={1000}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="text-xs font-bold uppercase tracking-wider border-border/60">Cancel</Button>
            <Button type="submit" disabled={pending || !reason} className="bg-destructive text-destructive-foreground text-xs font-bold uppercase tracking-wider">
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit Report"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewPrompt({ checkout, onClose, slug }: { checkout: { paymentId: string; type: "support" | "penalty"; listingName: string } | null; onClose: () => void; slug: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [anonymous, setAnonymous] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [reason, setReason] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const choices = checkout?.type === "support"
    ? ["Great product", "Great idea", "Useful", "Deserves more visibility", "Supporting the founder", "Better than alternatives", "Other"]
    : ["Poor quality", "Too expensive", "Bugs", "Misleading", "Doesn't deserve current position", "Supporting another product", "Rule violation", "Other"];

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!checkout || !reason || pending) return;
    setPending(true);
    try {
      await createPublicReview(checkout.paymentId, { anonymous, displayName: anonymous ? undefined : displayName, rating: 5, reason, body });
      await queryClient.invalidateQueries({ queryKey: getGetListingQueryKey(slug) });
      toast({ title: "Review published", description: "Your email stays private." });
      onClose();
    } catch (error) {
      toast({ variant: "destructive", title: "Could not publish review", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={Boolean(checkout)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md border-border/60 bg-card">
        <DialogHeader>
          <DialogTitle>{checkout?.type === "support" ? "Boost recorded." : "Push Down recorded."}</DialogTitle>
          <DialogDescription className="font-mono text-xs">Want to tell people why? A review is optional and never exposes your email.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={publish}>
          <label className="block space-y-2"><span className="text-xs font-bold uppercase tracking-wider">Reason</span>
            <select required value={reason} onChange={(event) => setReason(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="" disabled>Select a reason</option>
              {choices.map((choice) => <option key={choice}>{choice}</option>)}
            </select>
          </label>
          <label className="block space-y-2"><span className="text-xs font-bold uppercase tracking-wider">Optional text</span><Textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={1000} placeholder="Tell the community why…" /></label>
          <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> Publish as Anonymous Booster</label>
          {!anonymous && <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={80} placeholder="Your display name" required />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Skip</Button>
            <Button type="submit" className="flex-1" disabled={pending || !reason}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publish review"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
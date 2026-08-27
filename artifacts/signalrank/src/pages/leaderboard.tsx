import { Link, useLocation } from "wouter";
import { useGetListings, useGetActivity } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { getActiveSponsorships, getCurrentCampaign, getPublicAnalytics, getTop4Board, type CurrentCampaign, type Top4Board } from "@/lib/public-api";
import { usePaymentEnvironment } from "@/hooks/use-payment-environment";
import { ListingAvatar } from "@/components/listing-avatar";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bitcoin,
  Bot,
  BriefcaseBusiness,
  Clock3,
  Code2,
  Compass,
  FileText,
  Gamepad2,
  Globe2,
  GraduationCap,
  Grid2X2,
  Handshake,
  HeartPulse,
  House,
  Landmark,
  Megaphone,
  Mic2,
  Newspaper,
  Palette,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  ShieldAlert,
  Star,
  Trophy,
  TrendingDown,
  TrendingUp,
  Zap,
  Eye,
  DollarSign,
  User,
  Users,
  Info,
  CheckCircle2,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_ALIASES, CATEGORY_GROUPS, CATEGORY_OPTIONS } from "@/lib/category-taxonomy";
import { CampaignBidModule } from "@/components/campaign-bid-module";
import { getDisplayDomain, getListingClickHref } from "@/lib/listing-links";
import { DemoButton, DemoViewCount } from "@/components/demo-video";
import { FeaturedSpotlightPopup } from "@/components/featured-spotlight-popup";
import { SponsorshipPopup } from "@/components/sponsorship-popup";
import { SponsorshipSection } from "@/components/sponsorship-section";
import { SponsorshipBadge } from "@/components/sponsorship-badge";
import { CampaignCountdown } from "@/components/campaign-countdown";
import { ListingRankCard } from "@/components/listing-rank-card";

function matchesCategory(currentCategory: string, selectedCategory: string) {
  if (selectedCategory === "All categories") return true;
  const current = currentCategory.toLowerCase();
  return (CATEGORY_ALIASES[selectedCategory] ?? [selectedCategory.toLowerCase()])
    .some((alias) => current.includes(alias));
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "SEO & AI Visibility": Sparkles,
  "AI Agents & Infrastructure": Bot,
  "AI Media Generation": Sparkles,
  "Marketing & Advertising": Megaphone,
  "Developer Tools": Code2,
  "Productivity & Personal Tools": Grid2X2,
  "Design & Creative": Palette,
  "Social Media & Creator Tools": Handshake,
  "Writing & Content": FileText,
  "Sales & Lead Generation": TrendingUp,
  "Business, Finance & Legal": Landmark,
  "Games & Entertainment": Gamepad2,
  "Education & Learning": GraduationCap,
  "Health, Fitness & Wellness": HeartPulse,
  "Ecommerce & Retail": ShoppingBag,
  "Directories, Launch & Discovery": Compass,
  "Hiring, Jobs & Careers": BriefcaseBusiness,
  "Audio, Voice & Podcasting": Mic2,
  "Crypto, Web3 & Investing": Bitcoin,
  "Agencies, Studios & Services": Handshake,
  "Security, Privacy & Compliance": ShieldCheck,
  "Travel, Local & Lifestyle": Compass,
  "Media & News": Newspaper,
  "Domains & Web Assets": Globe2,
  "Leaderboards & Attention Markets": Trophy,
  "Real Estate & Property": House,
  Other: Grid2X2,
};

function relativeTime(date: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Purely decorative rank-tier styling for the TOP 4 cards — not derived from
// data, just a visual hierarchy so #1 reads as gold, #2 as silver, etc.
const RANK_TIERS = [
  {
    label: "Top Position",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    trophy: "text-amber-500",
    pill: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  {
    label: "High Visibility",
    badge: "bg-slate-200 text-slate-600 dark:bg-slate-500/25 dark:text-slate-300",
    trophy: "text-slate-400",
    pill: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
  },
  {
    label: "Great Visibility",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
    trophy: "text-orange-400",
    pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  {
    label: "Good Visibility",
    badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
    trophy: "text-indigo-400",
    pill: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  },
];

function scrollToFullRankings() {
  document.getElementById("rankings")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Top4Section({ board, campaign, sponsoredListingIds }: { board: Top4Board | undefined; campaign: CurrentCampaign | undefined; sponsoredListingIds: Set<string> }) {
  const [, setLocation] = useLocation();
  if (!board) {
    return (
      <section className="mb-5 rounded-xl border border-border/70 bg-card/60 p-4" aria-label="Top 4">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          <Trophy className="h-3.5 w-3.5" /> Top 4
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-lg border border-border/40 bg-muted/30" />
          ))}
        </div>
      </section>
    );
  }

  const isFinal = board.mode === "final";
  // Before any campaign has ever completed, these are simply the current
  // live rankings — calling them "winners" would be premature. Only once a
  // campaign has actually finished do the frozen top 4 become winners.
  const heading = isFinal ? "Current campaign winners" : "Top 4 rankings";
  const subtext = isFinal
    ? `These top 4 won Campaign #${board.campaignNumber} and stay featured until the next campaign closes.`
    : "These are the current top 4 listings in this week's live campaign.";
  const accentText = isFinal ? "text-amber-700 dark:text-amber-300" : "text-primary";
  const accentBorder = isFinal ? "border-amber-500/30 bg-amber-500/[0.06]" : "border-primary/25 bg-primary/5";

  if (board.entries.length === 0) {
    return (
      <section
        className={cn("mb-5 rounded-xl border p-4", accentBorder)}
        aria-label={heading}
        data-testid="section-top4"
        data-top4-mode={board.mode}
      >
        <div className={cn("flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em]", accentText)}>
          <Trophy className="h-3.5 w-3.5" /> {heading}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {isFinal
            ? `Campaign #${board.campaignNumber} closed without a qualifying finisher.`
            : "No qualifying claims yet — be first to enter this week's campaign."}
        </p>
      </section>
    );
  }

  return (
    <section
      className={cn("mb-5 overflow-hidden rounded-xl border p-4", accentBorder)}
      aria-labelledby="top4-heading"
      data-testid="section-top4"
      data-top4-mode={board.mode}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div id="top4-heading" className={cn("flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em]", accentText)}>
          <Trophy className="h-4 w-4" /> {heading}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider",
              isFinal ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-primary/30 bg-primary/10 text-primary",
            )}
          >
            Campaign #{board.campaignNumber}
          </span>
          {!isFinal && campaign && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 font-mono text-[9px] font-bold text-foreground"
              data-testid="text-top4-countdown"
            >
              <Clock3 className="h-2.5 w-2.5 text-muted-foreground" /> Ends in <CampaignCountdown endAt={campaign.endAt} compact />
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{subtext}</p>
        <button
          type="button"
          onClick={scrollToFullRankings}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-foreground transition-colors hover:border-primary/50 hover:text-primary"
          data-testid="button-view-full-rankings"
        >
          View full rankings <ArrowRight className="h-3 w-3" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {board.entries.map((entry) => {
          const tier = RANK_TIERS[Math.min(entry.rank - 1, RANK_TIERS.length - 1)] ?? RANK_TIERS[RANK_TIERS.length - 1];
          const domain = getDisplayDomain(entry.listing.websiteUrl ?? null);
          return (
            <div
              key={entry.listing.id}
              role="link"
              tabIndex={0}
              onClick={() => setLocation(`/listing/${entry.listing.slug}`)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setLocation(`/listing/${entry.listing.slug}`);
                }
              }}
              className="group flex cursor-pointer flex-col rounded-lg border border-border/60 bg-background/80 p-3 text-center transition-colors hover:border-primary/50 hover:bg-background"
              data-testid={`top4-entry-${entry.rank}`}
            >
              <div className="flex items-center justify-between">
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold", tier.badge)}>
                  {entry.rank}
                </span>
                <div className="flex items-center gap-1">
                  {sponsoredListingIds.has(entry.listing.id) && <SponsorshipBadge />}
                  <Trophy className={cn("h-4 w-4", tier.trophy)} />
                </div>
              </div>
              <ListingAvatar
                logoUrl={entry.listing.logoUrl}
                initials={entry.listing.initials}
                accent={entry.listing.accent}
                alt={entry.listing.name}
                rounded="rounded-full"
                className="mx-auto mt-2 h-11 w-11 text-sm"
              />
              <div className="mt-2 truncate text-xs font-bold text-foreground group-hover:text-primary">
                {entry.listing.name}
              </div>
              {domain && (
                <a
                  href={getListingClickHref(entry.listing.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Visit ${domain}`}
                  onClick={(event) => event.stopPropagation()}
                  className="mx-auto inline-flex max-w-full items-center gap-0.5 truncate font-mono text-[10px] font-semibold text-primary hover:underline"
                  data-testid={`top4-domain-${entry.rank}`}
                >
                  <span className="truncate">{domain}</span>
                  <ArrowUpRight className="h-2.5 w-2.5 shrink-0" />
                </a>
              )}
              <span className={cn("mx-auto mt-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide", tier.pill)}>
                {tier.label}
              </span>
              <div className="mt-2 flex items-baseline justify-center gap-1">
                <span className="font-mono text-sm font-bold text-foreground">{formatCurrency(entry.effectiveBid)}</span>
                <span className="font-mono text-[9px] text-muted-foreground">/ 7 days</span>
              </div>
              <span
                className={cn(
                  "mx-auto mt-2 inline-flex items-center justify-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide",
                  isFinal
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-primary/10 text-primary",
                )}
              >
                <CheckCircle2 className="h-3 w-3" /> {isFinal ? "Winning" : "Leading"}
              </span>
              {entry.listing.demoVideoUrl && (
                <div className="mt-2" onClick={(event) => event.stopPropagation()}>
                  <DemoButton
                    listingId={entry.listing.id}
                    demoVideoUrl={entry.listing.demoVideoUrl}
                    size="sm"
                    className="w-full h-7 px-2 text-[10px]"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-start gap-2 rounded-md border border-border/50 bg-background/60 px-3 py-2 text-[10px] text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        {isFinal
          ? `This board is locked to Campaign #${board.campaignNumber}'s final results — new claims and bids in the live campaign below won't change it.`
          : "Top 4 spots update in real-time as bids come in. First come, first served for the current week."}
      </div>
    </section>
  );
}

export default function Leaderboard() {
  const [category, setCategory] = useState("All categories");
  const [, setLocation] = useLocation();
  const { data: listings, isLoading } = useGetListings();
  const { data: activities } = useGetActivity();
  const { data: campaign } = useQuery({
    queryKey: ["current-campaign"],
    queryFn: getCurrentCampaign,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: analytics } = useQuery({
    queryKey: ["public-analytics"],
    queryFn: getPublicAnalytics,
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
  const { data: top4 } = useQuery({
    queryKey: ["top4-board"],
    queryFn: getTop4Board,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: activeSponsorships } = useQuery({
    queryKey: ["active-sponsorships"],
    queryFn: getActiveSponsorships,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const sponsoredListingIds = useMemo(
    () => new Set((activeSponsorships?.sponsorships ?? []).map((sponsorship) => sponsorship.listing.id)),
    [activeSponsorships],
  );
  const { isLive } = usePaymentEnvironment();

  const displayedListings = useMemo(
    () => {
      const filtered = category === "All categories"
        ? [...(listings ?? [])]
        : [...(listings ?? [])].filter((listing) => matchesCategory(listing.category, category));
      return filtered;
    },
    [category, listings],
  );

  const stats = useMemo(() => ({
    products: listings?.length ?? 0,
    supporters: listings?.reduce((sum, listing) => sum + listing.supporters, 0) ?? 0,
    penalizers: listings?.reduce((sum, listing) => sum + listing.penalizers, 0) ?? 0,
    reviews: listings?.reduce((sum, listing) => sum + listing.reviewCount, 0) ?? 0,
    supportVolume: listings?.reduce((sum, listing) => sum + listing.communitySupport, 0) ?? 0,
    penaltyVolume: listings?.reduce((sum, listing) => sum + listing.penalties, 0) ?? 0,
  }), [listings]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10 lg:pb-20">
      <main className="min-w-0" id="discover">
        {sponsoredListingIds.size > 0 ? (
          <SponsorshipPopup top4={top4} campaign={campaign} />
        ) : (
          <FeaturedSpotlightPopup top4={top4} />
        )}

        <div className="sticky top-14 z-30 mb-4 rounded-xl border border-border/70 bg-card/95 p-2 shadow-sm backdrop-blur-xl">
          <div className="-mx-2 overflow-x-auto px-2 pb-1" aria-label="Browse subcategories">
            <div className="flex min-w-max gap-2">
              <button
                type="button"
                onClick={() => setCategory("All categories")}
                className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-[10px] font-bold uppercase tracking-wide transition-colors", category === "All categories" ? "border-primary bg-primary text-primary-foreground" : "border-border/60 bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground")}
                data-testid="subcategory-all"
              >
                <Grid2X2 className="h-3 w-3" /> All
              </button>
              {CATEGORY_GROUPS.flatMap((group) => group.items).map((subcategory) => (
                <button
                  type="button"
                  key={subcategory}
                  onClick={() => setCategory(subcategory)}
                  className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-[10px] font-bold whitespace-nowrap transition-colors", category === subcategory ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border/60 bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground")}
                  data-testid={`subcategory-${subcategory.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  {(() => {
                    const Icon = CATEGORY_ICONS[subcategory] ?? Grid2X2;
                    return <Icon className="h-3 w-3 shrink-0 opacity-70" />;
                  })()} {subcategory}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Top4Section board={top4} campaign={campaign} sponsoredListingIds={sponsoredListingIds} />

        <CampaignBidModule campaign={campaign} listings={listings} />

        <div data-rankings-header className="mb-3 flex items-center justify-between" id="rankings">
          <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-foreground">Live campaign rankings</h3>
          <span className="font-mono text-[10px] text-muted-foreground">{displayedListings?.length ?? 0} products entered</span>
        </div>

        <div className="space-y-3">
          {isLoading ? Array.from({ length: 5 }).map((_, index) => (
            <div className="h-32 animate-pulse rounded-xl border border-border/40 bg-card/70" key={index} />
          )) : displayedListings?.map((listing, index) => (
              <ListingRankCard key={listing.id} listing={listing} rank={index + 1} sponsored={sponsoredListingIds.has(listing.id)} />
          ))}
          {displayedListings?.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-12 text-center">
              <Compass className="mx-auto mb-3 h-7 w-7 text-muted-foreground/50" />
              <h3 className="text-sm font-bold text-foreground">No products entered yet</h3>
               <p className="mt-1 font-mono text-xs text-muted-foreground">Be first to enter this week&apos;s campaign with a qualifying claim.</p>
            </div>
          )}
        </div>

        <section className="mt-6 overflow-hidden rounded-xl border border-border/70 bg-card/80" id="activity">
          <div data-activity-header className="flex items-center justify-between border-b border-border/50 px-4 py-3">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground">
              <Activity className="h-3.5 w-3.5 text-primary" /> Live activity
            </h2>
            <span className="font-mono text-[9px] text-primary">LIVE</span>
          </div>
          <div className="divide-y divide-border/30 sm:grid sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            {!activities ? (
              <div className="p-5 text-center font-mono text-xs text-muted-foreground sm:col-span-2">Connecting...</div>
            ) : activities.slice(0, 6).map((event) => (
              <div className="p-3.5" key={event.id} data-testid={`activity-event-${event.id}`}>
                <div className="flex items-start gap-2.5">
                  <span className={cn(
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md",
                    event.type === "penalty" ? "bg-destructive/10 text-destructive" : "bg-secondary/10 text-secondary",
                  )}>
                    {event.type === "penalty" ? <ShieldAlert className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-foreground">{event.listingName}</div>
                     <div className={cn("mt-1 font-mono text-[10px] font-bold", event.type === "penalty" ? "text-destructive" : "text-secondary")}>
                       {event.type === "penalty" ? "↘ PUSH DOWN · -" : "↗ BOOST · +"}{formatCurrency(event.amount)}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{relativeTime(event.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <Link href="/winners" data-winner-history className="mt-6 flex items-center justify-between rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-sm font-bold transition-colors hover:bg-amber-500/[0.1]" data-testid="link-winner-history">
          <span className="flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-600 dark:text-amber-300" /> Winner history</span>
          <span className="font-mono text-xs text-muted-foreground">See every completed campaign →</span>
        </Link>

        <section className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 sm:grid-cols-4" aria-label="Platform statistics">
          {[
            ["Products", stats.products],
             ["Boosts", stats.supporters],
             ["Push Downs", stats.penalizers],
            ["Reviews", stats.reviews],
          ].map(([label, value]) => (
            <div className="bg-card/80 p-3 text-center" key={label} data-testid={`stat-${String(label).toLowerCase()}`}>
              <div className="font-mono text-base font-bold text-foreground">{formatNumber(Number(value))}</div>
              <div className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
            </div>
          ))}
        </section>
        <section className="mt-6 overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.045]" aria-labelledby="platform-proof-title">
          <div className="border-b border-primary/15 px-4 py-4 sm:flex sm:items-end sm:justify-between sm:gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                <BarChart3 className="h-3.5 w-3.5" /> The marketplace in numbers
              </div>
              <h2 id="platform-proof-title" className="mt-1 text-lg font-bold text-foreground">Proof that attention is moving.</h2>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">Live totals from verified activity on upndownbid. Share these numbers when you invite founders, builders, and early adopters.</p>
            </div>
            <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-secondary/25 bg-secondary/10 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-secondary sm:mt-0">
              <Zap className="h-3 w-3" /> Live proof
            </span>
          </div>
          <div className="grid grid-cols-2 gap-px bg-primary/10 sm:grid-cols-4">
            {[
              { label: "Unique visitors", value: analytics?.uniqueVisitors, icon: Users, accent: "text-primary" },
              { label: "Total visits", value: analytics?.totalVisits, icon: Eye, accent: "text-foreground" },
              { label: "Bid volume", value: analytics?.totalBidVolume, icon: DollarSign, accent: "text-secondary", currency: true },
              { label: "Campaigns completed", value: analytics?.completedCampaigns, icon: Trophy, accent: "text-amber-600" },
            ].map(({ label, value, icon: Icon, accent, currency }) => (
              <div className="bg-card/80 p-3.5" key={label} data-testid={`proof-${label.toLowerCase().replaceAll(" ", "-")}`}>
                <Icon className={`h-4 w-4 ${accent}`} />
                <div className="mt-2 font-mono text-lg font-bold text-foreground">
                  {value === undefined ? "—" : currency ? formatCurrency(value) : formatNumber(value)}
                </div>
                <div className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-primary/15 px-4 py-3 font-mono text-[10px] text-muted-foreground">
            <span><strong className="text-foreground">{analytics ? formatCurrency(analytics.ownerClaimVolume) : "—"}</strong> owner claims</span>
            <span><strong className="text-secondary">{analytics ? formatCurrency(analytics.communityBoostVolume) : "—"}</strong> community boosts</span>
            <span><strong className="text-secondary">{analytics ? formatNumber(analytics.totalBoosts) : "—"}</strong> boosts</span>
            <span><strong className="text-destructive">{analytics ? formatNumber(analytics.totalPushDowns) : "—"}</strong> push downs</span>
            <span><strong className="text-foreground">{analytics ? formatNumber(analytics.totalReviews) : "—"}</strong> reviews</span>
          </div>
        </section>
        <p className="mt-4 flex items-center justify-center gap-2 text-center font-mono text-[10px] text-muted-foreground">
           <Clock3 className="h-3 w-3" /> {isLive ? "Every boost and push down is a real payment, verified and belongs to the active weekly campaign." : "Sandbox mode — every boost and push down is verified and belongs to the active weekly campaign."}
        </p>

        <SponsorshipSection />
      </main>
    </div>
  );
}
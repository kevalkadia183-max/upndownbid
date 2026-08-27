import type { KeyboardEvent } from "react";
import { useLocation } from "wouter";
import { ArrowUpRight, Star, TrendingDown, TrendingUp, Trophy, User, Users } from "lucide-react";
import type { Listing } from "@workspace/api-client-react";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { getDisplayDomain, getListingClickHref } from "@/lib/listing-links";
import { DemoButton, DemoViewCount } from "@/components/demo-video";
import { SponsorshipBadge } from "@/components/sponsorship-badge";
import { ListingAvatar } from "@/components/listing-avatar";

// Purely decorative medal treatment for the top 3 -- not derived from data,
// just enough visual celebration to match the reference design without
// implying the ranking itself works any differently.
const MEDAL_TIERS = [
  { emoji: "🥇", trophy: true, cardClass: "border-amber-400/60 bg-amber-500/[0.06] ring-1 ring-amber-400/30" },
  { emoji: "🥈", trophy: false, cardClass: "border-border/60 bg-card/70" },
  { emoji: "🥉", trophy: false, cardClass: "border-border/60 bg-card/70" },
];

// Small scattered "confetti" flecks around the #1 trophy -- fixed positions,
// not randomized, so the layout stays stable across renders.
const CONFETTI = [
  { className: "-left-1 top-0 text-amber-400", size: "text-[10px]" },
  { className: "right-0 top-1 text-primary", size: "text-[8px]" },
  { className: "left-1 bottom-1 text-secondary", size: "text-[9px]" },
  { className: "-right-1 bottom-2 text-amber-500", size: "text-[8px]" },
];

export function ListingRankCard({ listing, rank, sponsored }: { listing: Listing; rank: number; sponsored: boolean }) {
  const [, setLocation] = useLocation();
  const domain = getDisplayDomain(listing.websiteUrl);
  const tier = MEDAL_TIERS[rank - 1];

  const goToListing = () => setLocation(`/listing/${listing.slug}`);
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      goToListing();
    }
  };

  const identity = (
    <div className="flex items-center gap-2">
      <ListingAvatar
        logoUrl={listing.logoUrl}
        initials={listing.initials}
        accent={listing.accent}
        alt={listing.name}
        className="h-11 w-11 shrink-0 text-base"
        testId={`avatar-listing-${listing.slug}`}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h4 className="truncate text-sm font-bold text-foreground transition-colors group-hover:text-primary sm:text-base">{listing.name}</h4>
          <span className="shrink-0 truncate rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{listing.category}</span>
          {rank === 1 && <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Campaign leader" />}
          {sponsored && <SponsorshipBadge />}
        </div>
        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{listing.tagline}</p>
      </div>
    </div>
  );

  // Ranks 4+ collapse to a single condensed row -- logo, identity, ranking
  // power -- so the top 3's celebratory treatment stays the visual focus and
  // the list below it doesn't repeat the same heavy card five more times.
  if (!tier) {
    return (
      <article
        data-leaderboard-card
        data-rank-tier="plain"
        role="link"
        tabIndex={0}
        onClick={goToListing}
        onKeyDown={handleKeyDown}
        className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 bg-card/70 p-3 transition-all duration-200 hover:border-primary/50 hover:bg-card"
        data-testid={`link-listing-${listing.slug}`}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/30 font-mono text-[11px] font-bold text-muted-foreground group-hover:border-primary/40 group-hover:text-primary">
          #{rank}
        </div>
        <div className="min-w-0 flex-1">{identity}</div>
        <div className="shrink-0 text-right">
          <div className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Ranking power</div>
          <div className="mt-0.5 font-mono text-sm font-bold text-secondary">{formatCurrency(listing.effectiveBid)}</div>
        </div>
      </article>
    );
  }

  return (
    <article
      data-leaderboard-card
      data-rank-tier={rank}
      className={cn("rounded-xl border p-4 transition-all duration-200 hover:border-primary/50", tier.cardClass)}
    >
      <div
        className="group flex cursor-pointer flex-row items-center gap-3"
        role="link"
        tabIndex={0}
        onClick={goToListing}
        onKeyDown={handleKeyDown}
        data-testid={`link-listing-${listing.slug}`}
      >
        <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 sm:w-20">
          <span className="text-2xl leading-none sm:text-3xl" role="img" aria-label={`Rank ${rank} medal`}>
            {tier.emoji}
          </span>
          {tier.trophy && (
            <div className="relative flex h-14 w-14 items-center justify-center sm:h-16 sm:w-16">
              {CONFETTI.map((flake, i) => (
                <span key={i} className={cn("pointer-events-none absolute select-none", flake.className, flake.size)} aria-hidden="true">
                  ✦
                </span>
              ))}
              <span className="text-5xl leading-none sm:text-6xl" role="img" aria-label="Trophy">
                🏆
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {identity}
          {domain && (
            <a
              href={getListingClickHref(listing.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Visit ${domain}`}
              onClick={(event) => event.stopPropagation()}
              className="mt-1 inline-flex items-center gap-0.5 truncate font-mono text-[11px] font-semibold text-primary hover:underline"
              data-testid={`link-listing-domain-${listing.slug}`}
            >
              {domain}
              <ArrowUpRight className="h-3 w-3 shrink-0" />
            </a>
          )}

          <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-border/40 pt-3">
            <div className="grid min-w-0 grid-cols-3 gap-3 font-mono text-[10px]">
              <div className="min-w-0">
                <div className="text-[8px] uppercase text-muted-foreground">Boosts</div>
                <div className="mt-1 flex items-center gap-0.5 font-bold text-secondary"><TrendingUp className="h-3 w-3" />{formatNumber(listing.supporters)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[8px] uppercase text-muted-foreground">Push downs</div>
                <div className="mt-1 flex items-center gap-0.5 font-bold text-destructive"><TrendingDown className="h-3 w-3" />{formatNumber(listing.penalizers)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[8px] uppercase text-muted-foreground">Rating</div>
                <div className="mt-1 flex items-center gap-0.5 font-bold text-foreground"><Star className="h-3 w-3 fill-primary/20 text-primary" />{listing.rating.toFixed(1)} <span className="text-muted-foreground">({formatNumber(listing.reviewCount)})</span></div>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Ranking power</div>
              <div className="mt-1 font-mono text-base font-bold text-secondary">{formatCurrency(listing.effectiveBid)}</div>
            </div>
          </div>

          {listing.clickAnalytics && (
            <div className="mt-2 flex items-center gap-1 font-mono text-[10px] text-muted-foreground" data-testid={`listing-click-count-${listing.slug}`}>
              {listing.clickAnalytics.uniqueClicks === 1 ? <User className="h-3 w-3" /> : <Users className="h-3 w-3" />}
              <span>
                {formatNumber(listing.clickAnalytics.uniqueClicks)} {listing.clickAnalytics.uniqueClicks === 1 ? "person" : "people"} clicked
              </span>
            </div>
          )}

          {listing.demoVideoUrl && (
            <div className="mt-2 flex items-center gap-2" onClick={(event) => event.stopPropagation()} data-testid={`listing-demo-${listing.slug}`}>
              <DemoButton listingId={listing.id} demoVideoUrl={listing.demoVideoUrl} size="sm" />
              <DemoViewCount demoVideoUrl={listing.demoVideoUrl} demoViewCount={listing.demoViewCount} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/40 pt-3">
        <button
          type="button"
          className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-secondary/35 bg-secondary/10 text-[10px] font-bold uppercase tracking-wider text-secondary transition-colors hover:bg-secondary/20"
          onClick={() => setLocation(`/listing/${listing.slug}?action=support`)}
          data-testid={`button-card-bid-${listing.slug}`}
        >
          <TrendingUp className="h-3.5 w-3.5" /> Boost
        </button>
        <button
          type="button"
          className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-destructive/35 bg-destructive/10 text-[10px] font-bold uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/20"
          onClick={() => setLocation(`/listing/${listing.slug}?action=penalty`)}
          data-testid={`button-card-penalty-${listing.slug}`}
        >
          <TrendingDown className="h-3.5 w-3.5" /> Push down
        </button>
      </div>
    </article>
  );
}

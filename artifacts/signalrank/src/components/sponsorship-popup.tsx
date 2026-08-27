import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Globe, ShieldCheck, Star, Trophy, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn, formatCurrency } from "@/lib/utils";
import {
  getActiveSponsorships,
  getSponsorshipAvailability,
  recordSponsorshipEvent,
  type CurrentCampaign,
  type Top4Board,
} from "@/lib/public-api";
import { getDisplayDomain, getListingClickHref } from "@/lib/listing-links";
import { DemoButton, DemoViewCount } from "@/components/demo-video";
import { CampaignCountdown } from "@/components/campaign-countdown";
import { ListingAvatar } from "@/components/listing-avatar";

const SESSION_KEY = "upndownbid-sponsorship-popup-shown";
const SHOW_DELAY_MS = 1_600;

// Purely decorative rank-tier accents for the sponsor cards -- not derived
// from any ranking, just a visual hierarchy so slot #1 reads distinctly
// from #2-4, echoing the Top 4 board's tier styling.
const SLOT_TIERS = [
  { badge: "bg-amber-500 text-white" },
  { badge: "bg-sky-500 text-white" },
  { badge: "bg-emerald-500 text-white" },
  { badge: "bg-violet-500 text-white" },
];

// A single unified "featured showcase" popup: the currently active
// Featured/Sponsored listings (up to 4 rotating slots) plus, when
// available, the weekly campaign's current leader -- shown together the way
// a visitor actually encounters both products on the homepage. Shown at
// most once per browser session and only when at least one sponsorship is
// active; a listing that is both a sponsor and the campaign leader still
// shows both sections independently (see lib/sponsorships.ts's isolation
// invariant -- this only affects how the two are displayed together, never
// their underlying data or eligibility).
export function SponsorshipPopup({ top4, campaign }: { top4?: Top4Board; campaign?: CurrentCampaign }) {
  const { data } = useQuery({
    queryKey: ["active-sponsorships"],
    queryFn: getActiveSponsorships,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: availability } = useQuery({
    queryKey: ["sponsorship-availability"],
    queryFn: getSponsorshipAvailability,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);
  const impressionSent = useRef(false);
  const sponsors = data?.sponsorships ?? [];
  const leader = top4?.entries?.[0];

  useEffect(() => {
    if (sponsors.length === 0) return;
    if (visible) return;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(SESSION_KEY)) return;

    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
    // Only depends on whether any sponsor has ever loaded -- re-running per
    // sponsor-identity change would re-trigger the popup as data refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sponsors.length > 0]);

  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [visible]);

  useEffect(() => {
    if (!visible || sponsors.length === 0 || impressionSent.current) return;
    impressionSent.current = true;
    window.sessionStorage.setItem(SESSION_KEY, "1");
    for (const sponsor of sponsors) {
      void recordSponsorshipEvent(sponsor.id, "popup_impression");
    }
  }, [visible, sponsors]);

  if (!visible || sponsors.length === 0) return null;

  function dismiss() {
    setEntered(false);
    window.setTimeout(() => setVisible(false), 200);
  }

  const isFinal = top4?.mode === "final";
  const boost = leader ? Math.max(0, leader.effectiveBid - leader.ownerBid) : 0;

  return (
    <div
      className={cn(
        // z-[60]: strictly above the mobile bottom nav (z-50, fixed bottom-4)
        // so this blocking modal can never be partially covered or have its
        // taps intercepted by the nav bar on small screens.
        "fixed inset-0 z-[60] flex items-center justify-center bg-background/70 p-3 backdrop-blur-sm transition-opacity duration-200 sm:p-6",
        entered ? "opacity-100" : "opacity-0",
      )}
      onClick={dismiss}
    >
      <div
        role="dialog"
        aria-label="Featured sponsors"
        data-testid="popup-sponsorship"
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-y-auto rounded-2xl border border-violet-500/30 bg-card shadow-2xl transition-all duration-200",
          entered ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.98] opacity-0",
        )}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-border/60 bg-background/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          data-testid="button-dismiss-sponsorship-popup"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-4 pb-1 pt-5 text-center sm:px-8 sm:pt-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
            <Star className="h-3 w-3 fill-current" /> Featured sponsors
          </span>
          <h2 className="mt-3 text-xl font-extrabold leading-tight text-foreground sm:text-2xl">
            Meet this week&apos;s <span className="text-violet-600 dark:text-violet-300">featured</span> businesses
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-muted-foreground sm:text-sm">
            These businesses are supporting visibility on UpDownBid. Explore their amazing products and services.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          {sponsors.slice(0, 4).map((sponsorship, index) => {
            const domain = getDisplayDomain(sponsorship.listing.websiteUrl);
            const tier = SLOT_TIERS[index] ?? SLOT_TIERS[SLOT_TIERS.length - 1];
            return (
              <div
                key={sponsorship.id}
                className="flex flex-col rounded-xl border border-border/60 bg-background/70 p-3"
                data-testid={`popup-sponsorship-card-${sponsorship.listing.slug}`}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-md font-mono text-[11px] font-bold", tier.badge)}>
                    {index + 1}
                  </span>
                  {index === 0 ? (
                    <Trophy className="h-4 w-4 text-amber-500" />
                  ) : (
                    <Star className="h-3.5 w-3.5 text-muted-foreground/50" />
                  )}
                </div>
                <span className="mt-2 inline-flex w-fit items-center truncate rounded bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">
                  {sponsorship.listing.category}
                </span>
                <ListingAvatar
                  logoUrl={sponsorship.listing.logoUrl}
                  initials={sponsorship.listing.initials}
                  accent={sponsorship.listing.accent}
                  alt={sponsorship.listing.name}
                  className="mx-auto mt-3 h-12 w-12 shrink-0 text-sm"
                />
                <Link
                  href={`/listing/${sponsorship.listing.slug}`}
                  onClick={dismiss}
                  className="mt-2 block truncate text-center text-sm font-bold text-foreground hover:text-primary"
                  data-testid={`link-sponsorship-popup-listing-${sponsorship.listing.slug}`}
                >
                  {sponsorship.listing.name}
                </Link>
                <p className="mt-1 line-clamp-2 text-center font-mono text-[10px] leading-snug text-muted-foreground">
                  {sponsorship.listing.tagline}
                </p>
                <div className="mt-2 flex flex-col items-center gap-1">
                  {domain && (
                    <a
                      href={getListingClickHref(sponsorship.listing.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => void recordSponsorshipEvent(sponsorship.id, "click")}
                      className="inline-flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground hover:text-primary"
                      data-testid={`link-sponsorship-popup-domain-${sponsorship.listing.slug}`}
                    >
                      <Globe className="h-2.5 w-2.5 shrink-0" /> {domain}
                    </a>
                  )}
                  <DemoViewCount
                    demoVideoUrl={sponsorship.listing.demoVideoUrl}
                    demoViewCount={sponsorship.listing.demoViewCount}
                    className="text-[10px]"
                  />
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  <DemoButton
                    listingId={sponsorship.listing.id}
                    demoVideoUrl={sponsorship.listing.demoVideoUrl}
                    size="sm"
                    variant="outline"
                    label="Watch demo"
                    style={{ borderColor: sponsorship.listing.accent, color: sponsorship.listing.accent }}
                    className="h-8 w-full justify-center border-2 bg-transparent text-[10px] uppercase tracking-wide"
                  />
                  {sponsorship.listing.websiteUrl && (
                    <a
                      href={getListingClickHref(sponsorship.listing.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => void recordSponsorshipEvent(sponsorship.id, "click")}
                      style={{ backgroundColor: sponsorship.listing.accent }}
                      className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-md text-[10px] font-bold uppercase tracking-wide text-white transition-opacity hover:opacity-90"
                      data-testid={`link-sponsorship-popup-visit-${sponsorship.listing.slug}`}
                    >
                      Visit website <ArrowUpRight className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {leader && (
          <div className="mx-4 mb-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 sm:mx-6 sm:mb-5 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300">
                  <Trophy className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">
                    Current leader · #1 in Campaign #{top4?.campaignNumber}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <ListingAvatar
                      logoUrl={leader.listing.logoUrl}
                      initials={leader.listing.initials}
                      accent={leader.listing.accent}
                      alt={leader.listing.name}
                      rounded="rounded-full"
                      className="h-7 w-7 shrink-0 text-[10px]"
                    />
                    <Link
                      href={`/listing/${leader.listing.slug}`}
                      onClick={dismiss}
                      className="truncate text-sm font-bold text-foreground hover:text-primary"
                      data-testid="link-sponsorship-popup-leader"
                    >
                      {leader.listing.name}
                    </Link>
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                      Top position
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:gap-5">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Ranking power</div>
                  <div className="font-mono text-base font-bold text-foreground">{formatCurrency(leader.effectiveBid)}</div>
                  {boost > 0 && <div className="font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Boost +{formatCurrency(boost)}</div>}
                </div>
                {!isFinal && campaign && (
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Campaign ends in</div>
                    <div className="font-mono text-sm font-bold text-foreground">
                      <CampaignCountdown endAt={campaign.endAt} compact />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                <Link
                  href={`/listing/${leader.listing.slug}`}
                  onClick={dismiss}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-primary px-3 text-[10px] font-bold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/90 sm:flex-none"
                  data-testid="link-sponsorship-popup-view-leader"
                >
                  View listing <ArrowUpRight className="h-3 w-3" />
                </Link>
                <DemoButton
                  listingId={leader.listing.id}
                  demoVideoUrl={leader.listing.demoVideoUrl}
                  size="sm"
                  variant="outline"
                  label="Watch demo"
                  className="h-9 flex-1 justify-center text-[10px] uppercase tracking-wide sm:flex-none"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 sm:px-6">
          <div className="flex items-start gap-2 text-[10px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
            <span>
              Sponsored · Featured for {availability?.durationDays ?? 7} days
              <br /> Thank you for supporting the UpDownBid community.
            </span>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-violet-600 hover:underline dark:text-violet-300"
            data-testid="button-close-sponsorship-popup"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

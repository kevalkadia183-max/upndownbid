import { useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Star, User, Users } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { getActiveSponsorships, getSponsorshipAvailability, recordSponsorshipEvent } from "@/lib/public-api";
import { getDisplayDomain, getListingClickHref } from "@/lib/listing-links";
import { DemoButton, DemoViewCount } from "@/components/demo-video";
import { ListingAvatar } from "@/components/listing-avatar";

// The Featured/Sponsored section, always shown near the bottom of the
// Discover page -- fully separate product from the weekly campaign above it,
// deliberately styled in violet/star rather than the campaign's amber/trophy
// so the two are never confused. Shows a "become a sponsor" prompt (never
// fake data) when nothing is currently sponsored.
export function SponsorshipSection() {
  const [, setLocation] = useLocation();
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
  const sponsors = data?.sponsorships ?? [];
  const impressionSent = useRef<string>("");

  useEffect(() => {
    if (sponsors.length === 0) return;
    const key = sponsors.map((sponsor) => sponsor.id).sort().join(",");
    if (impressionSent.current === key) return;
    impressionSent.current = key;
    for (const sponsor of sponsors) {
      void recordSponsorshipEvent(sponsor.id, "section_impression");
    }
  }, [sponsors]);

  return (
    <section
      className="mt-6 overflow-hidden rounded-xl border border-violet-500/25 bg-violet-500/[0.04]"
      aria-labelledby="sponsorship-section-title"
      data-testid="section-sponsorship"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-500/15 px-4 py-3">
        <div id="sponsorship-section-title" className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">
          <Star className="h-3.5 w-3.5 fill-current" /> Featured / Sponsored
        </div>
        <span className="font-mono text-[9px] text-muted-foreground">
          {data ? `${sponsors.length} of ${data.totalSlots} slots active` : "…"}
        </span>
      </div>
      {sponsors.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">No sponsors yet — be the first featured listing this week.</p>
          <button
            type="button"
            onClick={() => setLocation("/owner/dashboard?get-featured=1")}
            className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-600 transition-colors hover:bg-violet-500/20 dark:text-violet-300"
            data-testid="button-become-sponsor-empty"
          >
            Become a sponsor{availability ? ` · ${formatCurrency(availability.price)}` : ""} <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {sponsors.map((sponsorship) => {
            const domain = getDisplayDomain(sponsorship.listing.websiteUrl);
            return (
              <div
                key={sponsorship.id}
                className="flex flex-col rounded-lg border border-border/60 bg-background/70 p-3"
                data-testid={`sponsorship-card-${sponsorship.listing.slug}`}
              >
                <div className="flex items-center gap-2">
                  <ListingAvatar
                    logoUrl={sponsorship.listing.logoUrl}
                    initials={sponsorship.listing.initials}
                    accent={sponsorship.listing.accent}
                    alt={sponsorship.listing.name}
                    rounded="rounded-full"
                    className="h-8 w-8 shrink-0 text-xs"
                  />
                  <div className="min-w-0 flex-1">
                    <Link href={`/listing/${sponsorship.listing.slug}`} className="block truncate text-xs font-bold text-foreground hover:text-primary">
                      {sponsorship.listing.name}
                    </Link>
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300">
                      <Star className="h-2.5 w-2.5 fill-current" /> Sponsored
                    </span>
                  </div>
                </div>
                <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">{sponsorship.listing.tagline}</p>
                {domain && (
                  <a
                    href={getListingClickHref(sponsorship.listing.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => void recordSponsorshipEvent(sponsorship.id, "click")}
                    className="mt-2 inline-flex items-center gap-0.5 truncate font-mono text-[10px] font-semibold text-violet-600 hover:underline dark:text-violet-300"
                    data-testid={`link-sponsorship-visit-${sponsorship.listing.slug}`}
                  >
                    {domain} <ArrowUpRight className="h-2.5 w-2.5 shrink-0" />
                  </a>
                )}
                <div
                  className="mt-2 flex items-center gap-1 font-mono text-[10px] text-muted-foreground"
                  data-testid={`sponsorship-click-count-${sponsorship.listing.slug}`}
                >
                  {sponsorship.listing.clickAnalytics.uniqueClicks === 1 ? (
                    <User className="h-2.5 w-2.5" />
                  ) : (
                    <Users className="h-2.5 w-2.5" />
                  )}
                  <span>
                    {formatNumber(sponsorship.listing.clickAnalytics.uniqueClicks)}{" "}
                    {sponsorship.listing.clickAnalytics.uniqueClicks === 1 ? "person" : "people"} clicked
                  </span>
                </div>
                {sponsorship.listing.demoVideoUrl && (
                  <div className="mt-2 flex items-center gap-2">
                    <DemoButton
                      listingId={sponsorship.listing.id}
                      demoVideoUrl={sponsorship.listing.demoVideoUrl}
                      size="sm"
                      variant="outline"
                    />
                    <DemoViewCount
                      demoVideoUrl={sponsorship.listing.demoVideoUrl}
                      demoViewCount={sponsorship.listing.demoViewCount}
                      className="text-[10px]"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {sponsors.length > 0 && sponsors.length < (data?.totalSlots ?? 4) && (
        <div className="flex items-center justify-center border-t border-violet-500/15 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setLocation("/owner/dashboard?get-featured=1")}
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-600 hover:underline dark:text-violet-300"
            data-testid="button-become-sponsor"
          >
            Get featured{availability ? ` · ${formatCurrency(availability.price)}` : ""} <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </section>
  );
}

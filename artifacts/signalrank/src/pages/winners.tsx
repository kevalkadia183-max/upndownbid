import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Crown, Trophy } from "lucide-react";
import { getCampaignWinners } from "@/lib/public-api";
import { formatCurrency } from "@/lib/utils";
import { ListingAvatar } from "@/components/listing-avatar";

function dateRange(startAt: string, endAt: string) {
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return `${format.format(new Date(startAt))} – ${format.format(new Date(endAt))}`;
}

export default function WinnersPage() {
  const { data: winners, isLoading } = useQuery({
    queryKey: ["campaign-winners"],
    queryFn: getCampaignWinners,
    staleTime: 30_000,
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-9 sm:py-12">
      <div className="rounded-2xl border border-border/70 bg-card/80 p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-2 text-primary">
          <Trophy className="h-4 w-4" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em]">Permanent record</span>
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Weekly winners</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Once a Sunday campaign closes, the final winner and verified ranking are preserved here. Each new campaign starts with a clean slate.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        {isLoading && Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-xl border border-border/60 bg-card/60" />
        ))}
        {winners?.map((winner) => (
          <article key={winner.campaignNumber} className="rounded-xl border border-border/60 bg-card/70 p-4 sm:p-5">
            <Link href={`/listing/${winner.listing.slug}`} className="group flex items-center gap-4 transition-colors hover:text-primary">
              <ListingAvatar
                logoUrl={winner.listing.logoUrl}
                initials={winner.listing.initials}
                accent={winner.listing.accent}
                alt={winner.listing.name}
                className="h-12 w-12 shrink-0 text-sm"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Campaign #{winner.campaignNumber}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{dateRange(winner.startAt, winner.endAt)}</span>
                </div>
                <h2 className="mt-1 truncate text-base font-bold group-hover:text-primary">{winner.listing.name}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{winner.listing.category}</p>
              </div>
              <div className="text-right">
                <Crown className="ml-auto h-4 w-4 text-primary" />
                <div className="mt-1 font-mono text-sm font-bold text-secondary">{formatCurrency(winner.finalEffectiveBid)}</div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">final ranking power</div>
              </div>
            </Link>
            <div className="mt-4 border-t border-border/50 pt-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Final leaderboard</p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                {winner.finalRankings.slice(0, 3).map((standing) => (
                  <Link key={standing.listing.id} href={`/listing/${standing.listing.slug}`} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-xs hover:bg-primary/10">
                    <span className="font-mono font-bold text-primary">#{standing.rank}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{standing.listing.name}</span>
                    <span className="font-mono text-[10px] text-secondary">{formatCurrency(standing.effectiveBid)}</span>
                  </Link>
                ))}
              </div>
            </div>
          </article>
        ))}
        {winners?.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-12 text-center">
            <Trophy className="mx-auto h-7 w-7 text-muted-foreground/50" />
            <h2 className="mt-3 text-sm font-bold">The first winner is still being decided.</h2>
            <p className="mt-1 text-xs text-muted-foreground">Return after this campaign closes on Sunday.</p>
          </div>
        )}
      </div>
    </div>
  );
}
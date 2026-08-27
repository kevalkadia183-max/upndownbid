import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

// A visually distinct "Sponsored" badge for the Featured/Sponsored product --
// deliberately a filled star in violet, never the campaign's amber trophy,
// so a listing that is both a campaign leader and a sponsor always shows
// both statuses independently rather than merging or replacing either.
export function SponsorshipBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300",
        className,
      )}
      data-testid="badge-sponsored"
    >
      <Star className="h-2.5 w-2.5 fill-current" /> Sponsored
    </span>
  );
}

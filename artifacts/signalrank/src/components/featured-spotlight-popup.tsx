import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Trophy, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { recordSpotlightImpression, type Top4Board } from "@/lib/public-api";
import { getDisplayDomain, getListingClickHref } from "@/lib/listing-links";
import { DemoButton } from "@/components/demo-video";

const SESSION_KEY = "upndownbid-spotlight-popup-shown";
const SHOW_DELAY_MS = 900;

// A tasteful, dismissible spotlight for this week's #1 listing -- shown once
// per browser session (sessionStorage-gated) and never as a blocking modal,
// so it never gets in the way of browsing the rest of the page.
export function FeaturedSpotlightPopup({ top4 }: { top4: Top4Board | undefined }) {
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);
  const impressionSent = useRef(false);
  const leader = top4?.entries?.[0];

  useEffect(() => {
    if (!leader) return;
    if (visible) return;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(SESSION_KEY)) return;

    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
    // Only depends on whether a leader has ever loaded -- re-running per
    // listing-identity change would re-trigger the popup as data refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(leader)]);

  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [visible]);

  useEffect(() => {
    if (!visible || !leader || impressionSent.current) return;
    impressionSent.current = true;
    window.sessionStorage.setItem(SESSION_KEY, "1");
    void recordSpotlightImpression(leader.listing.id);
  }, [visible, leader]);

  if (!visible || !leader) return null;

  const isFinal = top4?.mode === "final";
  const domain = getDisplayDomain(leader.listing.websiteUrl ?? null);

  function dismiss() {
    setEntered(false);
    window.setTimeout(() => setVisible(false), 200);
  }

  return (
    <div
      role="dialog"
      aria-label="This week's top performer"
      data-testid="popup-featured-spotlight"
      className={cn(
        "fixed inset-x-3 bottom-20 z-50 mx-auto max-w-sm rounded-xl border border-amber-500/30 bg-card shadow-2xl transition-all duration-200 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-20",
        entered ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0 sm:-translate-y-3",
      )}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        data-testid="button-dismiss-spotlight"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-3 p-4 pr-8">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300">
          <Trophy className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-300">
            {isFinal ? `Winner · Campaign #${top4?.campaignNumber}` : "This week's top performer"}
          </div>
          <Link
            href={`/listing/${leader.listing.slug}`}
            onClick={dismiss}
            className="mt-0.5 block truncate text-sm font-bold text-foreground hover:text-primary"
            data-testid="link-spotlight-listing"
          >
            {leader.listing.name}
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={getListingClickHref(leader.listing.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/90"
              data-testid="link-spotlight-visit"
            >
              {domain ? `Visit ${domain}` : "Visit website"} <ArrowUpRight className="h-3 w-3" />
            </a>
            {leader.listing.demoVideoUrl && (
              <DemoButton
                listingId={leader.listing.id}
                demoVideoUrl={leader.listing.demoVideoUrl}
                size="sm"
                className="h-8 px-2.5 text-[10px]"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

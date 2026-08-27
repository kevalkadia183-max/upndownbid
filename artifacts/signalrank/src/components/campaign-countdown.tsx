import { useEffect, useState } from "react";

// Live "time remaining" readout for a campaign's endAt timestamp. Shared
// between the leaderboard's Top 4 header and the featured-showcase popup so
// both always agree on the same tick logic.
export function CampaignCountdown({ endAt, compact = false }: { endAt: string; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((new Date(endAt).getTime() - now) / 1_000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (compact) {
    // Skips live seconds ticking in the compact header badge -- refreshing
    // every second there just causes visual noise in a small inline pill.
    return <span>{days}d {hours}h {minutes}m</span>;
  }
  return <span className="font-mono text-lg font-bold text-foreground sm:text-xl">{days}d {hours}h {minutes}m {remainder}s</span>;
}

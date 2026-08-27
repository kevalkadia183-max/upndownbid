import { useState, type CSSProperties } from "react";
import { Play, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveDemoVideo } from "@/lib/demo-video";
import { recordDemoView } from "@/lib/public-api";
import { cn } from "@/lib/utils";

// Compact "▶ Demo" trigger. Renders nothing when the listing has no demo
// video, so callers never need their own conditional. Clicking lazily
// resolves the URL into a safe embed (never rendering an iframe from the raw
// stored URL) or, for an unrecognized host, opens it as a plain external
// link -- and fires the dedup'd view-tracking call exactly once per open.
export function DemoButton({
  listingId,
  demoVideoUrl,
  size = "sm",
  className,
  variant = "secondary",
  style,
  label = "Demo",
}: {
  listingId: string;
  demoVideoUrl: string | null | undefined;
  size?: "sm" | "default";
  className?: string;
  variant?: "secondary" | "outline";
  style?: CSSProperties;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const resolved = resolveDemoVideo(demoVideoUrl);
  if (!resolved) return null;

  const handleOpen = () => {
    recordDemoView(listingId).catch(() => {
      // View tracking is best-effort from the client's perspective; the
      // server remains the source of truth, so a failed beacon should never
      // block or interrupt watching the demo.
    });
    if (resolved.kind === "embed") {
      setOpen(true);
    } else {
      window.open(resolved.sourceUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size === "sm" ? "sm" : "default"}
        onClick={handleOpen}
        style={style}
        className={cn("gap-1.5", className)}
        data-testid={`button-demo-${listingId}`}
      >
        <Play className="h-3.5 w-3.5 fill-current" />
        {label}
      </Button>
      {resolved.kind === "embed" && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Demo video</DialogTitle>
            </DialogHeader>
            <div className="aspect-video w-full overflow-hidden border-2 border-foreground">
              {open && (
                <iframe
                  src={resolved.embedUrl}
                  title="Demo video"
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// Read-only "N views" text. Hidden whenever there is no demo video, since a
// view count is meaningless without one (and must never appear on Top4
// cards regardless of demo presence -- callers there simply don't render
// this component).
export function DemoViewCount({
  demoVideoUrl,
  demoViewCount,
  className,
}: {
  demoVideoUrl: string | null | undefined;
  demoViewCount: number | null | undefined;
  className?: string;
}) {
  if (!demoVideoUrl) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-bold text-muted-foreground", className)}>
      <Eye className="h-3.5 w-3.5" />
      {demoViewCount ?? 0} {demoViewCount === 1 ? "view" : "views"}
    </span>
  );
}

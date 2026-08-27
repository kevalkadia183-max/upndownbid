import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getListingLogoSrc } from "@/lib/listing-links";
import { cn } from "@/lib/utils";

// Every place a listing's identity is rendered goes through this component:
// shows the owner-uploaded logo when one exists, otherwise falls back to
// the same initials/accent treatment that's always been the default. Never
// render `listing.initials` directly in a new render site -- use this
// instead so a later logo upload doesn't need a second round of edits.
export function ListingAvatar({
  logoUrl,
  initials,
  accent,
  alt,
  className,
  rounded = "rounded-lg",
  testId,
}: {
  logoUrl?: string | null;
  initials: string;
  accent: string;
  alt: string;
  className?: string;
  rounded?: string;
  testId?: string;
}) {
  const src = getListingLogoSrc(logoUrl);
  return (
    <Avatar
      className={cn("border font-bold", rounded, className)}
      style={{ backgroundColor: `${accent}15`, color: accent, borderColor: `${accent}40` }}
      data-testid={testId}
    >
      {src ? <AvatarImage src={src} alt={alt} className="object-cover" /> : null}
      <AvatarFallback className={cn("bg-transparent", rounded)}>{initials}</AvatarFallback>
    </Avatar>
  );
}

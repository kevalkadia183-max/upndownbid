import { getOrCreateVisitorId } from "@/lib/visitor-id";

// Pure display transform: derive a short, human-readable domain from a
// listing's full website URL. Returns null when there is no usable website,
// so callers can hide the domain section entirely rather than show a raw or
// broken URL.
export function getDisplayDomain(websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl) return null;
  try {
    const url = new URL(websiteUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

// The click-tracking redirect is a plain anchor href, not a fetch call: the
// browser navigates to this URL directly and the server issues the 302. The
// destination is always resolved server-side from the listing record, never
// from anything in this URL, so this query string cannot be abused to open
// an arbitrary redirect. `vid` only carries the same anonymous visitor id
// already used for site-visit analytics, so repeat clicks from one browser
// dedupe into a single unique click server-side.
export function getListingClickHref(listingId: string): string {
  const visitorId = getOrCreateVisitorId();
  const query = visitorId ? `?vid=${encodeURIComponent(visitorId)}` : "";
  return `/api/listings/${listingId}/click${query}`;
}

// Resolves an owner-uploaded logo's object-storage path (e.g.
// `/objects/uploads/<uuid>`, as stored on `listing.logoUrl`) into a URL the
// browser can fetch directly. Every logo render site should go through
// this rather than hand-building the path.
export function getListingLogoSrc(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  return `/api/storage${logoUrl}`;
}

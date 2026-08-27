/** Shared display helpers for rendering a member profile (owner dashboard
 * settings card and the public listing page's owner profile section) so the
 * two surfaces stay visually and behaviorally consistent. */

export function initialsFromName(name: string | undefined | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

export function normalizedHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Splits a free-text "social links" field on whitespace/commas and
 * linkifies any tokens that look like URLs, leaving plain text as-is. */
export function socialLinkTokens(value: string): { text: string; href: string | null }[] {
  return value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((token) => ({
      text: token,
      href: /^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(token) ? normalizedHref(token) : null,
    }));
}

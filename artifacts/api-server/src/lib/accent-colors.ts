// Listings store a brand "accent" color that is used directly as a CSS
// color value everywhere a listing renders (Top 4 board, listing cards, the
// sponsorship grid, the featured-sponsors popup, etc.) -- e.g.
// `style={{ color: listing.accent }}`. That only works when the stored value
// is a color the browser actually understands. Historically this column was
// populated with plain names ("amber", "coral", "mint", ...) picked from a
// fixed rotation; some of those names ("amber", "mint") are not valid CSS
// color keywords, so the browser silently drops the style and the listing
// renders with no brand tint at all -- no error, just a blank look.
//
// To make every listing's accent render deterministically, new listings get
// a real `#RRGGBB` hex value straight from ACCENT_PALETTE (guaranteed valid
// CSS), and any legacy name still sitting in the database can be resolved
// back to the same hex via LEGACY_NAMED_ACCENTS.

export const ACCENT_PALETTE = [
  "#FF7A5C", // coral
  "#8B5CF6", // violet
  "#3B82F6", // blue
  "#2DD4BF", // mint
  "#F59E0B", // amber
] as const;

// Maps every accent name the app has ever seeded/generated to the hex value
// it should have meant, so existing rows can be normalized without changing
// their intended brand color. Includes both the previously valid CSS
// keywords ("coral", "blue", "violet") and the previously-invalid ones
// ("amber", "mint") -- all of them move to hex for a consistent format.
const LEGACY_NAMED_ACCENTS: Record<string, string> = {
  coral: "#FF7A5C",
  violet: "#8B5CF6",
  blue: "#3B82F6",
  mint: "#2DD4BF",
  amber: "#F59E0B",
};

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value.trim());
}

// Deterministically assigns a listing a color from the guaranteed-valid
// palette based on its name, so the same name always lands on the same
// accent (mirrors the previous name-hashing behavior, just with hex output).
export function accentFrom(name: string): string {
  const code = Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0);
  return ACCENT_PALETTE[code % ACCENT_PALETTE.length] ?? ACCENT_PALETTE[0];
}

// Resolves any stored accent value -- old named keyword, already-valid hex,
// or anything else unrecognized -- to a hex color guaranteed to render.
// Used to backfill/normalize legacy rows written before this module existed.
export function resolveAccent(storedValue: string, fallbackSeed: string): string {
  const trimmed = storedValue.trim();
  if (isValidHexColor(trimmed)) return trimmed;
  const named = LEGACY_NAMED_ACCENTS[trimmed.toLowerCase()];
  if (named) return named;
  return accentFrom(fallbackSeed);
}

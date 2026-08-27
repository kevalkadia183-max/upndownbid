import type { SiteSettings } from "@workspace/api-client-react";

// Resolves {{TOKEN}} placeholders in admin-authored policy content against
// live site settings. A token with no value yet renders a clear, honest
// placeholder rather than inventing a business fact.
const NOT_YET_PROVIDED = "[not yet provided by the business]";

// Deliberately narrowed to the string-valued settings keys only (not
// `keyof SiteSettings` broadly) -- taxRatePercent is a number, and this
// map must never widen to include it, or the string-only handling below
// breaks.
type StringSettingsKey =
  | "businessName"
  | "businessAddress"
  | "supportEmail"
  | "grievanceOfficerName"
  | "grievanceOfficerEmail";

const TOKEN_TO_SETTINGS_KEY: Record<string, StringSettingsKey> = {
  BUSINESS_NAME: "businessName",
  BUSINESS_ADDRESS: "businessAddress",
  SUPPORT_EMAIL: "supportEmail",
  GRIEVANCE_OFFICER_NAME: "grievanceOfficerName",
  GRIEVANCE_OFFICER_EMAIL: "grievanceOfficerEmail",
};

export function resolvePolicyTokens(content: string, settings: SiteSettings | undefined): string {
  return content.replace(/\{\{([A-Z_]+)\}\}/g, (fullMatch, token: string) => {
    const settingsKey = TOKEN_TO_SETTINGS_KEY[token];
    if (!settingsKey) return fullMatch;
    const value = settings?.[settingsKey];
    return value && value.trim() ? value : NOT_YET_PROVIDED;
  });
}

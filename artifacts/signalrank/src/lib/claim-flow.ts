// Shared trigger for opening the (now-collapsible) campaign claim module from
// anywhere on the Discover page tree -- the header nav, mobile nav, mobile
// menu sheet, and the Top 4 section's own CTA all need to expand the same
// module instance without requiring it to be lifted out of its
// self-contained component. A custom window event decouples callers from
// CampaignBidModule's internal state.
export const OPEN_CAMPAIGN_CLAIM_EVENT = "upndownbid:open-campaign-claim";

export function openClaimFlow() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_CAMPAIGN_CLAIM_EVENT));
  window.requestAnimationFrame(() => {
    document.getElementById("campaign-bid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

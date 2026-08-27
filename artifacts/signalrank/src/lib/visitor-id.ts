// Same anonymous, client-generated visitor identifier used for site-visit
// analytics (see App.tsx's AnalyticsTracker). Reusing this key means a
// listing click from the same browser hashes to the same visitorHash as its
// site visits, so unique-click counting dedupes the same way uniqueVisitors
// already does — no new privacy mechanism, no PII, nothing persisted server
// side beyond a hash.
const VISITOR_STORAGE_KEY = "upndownbid-visitor-id";

export function getOrCreateVisitorId(): string | null {
  try {
    let visitorId = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      window.localStorage.setItem(VISITOR_STORAGE_KEY, visitorId);
    }
    return visitorId;
  } catch {
    // Browsers that block storage still get a working click-through link;
    // the server falls back to a one-off, non-persistent identifier.
    return null;
  }
}

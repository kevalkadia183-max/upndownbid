---
name: SignalRank listing-creation surfaces
description: Which of SignalRank's several listing-creation/edit UIs and endpoints are actually reachable vs. dead code.
---

The signalrank artifact has multiple listing-creation and listing-edit code paths, but not all of them are wired into any route:

- **Live creation flow**: the homepage "Claim a spot" CTA / `/add-product` renders `campaign-bid-module.tsx`, which posts to `POST /public/campaign-bids` (`publicCampaignBidBody`). This is the one real users actually hit.
- **Live edit flows**: the signed-in owner dashboard (`pages/owner-dashboard.tsx`, via `/me/listings/:id` PATCH) and the passwordless secure-link page (`pages/listing-edit.tsx` at `/manage/:token`, via the public managed-listing update route) are both genuinely reachable.
- **Dead code** (not routed/called from anywhere as of 2026-08-27): `pages/listing-new.tsx` (a full creation form) and `createPublicListing`/`POST /public/listings/checkout` (`publicCreateListingBody`). `App.tsx` never mounts `ListingNewPage`, and no component calls `createPublicListing`.

**Why:** a task description naming "the create-listing flow in signalrank.ts" is ambiguous between several schemas/routes that all plausibly match; picking the one with no live UI caller produces changes nobody can reach. Confirm reachability (grep for the route/component in `App.tsx` and page/component call sites) before assuming a named file/schema is the live path.

**How to apply:** when asked to change listing creation or editing behavior, grep `App.tsx` for the route and grep call sites of the relevant `lib/public-api.ts` function before editing — don't trust the endpoint/file name alone.

---
name: Response schema / serializer drift
description: A shared OpenAPI/Zod response schema (e.g. Listing) can gain a new required field for one route while a second route reusing an extended schema (e.g. AdminListing) still builds the old shape, causing a silent 500 only discovered when that second route is hit.
---

Adding a required field to a base response schema (e.g. `Listing.clickAnalytics`) does not
guarantee every handler that serializes an object conforming to an extended schema (e.g.
`AdminListing extends Listing`) was updated to populate it. `typecheck:libs` and the single
route's own typecheck pass because the serializer object literals are untyped through
`Response.parse(...)`; the break only surfaces at runtime as a Zod parse failure (500) on the
*other* route.

**Why:** happened here when a public-listing click-analytics feature added a required
`clickAnalytics` field to `Listing`; the admin-overview handler (a separate serializer building
`AdminListing`, which extends `Listing`) was never updated, so `/admin/overview` 500'd for every
admin/moderator until caught by an e2e test that actually loaded the admin panel.

**How to apply:** after adding a required field to a schema that multiple serializers build
against, grep for every other route/handler constructing that same schema (or one that extends
it) and update them in the same change. Prefer an e2e smoke test that loads the admin panel (or
whichever secondary consumer) after such schema changes, since backend typecheck alone will not
catch it.

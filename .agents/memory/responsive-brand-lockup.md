---
name: Responsive brand lockup
description: How the upndownbid header logo should behave in narrow and magnified browser viewports.
---

Use one transparent horizontal lockup containing both the up/down symbol and the complete `upndownbid.lol` wordmark for responsive branding, rather than separate mark and wordmark images.

**Why:** Browser magnification can reduce the effective CSS viewport far below a typical phone width. Independently sized flex children may then be constrained differently, leaving the symbol visible while the name is clipped.

**How to apply:** Keep the lockup proportional with `object-contain` and a maximum available width. At ultra-narrow viewports, reflow header controls instead of allowing the lockup to compete for the same line. Test actual document scroll width at extreme accessibility-zoom widths; stack leaderboard metadata and long calls-to-action rather than merely hiding horizontal overflow.
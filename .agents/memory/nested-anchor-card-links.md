---
name: Nested anchor inside a card-as-link
description: Adding a real <a> inside a card that is itself a link requires converting the outer wrapper away from an anchor.
---

A card/row that acts as a whole-row link (wrapped in `<a>` or a router `<Link>`) cannot contain a second, independently-clickable real `<a>` (e.g. an external domain link) — nested anchors are invalid HTML and behave unreliably across browsers (click targeting, focus order, screen readers).

**Why:** confirmed while adding a per-listing external website link inside an already-clickable leaderboard card.

**How to apply:** When a card-as-link needs to gain a genuine nested anchor, convert the *outer* wrapper from `<a>`/`<Link>` to a plain element (e.g. `<div role="link" tabIndex={0} onClick=... onKeyDown={...}>`) that programmatically navigates, preserving any existing `data-testid`. Give the inner anchor `onClick={(e) => e.stopPropagation()}` (not `preventDefault()`) so it still navigates/opens normally without also triggering the outer card's click handler. Guard the outer `onKeyDown` with `event.target === event.currentTarget` so focusing the inner anchor and pressing Enter doesn't double-fire the outer navigation.

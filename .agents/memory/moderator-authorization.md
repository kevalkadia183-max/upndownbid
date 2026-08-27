---
name: Moderator authorization
description: Security rules for privileged SignalRank moderation actions.
---

Moderator identity must be derived from a Clerk-verified session and a database-backed role mapping. Browser headers, request bodies, and client claims are never an authority for a role.

**Why:** A development identity header made it possible for any caller to impersonate a moderator and access privileged records.

**How to apply:** Bind privileged Clerk subjects using the operator-only database role command. Keep moderation mutations transactional with an audit insert, and retain the database append-only guard for audit events.
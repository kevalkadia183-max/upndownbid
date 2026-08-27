---
name: Clerk home rendering
description: Preventing blank application shells while Clerk determines the current session.
---

Use an explicit Clerk loading branch and an explicit signed-in/signed-out branch for route-level rendering.

**Why:** Visibility-oriented auth wrappers can leave a shared page shell with no route content during session initialization or a cached-session transition.

**How to apply:** When a route needs to choose between public content and an account redirect, wait for Clerk's loaded state, render a safe loading state, then branch on the resolved signed-in state.
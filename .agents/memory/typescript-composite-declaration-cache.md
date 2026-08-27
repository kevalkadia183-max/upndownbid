---
name: TypeScript composite declaration cache
description: How stale project-reference declarations can mask newly generated API exports.
---

When generated API contracts change, artifact typechecks can report missing exports or fields even though the source files contain them. Clean and force-build the composite workspace references before treating the source contract as broken.

**Why:** Incremental TypeScript declaration output can remain stale after merged generated-source changes, so consuming packages resolve old declarations.

**How to apply:** If a consumer reports a missing generated API type that is present in source, run `tsc --build --clean` followed by `tsc --build --force`, then re-run the consumer typechecks.
---
name: Security suite added test files
description: api-server's test-security.mjs runs a hardcoded list of test file paths, not a glob — a new *.test.ts file is silently skipped unless added to that list.
---

`artifacts/api-server/test-security.mjs` (the `pnpm --filter @workspace/api-server run test` entry point) spawns `tsx --test` against an explicit, hardcoded array of file paths rather than discovering `*.test.ts` files by glob.

**Why:** adding a new test file and confirming it passes when run directly (e.g. via `node --test`) is not sufficient — the actual CI/regression command silently never executes it, so a real bug the new test would have caught can ship unnoticed while "the tests pass."

**How to apply:** whenever you add a new `src/*.test.ts` file to `artifacts/api-server`, also add its path to the array inside `test-security.mjs` (search for the existing list of `"src/*.test.ts"` entries), then run `pnpm --filter @workspace/api-server run test` to confirm the new file's tests actually execute as part of the suite.

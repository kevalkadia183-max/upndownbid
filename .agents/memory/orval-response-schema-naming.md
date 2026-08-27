---
name: Orval response schema naming
description: orval's zod codegen and its react-client codegen can name the same OpenAPI response differently — verify the real export in each generated file.
---

Orval's zod-schema generator names a route's response export from the OpenAPI **operationId** (e.g. `RecordDemoViewResponse` for `operationId: recordDemoView`), not from the component schema referenced via `$ref` (e.g. a shared `DemoViewCount` schema). The react-client (TypeScript interface) generator for the same spec can instead use the referenced component schema's own name for its type. The two generators are inconsistent with each other even when reading the identical `openapi.yaml`.

**Why:** hand-written route code importing "the response type" from `@workspace/api-zod` can compile against a name that doesn't exist in the actual generated file, because the name was assumed from the OpenAPI component schema rather than checked. This silently breaks the production build (esbuild "No matching export") without failing typecheck if the import line itself was never exercised by `tsc --build` after a codegen run.

**How to apply:** after adding or renaming a response schema referenced by `$ref` in `openapi.yaml`, grep the actual generated file (`lib/api-zod/src/generated/api.ts`) for the real exported const name before writing route code against it — don't assume it matches the schema name in the spec, and don't assume it matches the name used by a different codegen target (e.g. `lib/api-client-react`) for the same operation.

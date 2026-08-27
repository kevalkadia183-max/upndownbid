---
name: Orval path+query param naming collision
description: Declaring both a path param and a query param on one OpenAPI operation can crash codegen with a TS naming collision.
---

Declaring both a path parameter (e.g. `listingId`) and a query parameter (e.g. `vid`) on the same OpenAPI operation can make orval derive the same base type name (`<OperationId>Params`) for both the auto-generated Zod path-params schema and the query-params TS type, causing a TS2308 duplicate-export collision in the generated client.

**Why:** orval's naming scheme for generated param types is based on the operation, not the parameter location (path vs query), so two parameter groups on one operation can land on the same symbol name.

**How to apply:** When adding an endpoint that needs a path param plus an incidental query value that will never go through the generated API client anyway (e.g. a raw query string on a plain `<a href>` redirect link, read via `req.query` server-side), omit the query param from the OpenAPI spec entirely rather than declaring both. Only add both path and query params on one operation if you've confirmed orval's output doesn't collide (e.g. by running codegen and checking `pnpm -w run typecheck:libs`).

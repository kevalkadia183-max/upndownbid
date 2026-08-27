# upndownbid

Public, mobile-first product discovery marketplace where products are ranked by immutable sandbox bid, support, and penalty ledger events.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/signalrank` — public React/Vite marketplace.
- `artifacts/api-server` — Express API, protected moderation boundary, and payment/ledger logic.
- `lib/db/src/schema` — PostgreSQL schemas.
- `lib/api-spec/openapi.yaml` — generated-client API contract for established member/admin APIs.

## Architecture decisions

- Public marketplace actions use server-side sandbox checkout, never browser-controlled ranks or payment values.
- Visitors do not have marketplace accounts. Product ownership is scoped to an expiring, revocable, cryptographically random management link stored as a hash.
- Clerk is retained only for verified administrator and moderator access.
- Public action email addresses are transactional only and are never returned in listing responses.

## Product

- Browse and filter ranked websites, see public activity, and support, penalize, review, or report without signing in.
- Add a product through a URL-first duplicate-aware sandbox checkout, with a projected rank before publishing.
- Manage a product, increase its owner bid, or archive it through a secure management link.

## User preferences

- Keep the public product marketplace account-free; never surface sign-in, profile, account, or password UI to marketplace visitors.

## Gotchas

- Standalone Vite builds need `PORT` and `BASE_PATH`, matching the artifact workflow environment.
- Shared API client and Zod declaration packages may need `pnpm exec tsc -b lib/api-client-react lib/api-zod --force` after generation changes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

# LUZON TOLLMAP

Map-first Luzon expressway route planner. The UI intentionally does **not** invent toll prices: a customer-facing total is only returned when every matched segment has an effective, published rate version.

## Run locally

1. Copy `.env.example` to `.env` and configure PostgreSQL plus one routing provider.
2. `npm install`
3. `npm run db:generate && npm run db:seed`
4. `npm run dev`

## Toll-rate architecture

- `app/`: customer pages, admin surface, validated HTTP endpoints.
- `lib/toll/rate-repository.ts`: the only database-backed toll lookup boundary. Frontend components never contain or select toll prices.
- `lib/toll/rate-selection.ts`: deterministic effective-date selection; historical and scheduled versions remain intact.
- `GET /api/toll-rates?expressway=NLEX&origin=...&destination=...&vehicleClass=CLASS_1&travelDate=...`: returns only a published rate effective for that date, otherwise `RATE_UNAVAILABLE`.
- `GET /api/expressways`: returns the centralized expressway registry.
- `prisma/`: versioned rate schema. A `TollRate` joins a rate version, entry plaza, exit plaza, and vehicle class. Use PostGIS migrations for production geometry matching; Prisma stores geometry metadata as JSON in this baseline.
- `tests/`: pricing behavior tests.

## Rate publication workflow

Register an official source, retain its snapshot/hash, create a draft `RateVersion`, validate/import its matrix, review differences, approve, then publish or schedule it. Published records are never overwritten; expiry is set by a new version. A scheduler must only raise review events for changed sources, never publish an uncertain parse.

## Adding or importing a rate

Create the expressway and its plazas, then create a `RateSource` pointing to an official notice and a `RateVersion` with `effectiveFrom`. Add one `TollRate` for every plaza pair and vehicle class in centavos. Set the version to `PUBLISHED` only after verification. The JSON shape for a bulk-import tool is documented in `data/toll-rate-import.example.json`; its zero values are placeholders and must never be imported as real fees.

There is deliberately no unauthenticated write API in this baseline. Add authenticated admin handlers/import UI before enabling rate edits. Publishing or changing a database record changes subsequent API/calculation results without frontend edits.

## Required environment

`DATABASE_URL`, `CRON_SECRET`, and `SYNC_SCHEDULE` are required. Mapbox is the default provider and needs `NEXT_PUBLIC_MAPBOX_TOKEN` (browser map) plus `MAPBOX_ACCESS_TOKEN` (server routing).

Google Maps is an opt-in provider. Set `ROUTING_PROVIDER="google"` and `NEXT_PUBLIC_MAP_PROVIDER="google"`, then provide `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` and `GOOGLE_MAPS_SERVER_API_KEY`. Enable billing plus Maps JavaScript API, Geocoding API, and Routes API in Google Cloud. Use separate keys in production: the browser key needs HTTP-referrer restrictions and must only enable Maps JavaScript API; the server key must never start with `NEXT_PUBLIC_`, should have IP restrictions, and should only enable Geocoding and Routes.

## Authentication and accounts

Route planning, map viewing, toll breakdowns, and fuel estimates remain public. Accounts are optional and add saved routes, saved vehicle profiles, preferences, and private calculation history. Registration requires email verification before password login.

Before enabling registration, apply the reviewed migration with `npm run db:migrate`, then configure `AUTH_BASE_URL` and email delivery. In local development only, set `AUTH_EMAIL_DELIVERY="console"` to print verification and reset links in the server terminal. In production, set `EMAIL_FROM` and `EMAIL_API_KEY` for a Resend-compatible email API (or point `EMAIL_API_URL` at a compatible internal provider). Never set console email delivery in production.

Gmail SMTP is also supported. Enable 2-Step Verification on the sender Google account, create a Google App Password, then set `AUTH_EMAIL_DELIVERY="gmail"`, `GMAIL_USER` to that Gmail address, and `GMAIL_APP_PASSWORD` to the App Password. The app uses Gmail's `smtp.gmail.com` over port 465 with implicit TLS. Do not use the normal Gmail password; it will not work and must never be added to `.env`.

Google sign-in appears only when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_BASE_URL` are all configured. Register the callback URL as `<AUTH_BASE_URL>/api/auth/google/callback`; keep the client secret server-only.

Sessions are opaque, hashed in PostgreSQL, and sent only in HTTP-only cookies. User-owned API queries are restricted by the authenticated user ID. `/admin` is server-protected and requires the `ADMIN` role; promote the first administrator directly in PostgreSQL after verifying the intended account, for example: `UPDATE "User" SET "role" = 'ADMIN' WHERE "email" = 'you@example.com';`.

## Known baseline limits

This repository includes a verified SCTEX rate version and three disabled secondary matrix references (Toll.ph, Expressway.PH, and netPinoy Tollculator). Secondary matrices are useful change-detection signals only: they cannot be returned to customers, even if somebody accidentally marks a derived version as published. Confirm every changed value against a current TRB or operator notice, then import it under an official source.

## Automated secondary-matrix import

`npm run db:import:toll-ph` downloads Toll.ph's publicly rendered matrix and stages its rows in `MatrixImport`/`MatrixImportRow` with `PENDING_REVIEW` status. It records a content hash and does nothing when the downloaded snapshot is unchanged. It never creates or modifies a published `RateVersion`.

`npm run db:enrich:toll-plazas` is a separate, operator-run command that geocodes candidate plazas from the latest staged import. It is intentionally not part of customer route calculation; it can create locator records but cannot publish or alter a toll amount. Review every generated plaza before relying on it for a customer-facing estimate.

For scheduled deployment, send a `POST` request to `/api/internal/toll-import/toll-ph` with `Authorization: Bearer <CRON_SECRET>`. Review the staged records against a primary TRB or expressway-operator notice before publishing any corresponding toll rates.

## Operational safeguards

- The current `/admin` page is a read-only monitoring surface. Keep it behind your deployment's authentication layer before exposing operational data publicly.
- This repository has no Prisma migration history yet. Back up production, establish a baseline migration in a staging clone, and use reviewed migrations for every schema change; do not use `db push` as a production deployment mechanism.
- There is no automatic publication path. A secondary matrix is never an official rate source and does not qualify a route for a verified total.

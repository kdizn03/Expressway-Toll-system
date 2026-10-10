# LUZON TOLLMAP

Map-first Luzon expressway route planner. The UI intentionally does **not** invent toll prices: a customer-facing total is only returned when every matched segment has an effective, published rate version.

## Run locally

1. Copy `.env.example` to `.env` and configure PostgreSQL plus Mapbox tokens.
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

`DATABASE_URL`, `NEXT_PUBLIC_MAPBOX_TOKEN` (browser map only), `MAPBOX_ACCESS_TOKEN` (server routing), `CRON_SECRET`, and `SYNC_SCHEDULE`.

## Known baseline limits

This repository includes a verified SCTEX rate version and three disabled secondary matrix references (Toll.ph, Expressway.PH, and netPinoy Tollculator). Secondary matrices are useful change-detection signals only: they cannot be returned to customers, even if somebody accidentally marks a derived version as published. Confirm every changed value against a current TRB or operator notice, then import it under an official source.

## Automated secondary-matrix import

`npm run db:import:toll-ph` downloads Toll.ph's publicly rendered matrix and stages its rows in `MatrixImport`/`MatrixImportRow` with `PENDING_REVIEW` status. It records a content hash and does nothing when the downloaded snapshot is unchanged. It never creates or modifies a published `RateVersion`.

For scheduled deployment, send a `POST` request to `/api/internal/toll-import/toll-ph` with `Authorization: Bearer <CRON_SECRET>`. Review the staged records against a primary TRB or expressway-operator notice before publishing any corresponding toll rates.

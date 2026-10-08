# LUZON TOLLMAP

Map-first Luzon expressway route planner. The UI intentionally does **not** invent toll prices: a customer-facing total is only returned when every matched segment has an effective, published rate version.

## Run locally

1. Copy `.env.example` to `.env` and configure PostgreSQL plus Mapbox tokens.
2. `npm install`
3. `npm run db:generate && npm run db:seed`
4. `npm run dev`

## Architecture

- `app/`: customer pages, admin surface, validated HTTP endpoints.
- `lib/toll/`: provider-independent, testable pricing service.
- `prisma/`: versioned rate schema. Use PostGIS migrations for production geometry matching; Prisma stores geometry metadata as JSON in this baseline.
- `tests/`: pricing behavior tests.

## Rate publication workflow

Register an official source, retain its snapshot/hash, create a draft `RateVersion`, validate/import its matrix, review differences, approve, then publish or schedule it. Published records are never overwritten; expiry is set by a new version. A scheduler must only raise review events for changed sources, never publish an uncertain parse.

## Required environment

`DATABASE_URL`, `NEXT_PUBLIC_MAPBOX_TOKEN` (browser map only), `MAPBOX_ACCESS_TOKEN` (server routing), `CRON_SECRET`, and `SYNC_SCHEDULE`.

## Known baseline limits

This repository is an intentionally safe foundation: no official matrix has been seeded, no customer toll is claimed, and live Mapbox/PostGIS adapters, auth, CSV import UI, source-monitor cron and Playwright flows still need deployment-specific implementation. The schema and service boundaries are ready for them.

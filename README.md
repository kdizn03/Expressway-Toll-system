# LUZON TOLLMAP

Map-first Luzon expressway route planner. The UI intentionally does **not** invent toll prices: a customer-facing total is only returned when every matched segment has an effective, published rate version.

## Run locally

1. Copy `.env.example` to `.env` and configure PostgreSQL plus the two Google Maps Platform keys (see [Google Cloud setup](#google-cloud-setup)).
2. `npm install`
3. `npm run db:generate && npm run db:seed`
4. `npm run dev`

For hosted deployment instructions, see [docs/deployment.md](docs/deployment.md).

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

`DATABASE_URL`, `CRON_SECRET`, and `SYNC_SCHEDULE` are required. Mapping, place search, and routing use Google Maps Platform:

| Variable | Where it is used | Google APIs it needs |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Browser: the map and origin/destination autocomplete | Maps JavaScript API, Places API (New) |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | Browser: optional Map ID for advanced markers (defaults to Google's `DEMO_MAP_ID`) | — |
| `GOOGLE_MAPS_SERVER_API_KEY` | Server only: route calculation, typed-place lookup, `db:enrich:toll-plazas` | Routes API, Places API (New) |

`NEXT_PUBLIC_*` values are compiled into the browser bundle and are public by design; protect them with restrictions, not secrecy. The server key must never be given a `NEXT_PUBLIC_` name. Restart the dev server after changing any of these values.

## Google Maps Platform integration

```
Places API (New) autocomplete ──► origin / destination (Place ID + lat/lng)
        │  (typed text without a selection → Places Text Search on the server)
        ▼
Routes API computeRoutes ──► GoogleRouteAdapter ──► RouteCandidate (geometry, distance, time, steps)
        ▼
Expressway identification ─► toll plaza / segment mapping ─► PostgreSQL + Prisma official rates
        ▼
Toll calculation engine ─► FASTEST / BALANCED / AVOID TOLLS ─► frontend
```

- **Map** (`components/google-toll-map.tsx`, `components/google-maps-loader.ts`): Maps JavaScript API loaded once with the async `importLibrary` bootstrap. Draws the animated selected route, clickable grey alternatives, and A/B advanced markers. The map is created once and is not reloaded when a different route is selected.
- **Autocomplete** (`components/place-autocomplete.tsx`): `AutocompleteSuggestion.fetchAutocompleteSuggestions` restricted to the Philippines and biased to Luzon, debounced, with one `AutocompleteSessionToken` per search session that ends at the `Place.fetchFields` call on selection (session billing). The selection's Place ID, name, formatted address, and coordinates are sent to the server. If Places is unavailable, typed text still works.
- **Routing** (`lib/routing/google.ts`): Routes API with `TRAFFIC_AWARE` routing and `computeAlternativeRoutes` for normal trips, plus a second request with `routeModifiers.avoidTolls`. Google's avoid-tolls option is only a preference: the returned route is still inspected by the toll engine, and any remaining toll is reported.
- **Adapter** (`lib/routing/google-route-adapter.ts`): converts Google's response into the provider-neutral `RouteCandidate`. Google has no per-step road-name field, so the adapter parses instruction text (ignoring "toward …" signage), expands abbreviations (`Expy`, `N Luzon`, `La Un`), maps route numbers on tolled steps (R-8/E1 → NLEX/TPLEX, R-3 → SLEX, R-1/E3 → CAVITEX, E5 → NLEX, E6 → NAIAX), separates SCTEX and TPLEX by latitude, and carries the current expressway through unnamed tolled steps.
- **Tolls**: Google's own toll estimates are never requested or used. Expressway, plaza, and rate identification and totals come only from `lib/toll` and the PostgreSQL rate database. The balanced score in `lib/routing/route-ranking.ts` (time 50%, distance 20%, toll 30%) is unchanged; if Google returns fewer alternatives, fewer cards are shown rather than inventing routes.
- **Caching and cost**: identical route requests are cached in memory for 5 minutes (traffic-aware data goes stale quickly) and typed-place lookups for 1 hour. Failures are never cached. Each calculation makes at most two Routes requests, plus a Text Search only for fields typed without picking a suggestion.
- **Errors**: missing or invalid keys, disabled APIs or billing, exhausted quota, network failures, unknown places, and "no route" each return a specific message. No distance, time, or geometry is ever fabricated.

## Luzon coverage

The planner covers the **Luzon main island**, where the supported expressway network lies. The Visayas, Mindanao, ferry-only islands of the Luzon group (Mindoro, Marinduque, Catanduanes, Batanes, and others), and other countries are not supported. Details and the boundary data source are in [lib/geo/README.md](lib/geo/README.md).

- **Autocomplete** (browser): suggestions are limited to the Philippines and to a rectangle around Luzon. A selected place is then checked against the Luzon coverage polygon in the browser. If it fails (for example Puerto Galera, Mindoro), the field shows the coverage message and no request is sent.
- **Typed places** (server): Places Text Search is biased toward Luzon. Google's best match is accepted only if its country is `PH` **and** its coordinates are inside Luzon coverage. "Cebu City", "Davao City", or "Tokyo" are rejected rather than replaced by a similarly named Luzon place.
- **Server validation** (`lib/routing/trip-validation.ts`): both ends, including coordinates sent from the browser, are re-checked before any Routes API request. Failures return HTTP 422 with `"This location is outside the supported Luzon coverage area. Please select a location within Luzon, Philippines."` and the field name.
- **Routes**: geometry is sampled about every 1 km. Routes that leave coverage (for example ferry routes to other islands) are dropped before tolls are calculated. If Google returns no route at all, the trip is rejected as not routable.
- **Expressway coverage**: each route is classified as using a supported expressway (priced from the rate database), using **ordinary roads only** (Google reports no toll road and no supported expressway matched, so it is shown as "₱0 · no expressway toll applies"), or using a **toll road outside the supported network** (never shown as free). When no route uses a supported expressway, the UI shows "No supported expressway toll route is available for this destination."
- **Toll plazas**: plaza locator records whose coordinates are off Luzon are bad geocodes and are ignored by the matcher. They are not deleted.

## Toll data management and automated updates

Plaza locations, rate approvals, automated source monitoring, and a data-quality dashboard live at **/admin/toll-data** (administrators only; requires `AUTH_ENABLED="true"`). Full operator guide: [docs/toll-data.md](docs/toll-data.md).

- Plaza locations are verified against named OpenStreetMap toll booths (© OpenStreetMap contributors, ODbL) that sit on the expressway's own road: `npm run toll:verify-plazas`.
- Monitored sources are checked daily and weekly (`npm run toll:monitor`, `npm run toll:monitor:weekly`, or `POST /api/internal/toll-monitor` with `CRON_SECRET`). Changes are staged with a difference report and used only after an administrator approves them; automatic publication is off by default and never applies to third-party estimates.
- TRB-approved adjustments reported by news outlets (`data/toll-rate-announcements.json`) are used to label matching rows *independently verified* and stale rows *superseded*: `npm run toll:setup-monitoring`.
- Every change is audit-logged and reversible (plaza batches, rate imports, and a database backup); see the rollback section of the guide.

## Google Cloud setup

1. **Project**: open <https://console.cloud.google.com/>, then create or select a project.
2. **Billing**: *Billing → Link a billing account*. Google Maps Platform APIs refuse requests without it, even inside the free monthly credit.
3. **Enable APIs** (*APIs & Services → Library*): **Maps JavaScript API**, **Places API (New)** (not the legacy "Places API"), and **Routes API**. The Geocoding and Directions APIs are not used.
4. **Create two keys** (*Google Maps Platform → Keys & Credentials → Create credentials → API key*):
   - **Browser key** → *Application restrictions*: Websites, with `http://localhost:3000/*` and your production origin(s), for example `https://tollmap.example.com/*`. *API restrictions*: Maps JavaScript API and Places API (New).
   - **Server key** → *Application restrictions*: IP addresses (your server's egress IPs; leave unrestricted only for local development). *API restrictions*: Routes API and Places API (New).
5. **Optional Map ID**: *Map Management → Create Map ID* (JavaScript, Vector), then set `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`.
6. Put the keys in `.env` (never commit it) and restart `npm run dev`.

## Troubleshooting

- **Grey map with "Google Maps rejected the browser API key"**: the key is wrong, the page origin is not in its HTTP-referrer list, the Maps JavaScript API is not enabled, or billing is off. The browser console shows the exact Google error (for example `RefererNotAllowedMapError` or `ApiNotActivatedMapError`).
- **"Suggestions are unavailable right now"** under a field: Places API (New) is not enabled for the browser key. Typed places still work through the server.
- **"Google Routes API rejected the server API key"**: enable the Routes API (and Places API (New)) for `GOOGLE_MAPS_SERVER_API_KEY`, and check its IP restriction.
- **"…billing is not enabled…"**: link a billing account to the project.
- **"Google Maps usage limits were reached"**: quota exhausted; check *Quotas* in the Cloud console.
- **A route shows "Incomplete toll data"**: Google returned the route, but a matched expressway segment has no plaza or rate record in the database. This is a rate-data gap, not a routing failure.

## Authentication and accounts

Route planning, map viewing, toll breakdowns, and fuel estimates remain public. Accounts are optional and add saved routes, saved vehicle profiles, preferences, and private calculation history. Registration requires email verification before password login.

Authentication is temporarily disabled by default while this project is under development. Set `AUTH_ENABLED="false"` to send visitors directly to the route-planning dashboard, hide account navigation, redirect account/login/register/recovery pages to `/`, and return `503` for account-authentication operations. The `/admin` route remains unavailable in this mode. No account data, migrations, or authentication code is removed. To restore the full Welcome, Login, Registration, Google, recovery, and account flows, change the variable to `AUTH_ENABLED="true"` and restart the application.

Before enabling registration, apply the reviewed migration with `npm run db:migrate`, then configure `AUTH_BASE_URL` and email delivery. In local development only, set `AUTH_EMAIL_DELIVERY="console"` to print verification and reset links in the server terminal. In production, set `EMAIL_FROM` and `EMAIL_API_KEY` for a Resend-compatible email API (or point `EMAIL_API_URL` at a compatible internal provider). Never set console email delivery in production.

Gmail SMTP is also supported. Enable 2-Step Verification on the sender Google account, create a Google App Password, then set `AUTH_EMAIL_DELIVERY="gmail"`, `GMAIL_USER` to that Gmail address, and `GMAIL_APP_PASSWORD` to the App Password. The app uses Gmail's `smtp.gmail.com` over port 465 with implicit TLS. Do not use the normal Gmail password; it will not work and must never be added to `.env`.

Google sign-in appears only when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_BASE_URL` are all configured. Register the callback URL as `<AUTH_BASE_URL>/api/auth/google/callback`; keep the client secret server-only.

Sessions are opaque, hashed in PostgreSQL, and sent only in HTTP-only cookies. User-owned API queries are restricted by the authenticated user ID. `/admin` is server-protected and requires the `ADMIN` role; promote the first administrator directly in PostgreSQL after verifying the intended account, for example: `UPDATE "User" SET "role" = 'ADMIN' WHERE "email" = 'you@example.com';`.

## Known baseline limits

This repository includes a verified SCTEX rate version and three disabled secondary matrix references (Toll.ph, Expressway.PH, and netPinoy Tollculator). Secondary matrices are useful change-detection signals only: they cannot be returned to customers, even if somebody accidentally marks a derived version as published. Confirm every changed value against a current TRB or operator notice, then import it under an official source.

## Automated secondary-matrix import

`npm run db:import:toll-ph` downloads Toll.ph's publicly rendered matrix and stages its rows in `MatrixImport`/`MatrixImportRow` with `PENDING_REVIEW` status. It records a content hash and does nothing when the downloaded snapshot is unchanged. It never creates or modifies a published `RateVersion`.

`npm run db:enrich:toll-plazas` is a separate, operator-run command that locates candidate plazas with Places API (New) Text Search (server key) from the latest staged import. It is intentionally not part of customer route calculation; it can create locator records but cannot publish or alter a toll amount. Review every generated plaza before relying on it for a customer-facing estimate.

For scheduled deployment, send a `POST` request to `/api/internal/toll-import/toll-ph` with `Authorization: Bearer <CRON_SECRET>`. Review the staged records against a primary TRB or expressway-operator notice before publishing any corresponding toll rates.

## Operational safeguards

- The current `/admin` page is a read-only monitoring surface. Keep it behind your deployment's authentication layer before exposing operational data publicly.
- This repository has no Prisma migration history yet. Back up production, establish a baseline migration in a staging clone, and use reviewed migrations for every schema change; do not use `db push` as a production deployment mechanism.
- There is no automatic publication path. A secondary matrix is never an official rate source and does not qualify a route for a verified total.

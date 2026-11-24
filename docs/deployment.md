# Vercel deployment guide

## Status and scope

This guide prepares a **Preview** deployment. Do not use the local PostgreSQL URL (`localhost:5432`) on Vercel: Vercel Functions cannot reach a database running on a developer's computer.

Authentication is currently intentionally disabled. Keep `AUTH_ENABLED="false"` for Preview and Production testing unless the account flows have separately been approved and configured.

## Database

Create hosted PostgreSQL databases before deploying. Use separate databases (or isolated database branches) for Preview and Production; do not point Preview at Production data.

Set these Vercel variables:

| Variable | Use | Environment |
| --- | --- | --- |
| `DATABASE_URL` | Direct, TLS-enabled hosted PostgreSQL URL used by Prisma CLI migrations. | Preview and Production, different values |
| `DATABASE_URL_POOLED` | Pooled PostgreSQL URL used by Vercel Functions at runtime. | Preview and Production, different values |

Run migrations against the target database before accepting traffic:

```sh
DATABASE_URL="<target direct URL>" npm run db:migrate
```

`db:seed`, toll imports, and toll-monitor scripts are explicit commands. They are not part of the Vercel build command and must not be used against Production without a reviewed data plan.

## Google Maps Platform

Set these values separately for Preview and Production:

| Variable | Required APIs | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Maps JavaScript API; Places API (New) | Restrict by HTTP referrer to the exact Preview/Production origins. This value is public by design. |
| `GOOGLE_MAPS_SERVER_API_KEY` | Routes API; Places API (New) | Server-only. Restrict it by server egress identity where the provider supports it. |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | Optional | Use a production Map ID; omit to use the development fallback. |

Google Maps Platform billing must be active. The current demo/onboarding project and a quota-exhausted key are not sufficient for public testing.

## Authentication

For the current public-only test phase, set:

```env
AUTH_ENABLED="false"
```

No email, Gmail SMTP, Google OAuth, or account secrets are required while authentication remains disabled. If it is later enabled, configure `AUTH_BASE_URL` to the deployed origin plus the email/OAuth variables documented in `.env.example` and `README.md`.

## Toll monitor Cron

`vercel.json` registers the existing daily schedule, `0 2 * * *`, against:

```
GET /api/internal/toll-monitor?trigger=daily
```

Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Add a long random `CRON_SECRET` to the **Production** environment before enabling the monitor. The endpoint rejects missing or incorrect secrets. It also uses a database-backed lease, stages changes for review, and keeps approved toll data unchanged when monitoring fails. Automatic publication remains disabled by default.

Vercel Cron runs on Production deployments, not Preview deployments. A weekly full re-validation is not configured because no schedule was previously specified; run it manually with an authorized `POST` request or add a reviewed second Cron entry later.

## Vercel settings and test sequence

1. Import the repository as a Vercel project. The framework/build command are auto-detected as Next.js / `next build`.
2. Add Preview variables first, using a dedicated Preview database and browser-key referrer for the Preview URL.
3. Apply the Preview migration and deploy a non-production branch.
4. Test page load, map loading, autocomplete, typed-place fallback, route calculation, toll estimates, error messaging, and the protected monitor endpoint returning `401` without its bearer secret.
5. Add distinct Production variables, migrate the Production database, restrict the production browser key to the production domain, then deploy Production.

Changes to Vercel environment variables require a redeployment.

## Safe rollback

Use Vercel's previous deployment rollback for application code. Do not roll back Prisma migrations by deleting database data. Before a schema migration or toll-data change, take a provider-managed database backup/snapshot and use the existing audited toll-data rollback tools only for their documented records.

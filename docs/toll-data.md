# Toll data: plaza locations, rates, and automated updates

This guide is for whoever maintains LUZON TOLLMAP's toll data. It covers where the data comes from, how updates are detected and approved, how to schedule the monitor, and how to roll changes back.

## Data model in brief

- **Plazas** (`TollPlaza`) have a location, aliases, an order along the road (`sequence`), a `verificationStatus` (`VERIFIED_GEODATA`, `NEEDS_REVIEW`, `SUSPECT`, `UNVERIFIED`) with the evidence in `verificationSource`, and an `active` flag. Plazas are never deleted; wrong or duplicate records are deactivated with a note.
- **Rates** come from two places:
  - *Official rate versions* (`RateVersion` + `TollRate`): effective-dated, never overwritten. A new version closes the previous one with `effectiveTo`.
  - *Matrix imports* (`MatrixImport` + rows): staged tables from a source. `PENDING_REVIEW` = proposed, not used. `PUBLISHED` = approved for display (as an estimate unless the source is authoritative). `EXPIRED` = superseded (kept). `REJECTED` = declined (kept).
- **Verification labels** shown to users and admins: Officially published, Independently verified (matches a TRB-approved rate reported by news outlets), Third-party estimate, Under review, Unverified, Superseded, Rejected. Rows labelled Superseded or Rejected are never priced; the route card explains why the fare is missing.
- **Change reports** (`RateChangeReport`) list changed, added, and removed fares, added and removed plazas, and vehicle-class changes for each proposed import. **Source checks** (`SourceCheck`) log every monitoring attempt. Every change is written to `AuditLog`.

## Sources

| Source | Kind | Used how |
|---|---|---|
| Toll.ph matrix | Third-party | Monitored daily (robots.txt allows); estimates only |
| ExpresswayPH expressway pages (NLEX–SCTEX, Skyway–SLEX–MCX, STAR, CALAX, CAVITEX, NLEX Connector) | Third-party | Monitored daily; estimates only |
| TRB toll-rate pages | Official regulator | **Manual import** – the site returns HTTP 403 to automated requests |
| NLEX Corporation, TPLEX | Official operators | **Manual import** – robots.txt disallows automated access |
| SMC Tollways (SLEX, Skyway, STAR, NAIAX, MCX), MPTC (CAVITEX, CALAX) | Official operators | **Manual import** – no permitted, machine-readable rate matrix |
| `data/toll-rate-announcements.json` | TRB-approved adjustments as reported by news outlets | Cross-check evidence; staged as a proposed import |
| `data/evidence/osm-toll-booths-2026-11-21.json` | OpenStreetMap toll booths (© OpenStreetMap contributors, ODbL 1.0) | Plaza locations |

The monitor never bypasses access restrictions: it reads robots.txt before every fetch and skips sources that do not permit automated access.

## Update workflow

```
Detected update → extraction (parser) → validation (Zod) → difference report → admin review → approval → publication
```

1. **Detection** (`lib/toll-data/monitor.ts`). Daily checks use `If-None-Match`/`If-Modified-Since` and a content hash, so unchanged documents are not reprocessed. The weekly check re-downloads and re-validates everything. A lease row stops two runs overlapping and expires on its own after a crash.
2. **Extraction and validation** (`parsers.ts`, `validation.ts`). Rows must have a known vehicle class and a positive whole-centavo fare. Conflicting duplicates or too few rows fail the import (a changed page format fails safely). Missing classes and partial matrices are flagged as incomplete. Rows whose entry equals exit are skipped.
3. **Difference report** (`diff.ts`) against the approved import from the same source. If every fare is unchanged, nothing is imported; an identical document is never imported twice.
4. **Review** in the admin page (*Toll data management → Rates & approvals*): compare current vs proposed fares, open the stored original document, then approve, reject, or later roll back.
5. **Publication** (`review.ts`). Approving makes the import the one in use and marks the previous one superseded. For authoritative sources with an effective date, official `RateVersion`s are created (`SCHEDULED` if the date is in the future). Publication refuses rates without an effective date or with plaza names that do not map to a known plaza.

**Failures** (source unavailable, format changed, extraction failed) are logged, approved rates are left untouched, administrators are alerted (audit log, plus e-mail when e-mail delivery is configured), and the source is retried after 1, 2, 4 … hours, capped at its normal interval.

**Automatic publication** is off by default (*Settings* tab). Even when enabled it applies only to authoritative sources that also opt in, and only to complete, validated matrices with an effective date. Third-party estimates, incomplete matrices, ambiguous plazas, invalid classes, unsourced rates, and uncertain effective dates are never published automatically.

## Scheduling

Run the monitor once a day and the full check once a week, either from the command line or through the HTTP endpoint:

```bash
npm run toll:monitor            # daily (conditional checks)
npm run toll:monitor:weekly     # weekly (full re-validation)

curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/internal/toll-monitor?trigger=daily"
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/internal/toll-monitor?trigger=weekly"
```

Example cron entries (02:00 daily, 03:00 on Sundays, Asia/Manila):

```
0 2 * * *  cd /srv/luzon-tollmap && npm run toll:monitor
0 3 * * 0  cd /srv/luzon-tollmap && npm run toll:monitor:weekly
```

On Windows, create two Task Scheduler tasks that run the same npm commands. Per-source intervals can be changed in the admin page; `CRON_SECRET` must be set to a long random value for the HTTP endpoint.

## Plaza locations

`npm run toll:verify-plazas` (dry run) writes a report to `data/reports/`; `-- --apply` applies it in one transaction. A location is accepted only when an OpenStreetMap toll booth has the plaza's name (after normalising spellings such as *Santo/Sto.* and suffixes like *Toll Plaza* or *Northbound Exit*), carries no conflicting operator tag, lies within 1 km of the expressway's own road (taken from Google Routes and checked with the route adapter), and the booths form one cluster on Luzon. Names that only match loosely (for example *Laguna Technopark* for *Technopark*) are reported for review, never applied. Records are deactivated only for hard evidence: a location outside Luzon, a failed geocode shared by several plazas, or a spelling duplicate.

## Manual imports

Official matrices (TRB or operator notices) are entered as a manual import through `POST /api/admin/toll-data/imports` with `sourceId`, `sourceUrl` (document reference), `effectiveFrom`, and `rows` (`entryExpresswayCode`, `exitExpresswayCode`, `entryName`, `exitName`, `vehicleClassCode`, `tollCentavos`, `reversible`). They go through the same validation, difference report, and approval as monitored sources.

## Rollback

- **Database backup** taken before the data changes: `backups/luzon_tollmap-2026-11-21T15-40-06-474Z.dump` (not committed). Full restore:
  `pg_restore --clean --if-exists -h localhost -U postgres -d luzon_tollmap backups/luzon_tollmap-2026-11-21T15-40-06-474Z.dump`
- **Plaza corrections**: each run is one batch, listed in `data/reports/plaza-verification-*.json` and the audit log. `npm run toll:rollback-plazas -- <batchId>` restores every changed record from the audit log (created plazas are removed, or deactivated if a rate refers to them). Batches applied on 2026-11-21: `plaza-verification-2026-11-21T16-02-21-910Z` and `plaza-verification-2026-11-21T16-04-46-542Z`.
- **Rate imports**: *Roll back* on an approved import (admin page) restores the import it superseded, withdraws any official versions it created, and reopens the previous versions.
- **Announcement labels**: the `RATE_ROW_VERIFIED` / `RATE_ROW_SUPERSEDED` audit entries record each row's previous label.
- **Schema**: migration `20261121000000_toll_data_verification_and_monitoring` only adds columns and tables.

## Regression checks

`npm test` includes unit tests, workflow tests on an isolated database schema (created and dropped by the test), and end-to-end trips on recorded Google routes against the live rate data. `npm run toll:regression -- <label>` prints the full breakdown for representative trips using live Google routes.

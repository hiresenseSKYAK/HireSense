# Fresh-job ingestion operations

HireSense serves its feed from MySQL. Provider calls run only in background
GitHub Actions; no homepage request waits for a provider. Existing IDs,
application URLs, interview routes and saved-job links are retained.

## Sources and cadence

`.github/workflows/crawl-jobs.yml` is the single schedule configuration:

| Source | Refresh | Status |
| --- | --- | --- |
| Greenhouse, Lever, Ashby | every 15 minutes | enabled, company boards in `backend/crawler/ats_registry.json` |
| LinkedIn and Handshake public discovery | every 6 hours | enabled; conservative existing cadence pending source-permission review |
| Adzuna official US API | hourly | disabled unless both Adzuna secrets are present |
| USAJOBS official search API | hourly | disabled unless both USAJOBS secrets are present |
| Link verification and stale cleanup | daily at 04:17 UTC | enabled |

GitHub scheduled workflows are best-effort, not a real-time SLA. A Render cron
job or always-on background worker may replace GitHub Actions, but **do not run
both schedulers concurrently**. Render must run the same commands with the
same MySQL credentials: `python -m database.migrate` first, `python -m
crawler.crawl --source ats --limit 300 --skip-cleanup` every 15 minutes,
separate `linkedin` and `handshake` crawls every 6 hours, `adzuna` and
`usajobs` hourly, and
`python -m services.updater` plus `python -m scripts.cleanup_stale_jobs
--apply` daily. Working directory is `backend`; install
`requirements-crawler.txt`. Disable Adzuna/USAJOBS tasks until their keys and
terms are approved. Do not attach this to the Render web request process.

## Credentials and onboarding

Existing `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` are required
for the crawler. Adzuna requires `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`; register
at [Adzuna Developer](https://developer.adzuna.com/) and review its
[API terms](https://developer.adzuna.com/docs/terms_of_service) before turning
it on. USAJOBS requires `USAJOBS_EMAIL` and `USAJOBS_API_KEY`; request the key
through [USAJOBS Developer](https://developer.usajobs.gov/). Both providers
remain off without complete credentials. Secrets belong in GitHub Actions
secrets or Render environment settings, never in `ats_registry.json` or logs.
Adzuna's current terms require a visible, linked Adzuna attribution on each
displayed ad and set default API quotas; the UI includes this attribution.
Verify that the intended ongoing use is licensed before adding credentials.

To add a company board, add `{company, provider, board_identifier,
enabled}` to the JSON registry and validate the board ID. The provider must be
`greenhouse`, `lever`, or `ashby`. Sync dates, failures and last job counts are
kept in `job_source_health`; they do not need manual registry edits. Large
registry expansions should be batched within the 15-minute run budget and
their public feed terms checked.
The initial registry preserves the six prior boards and adds Shield AI's
Lever board, which currently lists a Dallas-eligible summer software intern
role. This is a source expansion, not a claim that the role will remain open.

## Identity, freshness and failure safety

The first successful insert sets `first_seen_at` once. Every observed record
updates `last_seen_at`; direct employer and USAJOBS records also update
`last_verified_at`. Source `date_posted` is stored only when the source
provides a trustworthy publication date. `source_updated_at` is independent.
For Adzuna, `created` is the aggregator's ad date, not proof of the employer's
original publication time; the source badge and apply redirect remain visible.
The UI calls `first_seen_at` “New to HireSense,” never “Posted.” A local,
per-user last-visit marker drives “New for you.”

Stable provider IDs and canonical URLs resolve updates. `job_source_alias`
retains secondary provider IDs after a stronger source wins. Feed-level
dedupe also compares normalized company/title/location and near-identical
descriptions. Direct ATS wins over government, then Adzuna, then discovery
reposts. A provider exception is isolated and recorded without emptying the
database. 429s trigger a one-hour provider cooldown. Link checks treat
403/429/5xx and transport errors as inconclusive. Two explicit 404/410 or
closed-page observations are required to close a job. Daily stale cleanup
marks a record stale only after 45 days absent from a complete, successful
direct-feed snapshot, with no recent verification; it never deletes rows.
Reappearance reactivates a record.

## Diagnostics and rollout

Run `python -m scripts.report_ingestion_health` privately from `backend` for
per-source success/failure times, failure counts, last job count, duration and
rate-limit state, plus jobs added today, lifecycle counts, early-career/tech/
DFW coverage and visible duplicate rate. Broken-link rate and resume relevance
remain unreported until a live validation sample/user context exists. Crawl logs report
fetched, inserted, updated, duplicates merged, closure signals, fetch errors
and duration without URLs containing credentials. Do not expose the health
report as a public route.

Roll out by backing up MySQL, applying migration 006, then deploying code and
the scheduler. Run one manual workflow dispatch and inspect health before
relying on cadence. `first_seen_at` for legacy records remains the date it
was originally introduced by migration 003, not a reconstructed publication
date. No live provider volume or broken-link percentage can be guaranteed
without keys and a production run. Target a curated 300–1,000 relevant fresh
DFW/remote technical roles, not raw nationwide volume. The default feed is
DFW plus US remote; the user can explicitly select remote, Texas or
nationwide. Ranking favors early-career tech, DFW, freshness, and direct
sources while leaving explicit broader filters available.

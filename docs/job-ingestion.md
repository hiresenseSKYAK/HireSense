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
| Link verification and 30-day age expiry | daily at 04:17 UTC | enabled |
| Employer-board disappearance check | every ATS run (15 minutes) | enabled; part of `crawler.crawl --source ats` |

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
database. 429s trigger a one-hour provider cooldown.

## Salaries

Each job stores one yearly figure: the midpoint of the posted range, converted to a yearly amount when the pay is hourly, daily, weekly, or monthly. ATS boards and Handshake provide structured pay data; LinkedIn and Handshake descriptions are read with `_extract_salary_from_description` and `_normalize_salary_to_annual` in `crawler/parsers/linkedin.py`.

Safeguards against inflated salaries:

- Salary text that says it is yearly ("annually", "per year", "/yr") is never multiplied.
- Work-schedule phrases near the pay ("5 days per week", "40 hours a week") are ignored when guessing the pay period.
- Amounts of $15,000 or more are never treated as hourly, daily, or weekly pay. This also covers Handshake postings that label a monthly or yearly amount as hourly.
- A yearly result over $500,000 is discarded (`MAX_ANNUAL_SALARY`, and `MAX_STORED_SALARY` in `database/queries.py`), so the job shows "Not listed", or the description is used when the structured value was the bad one.

To repair salaries saved before these rules, run `python -m scripts.fix_salaries` from `backend` (dry run), then `python -m scripts.fix_salaries --apply`.

## Job lifecycle: when a job leaves the feed

A job is hidden (never deleted) by whichever of these happens first. Hidden
rows keep their ID so interview history and old links keep working.

1. **30-day age limit (`status = 'expired'`).** A job's age is its source
   `date_posted`; when the source gives no posting date, the day the crawler
   first found it (`first_seen_at`) is used. The API never returns a job older
   than 30 days, and the daily `scripts.cleanup_stale_jobs --apply` step marks
   those rows `expired`. Change the limit with the `JOB_MAX_AGE_DAYS`
   environment variable.
2. **Gone from the employer's own board (`status = 'closed'`).** After every
   complete, error-free Greenhouse/Lever/Ashby crawl of a board (the board was
   not cut off by the per-search limit), jobs listed on it reset
   `missed_snapshots` to 0 and that board's other active jobs get +1. A job
   missing from **two complete crawls in a row** (about 30 minutes at the
   15-minute cadence) is closed. A board that returns zero jobs is ignored
   rather than closing everything. Requires migration 008.
3. **Dead application link (`possibly_closed`, then `closed`).** The daily link
   checker (`services.updater`) now checks every visible job, not only old
   ones: never-checked jobs first, `possibly_closed` jobs daily, everything
   else every 3 days.
   - **LinkedIn jobs** are checked through LinkedIn's public guest endpoint
     (`/jobs-guest/jobs/api/jobPosting/<id>`), because the normal
     `linkedin.com/jobs/view/...` link always answers automated requests with
     a redirect or login wall and could never be classified. When LinkedIn
     itself shows "No longer accepting applications" (or the posting returns
     404), the job is closed immediately. LinkedIn checks are spaced 2 seconds
     apart and pause 30 seconds after a 429.
   - **Other links** are followed through redirects. A final 404/410 or an
     explicit "no longer accepting" page marks the job `possibly_closed`, and
     a second confirmation at least a day later closes it.
   - 403/429/5xx, timeouts, and a redirect that ends on a normal page (for
     example a company careers home page) are treated as "can't tell" and
     never close a job; those jobs leave through the 30-day age limit instead.
   - The checker stops after `UPDATER_MAX_RUNTIME_SEC` (default 25 minutes)
     so the daily job finishes inside the 45-minute workflow timeout;
     unchecked jobs go first the next day.

Hidden jobs stay hidden when a crawler sees them again:

- `expired` jobs come back only if the source now reports a posting date
  within the age limit (a genuine repost).
- `closed` jobs come back only if they reappear on their employer's own board
  (Greenhouse/Lever/Ashby). Showing up again in a LinkedIn or Handshake search
  is not enough.

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

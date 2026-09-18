# Job identity migration

These migrations add bounded, indexed identity fields without changing the
existing job type columns or deleting rows. `application_link` and
`canonical_url` stay unindexed because their 1,000-character size is not a
portable MySQL unique-key target.

## Empty production database

From `backend`, run `python -m database.migrate`. The runner records each
successfully applied migration in `schema_migrations`, skips recorded versions,
and fails loudly on SQL errors. It never drops job data or prints credentials.

## Populated legacy database

1. Back up the database.
2. Run `001_add_job_identity_columns.sql`.
3. Preview the backfill from `backend` with
   `python -m database.backfill_job_identity`.
4. If the preview reports no collisions, apply it with
   `python -m database.backfill_job_identity --apply`.
5. Run `002_add_job_identity_indexes.sql`.
6. Run `003_add_job_lifecycle.sql`.

If the preview reports a collision, it performs no writes. Review those row IDs
before applying the backfill or creating the indexes. Existing rows and the
legacy `unique_link` index are left in place.

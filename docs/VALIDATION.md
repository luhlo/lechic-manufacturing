# Validation evidence

> Historical initial-build/QA report. The current static Pages deployment changes and checks are in [DEPLOYMENT-VALIDATION.md](DEPLOYMENT-VALIDATION.md).

## Automated domain and persistence tests

`npm test`: 31 tests across domain, recovery and PostgreSQL integration suites. They cover timestamp-derived totals, the exact 61/4/5/70-minute example, weighted rates and zero duration/quantity, search, position filtering, current assignments, timezone-aware KPI fallback, all state transitions, durable offline replay, lost server responses, partial endpoint failure, storage failure, expired-credential responses, stale revisions, cross-tab serialization and completion receipt retention.

PostgreSQL integration applies every migration in sorted order to PGlite with synthetic Supabase auth helpers, then runs two transactional SQL suites. The same SQL suites also passed on the actual hosted Supabase project using its real auth schema and database roles. SQL assertions cover anonymous denial, RLS isolation, direct-write denial, capability roles, escalation attempts, live deactivation, last-administrator protection, individual segment integrity, exact rates, idempotency of each command, assignment lifecycle/cancellation/identity freeze, immutable historical names/targets, baseline aggregation, KPI visibility and version guards. PGlite is not presented as hosted Auth verification.

## Live browser tests

Real Chrome against local application code and the real Supabase Auth/Data APIs, using temporary confirmed QA accounts with random passwords. No demo adapter or mocked manufacturing endpoint was used for these checks. The accounts and their data were removed afterward.

- `tests/browser-qa.mjs`: actual password sign-in, worker-only navigation/activities, assigned designs, full/partial/case-insensitive SKU and name searches, rapid double taps, WORK/WALKING/INTERRUPTION, refresh and close/reopen in all states, Chrome lifecycle suspension, offline transitions/finish/quantity and reconnect replay, assignment completion disappearing from today's list, immediate next session and quantity zero. Employee screens checked at 320, 375, 390, 430 pixels; no horizontal overflow. Management routes checked at 1440 pixels. No uncaught browser errors.
- `tests/admin-browser-qa.mjs`: position create/edit/deactivate, employee create/position/deactivate, design create/edit, activity create/edit/deactivate/position link, assignment with optional quantity/date/notes, activity/design KPI, custom capability role and role assignment, all three visibility settings. All six analytics filters verified by changes in returned/displayed manufacturing data. No uncaught browser errors.
- `tests/pwa-browser-qa.mjs`: production build, valid standalone manifest/icons, first-visit precache, service-worker update waits while a session is active, session survives activation after closing, offline refresh and close/reopen in every state, offline completion and real reconnect, no Auth/manufacturing responses in CacheStorage. No uncaught browser errors.

Browser tests need Playwright, Chrome, a dedicated seeded QA database and `QA_CREDENTIALS` pointing to a temporary JSON file with `admin`, `worker`, `password`. `PLAYWRIGHT_MODULE` can identify an installed Playwright directory. Use `QA_ORIGIN` for the dev/production preview origin. These scripts mutate QA data; do not run with production employee accounts. The PWA test temporarily changes `dist/client/sw.js` to simulate an update and restores it in `finally`.

## Cloud security and remaining limits

Security advisors reported no WARN/ERROR findings. Three INFO notices identify intentionally policy-free private tables (receipts, target snapshots, audit log): authenticated clients have no table access, and checked private functions own their access. See [Supabase's policy-free RLS explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). The two missing foreign-key indexes identified by performance advisors were added. Unused-index INFO notices are expected for an empty database.

Email confirmation/reset delivery, production SMTP and physical iPhone/Android installation/lock behavior still require launch acceptance. A real JWT lifetime was not waited out; expired-credential responses are covered by the durable retry tests. Browser/OS removal of local storage cannot preserve unsynced work. Very large date ranges can still return many selected sessions to an analyst, although workers never fetch manufacturing history and prior baseline history stays on the server.

Type checking, ESLint and the production build are required final checks. See AUDIT.md for the final result and readiness assessment.

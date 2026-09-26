# Static Pages deployment verification

> Historical Cloudflare preparation. The current requested host is GitHub Pages; see [GITHUB-PAGES.md](GITHUB-PAGES.md).

Executed 2026-09-25 America/Chicago (2026-09-26 UTC).

| Check | Result |
| --- | --- |
| Fresh `npm ci` | PASS; lockfile corrected and clean install verified |
| `npm test` | **44 passed**: original 31 regressions plus 13 deployment/configuration/route cases |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS; no warnings/errors |
| `npm run build` | PASS; static `dist/` with HTML, JS/CSS, icons, manifest, headers and SW |
| Static output verifier | PASS; root-relative existing assets, valid manifest, native SPA output, no server/Worker/Functions/404, versioned SW without forced activation, no private key forms |
| Invalid production configuration | Actual builds reject missing public key, secret-key format and an unrelated Supabase URL |
| Environment isolation | Two synthetic private-variable canaries supplied during a successful build were absent from every output file |
| Git credential checks | No matching private-key/token/connection-string patterns in tracked source or existing commit diffs; only `.env.example` tracked; generated/dependency/tool directories not tracked |
| Backend preservation | Session engine, timestamp domain logic, demo engine, SQL migrations/tests/bootstrap unchanged; no hosted Supabase calls or changes in this phase |

The production build emits one non-blocking Vite warning about the main JavaScript chunk exceeding 500 kB (approximately 688 kB minified / 198 kB gzip). No unrelated code splitting or product redesign was added in this deployment pass.

## Browser checks against the built output

`tests/static-browser-qa.mjs` ran in installed desktop Chrome against **Wrangler's local Pages static runtime**, with the existing **isolated sample workspace**. This is not a claim of live Cloudflare production deployment or live Supabase end-to-end verification. The test blocked all external requests; none were attempted. There were zero uncaught JavaScript errors.

- `/login`, `/admin`, `/admin/employees`, `/admin/activities`, `/admin/assignments`, `/admin/kpis`, `/analytics` directly loaded and refreshed, retained their URL, and showed sign-in before authentication.
- Sample administrators opened each deep link and its intended existing screen, refreshed successfully, and used URL navigation plus browser Back/Forward. Desktop layout checked at 1440px.
- Employee screens checked for horizontal overflow at **320, 375, 390 and 430px**: activity choice, assignments, start confirmation, Working, Walking, Interruption, quantity entry, completion.
- Manifest JSON, root scope/start/id, standalone display and actual 192px/512px/maskable PNG dimensions checked. Service worker controlled the page; update headers had `no-store` and root scope.
- A changed production SW installed and **waited while the active session stayed open**. After closing/reopening, the new worker activated and the **same session ID and starting timestamp** remained.
- Offline refresh and close/reopen restored Working, Walking and Interruption. Unfinished quantity entry and the saved completion receipt survived reload. Reconnection replayed pending transitions/quantity and enabled the next activity.
- CacheStorage contained only same-origin static files, with no manufacturing/Auth/REST responses. Visual screenshots of the mobile timer and desktop Employees screen were reviewed.

The build preserves the original authenticated Supabase integration and durable session logic. SQL/session recovery regression tests use isolated PGlite and test persistence adapters. Prior live Supabase QA is recorded separately in `AUDIT.md`; it was not repeated by modifying production data during this deployment phase.

## Not yet verified / remaining setup

- Manufacturing GitHub destination/remote and push: pending the repository URL; local deployment changes are committed on `main`.
- Actual Cloudflare Pages creation, automatic GitHub build, final HTTPS URL and production headers: pending authenticated Cloudflare setup.
- Supabase Site URL/redirect allowlist: must be configured after the actual Pages origin exists. No hostname was guessed.
- Real confirmation/reset email delivery, actual iPhone/Android installation, OS screen lock/background behavior, and a live authenticated production session/update: require the final host and real devices. Local responsive/browser tests do not certify these.

See `DEPLOYMENT.md` for exact settings and steps. Before changing origins, sync pending work on the old Site; browser storage and installed PWAs do not migrate automatically to another hostname.

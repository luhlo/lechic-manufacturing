# Le Chic Manufacturing

An independent manufacturing activity, time and productivity PWA for Le Chic Miami.

**Live app:** [Le Chic Manufacturing](https://lcwork.luhlo.com/).

**Connected to the independent Supabase project `bbbgrxvidrlmrrezfmil` (Le Chic Manufacturing), in organization “le chic”.** The QA stabilization pass applied three migrations, verified live PostgreSQL/RLS and real Supabase password sign-in, and exercised the browser workflows. All temporary test accounts and manufacturing records were removed. The administrator email `lechicmiami@gmail.com` is reserved; the owner sets the first administrator password through Supabase’s Create user form; subsequent accounts are created inside Employees → Login options. See `docs/AUDIT.md` for evidence and launch requirements. Relay and Commissions were not modified.

## Deploy to GitHub Pages

The frontend is a **static React + TypeScript + Vite PWA**, with Supabase as its backend. `.github/workflows/pages.yml` checks and deploys pushes to **`main`**. Enable **GitHub Actions** as the repository's Pages source and set the two public Actions variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

The workflow derives the base path from Pages (now `/` for the custom domain), runs `npm ci` and `npm run verify`, and publishes **`dist`**. Physical route directories allow direct links and refresh on GitHub Pages. PWA icons, caches, installation scope and Auth callbacks use the same base.

See [GitHub Pages setup, status and verification](docs/GITHUB-PAGES.md). Source repository: [luhlo/lechic-manufacturing](https://github.com/luhlo/lechic-manufacturing). Pages, the public build variables, and Supabase's production Site URL and redirect URL are configured. [The first successful deployment](https://github.com/luhlo/lechic-manufacturing/actions/runs/36213898399) passed all 46 tests, TypeScript, lint and the production build. The earlier Cloudflare setup is retained as historical documentation.

```sh
npm ci
# Copy .env.example to .env.local and supply the public key.
npm run verify
npm run dev
```

Before switching from the existing review Site to the new GitHub URL, wait for **Synced** on the old origin. Sign in again on the new origin to recover the same server session. Pending offline events cannot move between origins.

See [position access, OM setup, optional PIN expiration, and current tests](docs/POSITION-ACCESS.md).

## What is implemented

- Mobile employee workflow: position-specific activity tiles, current assignments first, forgiving design/SKU search, Work / Walking / Interruption controls, Finish then quantity.
- Timestamp-based sessions and individually persisted segments; one active session per employee, atomic transitions, idempotency keys, revision conflict checks, IndexedDB recovery and ordered offline replay.
- Previously signed-in employees can start and complete multiple activities offline using their saved catalog. The header shows Offline and pending events; reconnect/focus automatically retries in order. Cached identity is only for local recovery: the server rechecks current access, workflow settings, ownership, revisions and overlapping work. Starts older than 30 days require review. New sign-ins, creating activities and management changes require internet. Keep the same browser/device and do not clear its storage before syncing.
- Designs support optional HTTPS image links. Blank or failed images render nothing; previously loaded images are cached where browser storage permits. Uncached images need internet.
- Private Google Sheet setup is under Designs → Google Sheet. The bound Apps Script sends only Name, SKU and optional Image URL from the selected tab, approximately every five minutes after Google authorization. Its scoped token can only upsert designs, is stored hashed on the server, and stops working when disconnected, rotated, or its owner's access is revoked. Match by canonical SKU; retain existing IDs, inactive state and work history. Missing name/SKU rows wait; duplicate SKUs reject the batch. Blank Image URL clears the image, an omitted image column preserves existing images, and removed rows never delete designs.
- Supabase email-or-username/password sign-in and automatic four-digit PIN sign-in on approved studio browsers; persisted sessions, administrator-created accounts (public signup is disabled), password recovery, configurable roles, employee/position role grants, RLS and backend authorization.
- Management screens for employees, positions, roles/capabilities, activities, designs, assignments, versioned KPIs, settings and analytics.
- KPI hierarchy: activity + design, then activity. Employee visibility defaults to OFF, with TARGET_ONLY and TARGET_AND_ACTUAL modes. Historical target snapshots are retained privately.
- Analytics: productive/walking/interruption/elapsed time, units, weighted production rates, walking event counts and averages, date/employee/position/activity/design/SKU filters, drill-down and historical baseline comparisons.
- PWA manifest, local icons, production service worker, responsive layouts and an authenticated workspace. The public sample-data entry has been removed.

## Files to know

- `components/manufacturing/employee.tsx`: the employee screens and large timer controls.
- `components/manufacturing/management.tsx`: management forms and permissions.
- `components/manufacturing/login-form.tsx` and `login-settings.tsx`: sign-in and manager login controls. See [username and PIN setup](docs/LOGIN.md).
- `supabase/functions/manufacturing-login/`: server-side username/password verification, PIN exchange and protected credential/device management.
- `components/manufacturing/analytics.tsx`: filters, summaries and comparisons.
- `lib/manufacturing/domain.ts`: pure time, search and KPI calculations.
- `lib/manufacturing/api.ts`: Supabase access, IndexedDB and offline command replay.
- `lib/manufacturing/demo.ts`: local test fixtures only; excluded from the production app.
- `app/globals.css`: colors, spacing, controls and responsive layout.
- `supabase/migrations/`: database structure, authorization and session operations.
- `docs/SETUP.md`: required cloud setup, environment variables, administrator and rollout.
- `docs/ARCHITECTURE.md`: Relay inspection, implementation decisions and tradeoffs.
- `docs/VALIDATION.md`: completed tests and limitations.

See `docs/SETUP.md` for installation and production setup. Do not point this application at Relay's database.

# Le Chic Manufacturing

An independent manufacturing activity, time and productivity PWA for Le Chic Miami.

**Live app:** [Le Chic Manufacturing](https://luhlo.github.io/lechic-manufacturing/).

**Connected to the independent Supabase project `bbbgrxvidrlmrrezfmil` (Le Chic Manufacturing), in organization “le chic”.** The QA stabilization pass applied three migrations, verified live PostgreSQL/RLS and real Supabase password sign-in, and exercised the browser workflows. All temporary test accounts and manufacturing records were removed. The administrator email `lechicmiami@gmail.com` is reserved; the owner still creates their own password. See `docs/AUDIT.md` for evidence and launch requirements. Relay and Commissions were not modified.

## Deploy to GitHub Pages

The frontend is a **static React + TypeScript + Vite PWA**, with Supabase as its backend. `.github/workflows/pages.yml` checks and deploys pushes to **`main`**. Enable **GitHub Actions** as the repository's Pages source and set the two public Actions variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

The workflow derives the repository base path, runs `npm ci` and `npm run verify`, and publishes **`dist`**. Physical route directories allow direct links and refresh on GitHub Pages. PWA icons, caches, installation scope and Auth callbacks use the same base.

See [GitHub Pages setup, status and verification](docs/GITHUB-PAGES.md). Source repository: [luhlo/lechic-manufacturing](https://github.com/luhlo/lechic-manufacturing). Pages, the public build variables, and Supabase's production Site URL and redirect URL are configured. [The first successful deployment](https://github.com/luhlo/lechic-manufacturing/actions/runs/36213898399) passed all 46 tests, TypeScript, lint and the production build. The earlier Cloudflare setup is retained as historical documentation.

```sh
npm ci
# Copy .env.example to .env.local and supply the public key.
npm run verify
npm run dev
```

Before switching from the existing review Site to the new GitHub URL, wait for **Synced** on the old origin. Sign in again on the new origin to recover the same server session. Pending offline events cannot move between origins.

## What is implemented

- Mobile employee workflow: position-specific activity tiles, current assignments first, forgiving design/SKU search, Work / Walking / Interruption controls, Finish then quantity.
- Timestamp-based sessions and individually persisted segments; one active session per employee, atomic transitions, idempotency keys, revision conflict checks, IndexedDB recovery and ordered offline replay.
- Supabase email/password sign-in, persisted sessions, preauthorized employee enrollment, password recovery, configurable roles, employee/position role grants, RLS and backend authorization.
- Management screens for employees, positions, roles/capabilities, activities, designs, assignments, versioned KPIs, settings and analytics.
- KPI hierarchy: activity + design, then activity. Employee visibility defaults to OFF, with TARGET_ONLY and TARGET_AND_ACTUAL modes. Historical target snapshots are retained privately.
- Analytics: productive/walking/interruption/elapsed time, units, weighted production rates, walking event counts and averages, date/employee/position/activity/design/SKU filters, drill-down and historical baseline comparisons.
- PWA manifest, local icons, production service worker, responsive layouts, and an isolated sample workspace.

## Files to know

- `components/manufacturing/employee.tsx`: the employee screens and large timer controls.
- `components/manufacturing/management.tsx`: management forms and permissions.
- `components/manufacturing/analytics.tsx`: filters, summaries and comparisons.
- `lib/manufacturing/domain.ts`: pure time, search and KPI calculations.
- `lib/manufacturing/api.ts`: Supabase access, IndexedDB and offline command replay.
- `lib/manufacturing/demo.ts`: sample data only; never used for production records.
- `app/globals.css`: colors, spacing, controls and responsive layout.
- `supabase/migrations/`: database structure, authorization and session operations.
- `docs/SETUP.md`: required cloud setup, environment variables, administrator and rollout.
- `docs/ARCHITECTURE.md`: Relay inspection, implementation decisions and tradeoffs.
- `docs/VALIDATION.md`: completed tests and limitations.

See `docs/SETUP.md` for installation and production setup. Do not point this application at Relay's database.

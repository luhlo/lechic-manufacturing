# Cloudflare Pages deployment

> Historical Cloudflare preparation. The current requested host is GitHub Pages; see [GITHUB-PAGES.md](GITHUB-PAGES.md).

## Status and architecture

The original project used React 19 + TypeScript inside the Sites Vinext/Vite starter, producing a Cloudflare Worker (`dist/server`) and client assets (`dist/client`). The manufacturing application did not use server rendering, server actions, API routes, D1, R2, or ChatGPT server authentication. Its backend is Supabase.

It now builds as a React 19 / TypeScript / Vite 8 static SPA in **`dist/`**. The UI components, timestamp/session engine, IndexedDB names, Supabase Auth storage key, RPCs, database migrations and permission model are preserved. Next/Vinext and unused starter server/D1 wrappers were removed. The lint configuration keeps the existing React/hooks/TypeScript/accessibility checks without Next's server parser. `.openai/hosting.json` records the older review Site; Pages does not read it. No GitHub Pages workflow existed in this checkout.

No production Cloudflare hostname has been assigned or verified. The local checkout is on `main` and had no GitHub remote when inspected. The connected GitHub account exposed only Relay and Commissions; neither is this application's destination. Cloudflare's CLI is not authenticated here. The previous private Sites deployment remains unchanged.

## Exact Pages settings

| Setting | Value |
| --- | --- |
| Project type | **Pages**, connected to GitHub |
| Framework preset | **None** (explicit Vite build below) |
| Production branch | `main` |
| Root directory | Repository root, where this `package.json` lives |
| Build command | `npm run verify` |
| Output directory | `dist` |
| Node | `24.19.0`, from committed `.node-version` |
| Build system | Current Pages build image / v3 |
| Install | Pages installs from `package-lock.json`; local clean verification uses `npm ci` |
| Worker / Functions / bindings | None |

`npm run verify` runs tests, TypeScript, lint and then `npm run build`. The underlying static build command is **`npm run build`** (`vite build` followed by service-worker precaching). Pages' Git integration builds pushes to the production branch automatically. Keep automatic production builds enabled. The app must be served at the origin root, not a GitHub-style repository subpath. See [Pages GitHub integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/) and [build image overrides](https://developers.cloudflare.com/pages/configuration/build-image/).

## Environment audit

| Variable | Safe in browser? | Add to Pages? | Reference / use |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes: project API URL | **Production: required** | `vite.config.ts` → `build/public-env.ts` → explicit build substitution in `src/main.tsx` → `clientFor` in `lib/manufacturing/api.ts` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes, **only** a publishable key or legacy `anon` JWT | **Production: required** | Same path; supplied to Supabase's browser client |
| `NODE_ENV` | Yes: build mode only | No manual setting | Vite supplies `production` for builds; `components/manufacturing/app.tsx` registers the SW only in production |
| `NODE_VERSION` | Build setting, not app data | Optional override only | Pages can override `.node-version`; normally leave unset |
| `QA_ORIGIN` | Local test URL, not bundled | No | Browser QA scripts |
| `QA_ARTIFACTS` | Local output path, not bundled | No | `tests/browser-qa.mjs`, `tests/static-browser-qa.mjs` |
| `PLAYWRIGHT_MODULE`, `CHROME_PATH` | Local tool paths, not bundled | No | Browser QA scripts |
| `QA_CREDENTIALS` | **No**: path to private dedicated-QA credentials | **Never** | Existing live browser QA scripts only; not used by static deployment tests |

Set the URL to **`https://bbbgrxvidrlmrrezfmil.supabase.co`**. Copy this project's **publishable** key from Supabase → Project Settings → API Keys, or from the existing local `.env.local`. The actual key is deliberately not repeated here. Do not use `sb_secret_…`, a `service_role` JWT, a database connection string/password, an administrator password, a personal access token, or a Cloudflare token. No private credential is required for this static deployment.

Only the two explicitly selected public values are substituted into the client. Vite's automatic environment-prefix exposure is disabled. Builds reject missing values, placeholder/private keys and another project URL. This is validation of configuration shape; it does not authenticate a key. Public keys are expected to appear in browser JavaScript; Supabase authentication and RLS enforce data access. `.env*` is ignored except `.env.example`; generated output, dependencies and local tool state are ignored.

These are **build-time** values. Redeploy after changing them. Keep branch previews disabled initially: a preview given the same values would reach the same production database. If deliberately enabling preview builds, configure the same public variables in Preview and treat that app as production-data access; never add secret keys. [Vite environment handling](https://vite.dev/guide/env-and-mode).

Former Sites/Worker tool variables (`SITES_*`, `WRANGLER_*`, `MINIFLARE_*`, `CLOUDFLARE_CF_FETCH_ENABLED`, `CODEX_SANDBOX`, and local install helper settings) are no longer referenced by the application build and are not required in Pages. Wrangler remains a development dependency only for testing the static Pages runtime.

## Remaining steps

1. Choose or create an **independent manufacturing repository** on GitHub. Keep the app contents at its repository root. Do not use Relay or Commissions. Once its URL is known, add that URL as this checkout's `origin` and push `main`. If the destination already contains work, inspect it before integrating; never force-push over it.
2. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git** (the dashboard may label this “Import an existing Git repository”). Authorize access to the manufacturing repository only and select it. Use the settings above and add the two public Production variables.
3. Disable automatic branch previews for now. Save and deploy. A successful build should show tests passing and publish `dist/`; no server/Worker entry point or bindings are needed.
4. Copy the **actual stable production HTTPS origin** shown by Cloudflare. Do not use a per-commit preview URL. No hostname in this document is an assigned Pages URL.
5. Update Supabase Auth URLs as below. Then open the Pages URL on the phone and computer, set the owner’s password through Supabase’s administrator-only **Create new user** form, then sign in. Public registration is disabled; see `docs/LOGIN.md`. The preauthorized administrator is `lechicmiami@gmail.com`.
6. Complete the real-device and Auth checks below before using live manufacturing sessions. Subsequent pushes to `main` rebuild the same Pages project.

Do not create a Direct Upload project as a shortcut if GitHub automatic builds are desired; create the Git-connected Pages project at the outset. [Cloudflare Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/).

## Supabase Auth URLs after Cloudflare assigns the hostname

In the **existing** project `bbbgrxvidrlmrrezfmil`, open **Authentication → URL Configuration**. Let `PRODUCTION_ORIGIN` mean the actual HTTPS origin copied from Cloudflare, with no path or trailing slash. This is notation, not a literal value to paste.

- **Site URL:** set to `PRODUCTION_ORIGIN`.
- **Redirect URLs:** add `PRODUCTION_ORIGIN` and `PRODUCTION_ORIGIN/`. The app passes `location.origin` for both signup confirmation and password reset; no `/auth/callback` endpoint is required.
- Keep existing authorized review/local URLs only while those environments are still in use. Local development callbacks use `http://127.0.0.1:5173` (or `http://localhost:5173` if you open it that way). Local production QA can use `http://127.0.0.1:5175` when deliberately testing Auth there.
- Do not add a broad wildcard for arbitrary preview domains. If introducing a custom domain later, update Site URL, redirects and bookmarks to that actual origin.

Keep email confirmation enabled. Production SMTP and actual signup/reset email delivery still require verification. No database, RLS, Auth settings, accounts or SMTP settings were changed in this deployment pass. [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Routing and PWA behavior

Pages provides its native static SPA fallback because the output contains `index.html` and no top-level `404.html`. This serves deep routes as the shell while retaining their URL and serving existing assets normally. There is deliberately no `_redirects` catch-all: the Pages runtime canonicalizes explicit `index.html` rewrites, which can lose the requested screen URL. The build verifier enforces this SPA output contract. `lib/manufacturing/routes.ts` maps paths to the existing screens and supports browser Back/Forward. Direct links still require Supabase sign-in and the existing capabilities. [Pages redirects](https://developers.cloudflare.com/pages/configuration/redirects/) and [SPA serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/).

The manifest retains root `id`, `start_url` and `scope`, standalone display, theme colors, and 192px/512px/maskable icons. `index.html` retains Apple installation metadata. All asset paths use the root base `/`.

The build fingerprints file **contents**, shell HTML, icons, manifest and service-worker source. Each revision precaches only those static files. The worker excludes cross-origin requests, so Supabase Auth/REST/RPC data never enters CacheStorage. It also excludes same-origin API paths. The offline HTML stays paired with that worker's precached assets. Navigation tries the network, then the precached shell offline. `public/_headers` makes the shell revalidate and prevents HTTP caching of the service-worker script. Do not add a Cloudflare Cache Everything rule or automatic JavaScript rewriting for this site.

An update installs in the background and waits until all old app windows close. It does not use `skipWaiting`, reload an active timer, delete IndexedDB, clear Auth, or reset sessions. Close all tabs/installed windows and reopen when ready to activate a waiting update.

### Changing the origin safely

A Pages origin has different browser storage from the old Sites origin. **Wait for Synced on the old app before moving to the new URL.** Pending offline events cannot automatically move between origins. The new origin requires sign-in again, then recovers the active session from the same Supabase timestamps and state. Install/bookmark the final Pages origin; the old installed app does not retarget itself. Nothing in this migration copies or resets production sessions.

The timer remains timestamp-derived. Existing IndexedDB stores and Supabase commands are unchanged. SessionStore refresh/replay/locking behavior is unchanged. A service-worker update affects cached static files, not manufacturing state.

## Reproduce verification

```sh
npm ci
# Copy .env.example to .env.local and insert the project's public key.
npm run verify
npm run preview:pages
# In another terminal with Playwright available:
npm run test:static-browser
```

`preview:pages` runs the local Pages emulator at `http://127.0.0.1:5175`; its compatibility date is pinned only for the installed local emulator, not a production Worker. The browser script uses installed Chrome on macOS by default. Set `CHROME_PATH` and `PLAYWRIGHT_MODULE` if using another installation. It tests the existing isolated sample workspace, blocks external requests, and restores its temporary built SW modification afterward. It must never be pointed at a live host for the SW-update test.

Existing live QA scripts remain available and preserve their dedicated seeded-QA credential requirements. Do not run them against production employee data. Automated SQL regression tests use isolated in-memory PGlite and do not connect to the hosted database.

### Checks still needed on the final HTTPS host

- Direct-load and refresh `/login`, `/admin`, `/admin/employees`, `/admin/activities`, `/admin/assignments`, `/admin/kpis`, `/analytics`.
- Verify real confirmation/reset links return to the Pages origin and authenticated permissions are correct.
- Start a controlled real session; record its ID/start time; refresh, background/lock, close/reopen, and confirm the same active state from Supabase. Finish and save the test quantity intentionally.
- Install from Safari on iPhone and Chrome on Android, test screen lock and offline reopening, reconnect and wait for Synced. Browser emulation does not certify either mobile OS.
- Publish a later reviewed build, confirm it waits while the app stays open, then close/reopen and verify the session survives activation.

See `DEPLOYMENT-VALIDATION.md` for executed checks and their limits.

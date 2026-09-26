# GitHub Pages deployment

The current deployment target is **GitHub Pages**, following the owner's request to replace the earlier Cloudflare hosting plan. Supabase remains the existing backend (`bbbgrxvidrlmrrezfmil`). No manufacturing data, database schema, permissions or session engine was changed.

## Configuration

- Source branch: `main`.
- Publishing source: repository **Settings → Pages → Build and deployment → GitHub Actions**.
- Workflow: `.github/workflows/pages.yml` runs on pushes to `main` and manual dispatch.
- Build: `npm ci`, then `npm run verify` (tests, TypeScript, lint, production build).
- Output: `dist/`; Node version comes from `.node-version`.
- Public repository variables under **Settings → Secrets and variables → Actions → Variables**:
  - `NEXT_PUBLIC_SUPABASE_URL`: `https://bbbgrxvidrlmrrezfmil.supabase.co`.
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: this project's publishable key. The existing ignored `.env.local` contains it. Never use a secret/service-role key.
- `BASE_PATH` is supplied automatically by `actions/configure-pages`. Do not hardcode a guessed domain or repository path into the app.
- No Cloudflare credentials, Worker, server, database password, or GitHub personal access token is needed by the workflow. It uses GitHub's short-lived deployment token.

The owner approved the public independent repository [luhlo/lechic-manufacturing](https://github.com/luhlo/lechic-manufacturing). GitHub Free supports Pages from public repositories; private repositories require an eligible paid plan. A public repository exposes source, not the authenticated Supabase records. [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## Repository path and direct links

Vite's base comes from the actual Pages configuration. The HTML, navigation, manifest icons/start URL/scope, service worker, and Auth callbacks all use that base. No other repository on the account is modified.

GitHub Pages has no configurable SPA rewrite. The build creates physical `index.html` files for every existing screen (`login`, `work`, `admin`, `admin/employees`, `admin/activities`, `admin/assignments`, `admin/kpis`, `analytics`, and the other management screens). Direct links and refresh work without a 404 redirect trick. Paths are relative to the repository's published base. Unknown paths are ordinary 404s. `.nojekyll` is generated with the static output. [Vite's GitHub Pages guidance](https://vite.dev/guide/static-deploy#github-pages).

## Supabase Auth after successful deployment

Copy the actual URL from the successful Actions deployment or repository Settings → Pages. Include the repository path and trailing slash when present.

In the existing project's **Authentication → URL Configuration**:

- **Site URL:** the complete published app home URL, including its repository path.
- **Redirect URLs:** the same complete app home URL with a trailing slash. The app sends exactly this URL for signup confirmation and password reset.
- Retain prior authorized review/local URLs while still in use. Do not add broad wildcards for other GitHub projects.

For a later custom domain, let the workflow derive the new base and update these Auth URLs to the actual new app home. Production SMTP and real confirmation/reset email delivery must also work. No production hostname should be reported as live before deployment succeeds. [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Session and PWA safety

The timer stays timestamp-based; Supabase RPCs, IndexedDB and ordered offline replay are unchanged. The SW caches only this build's static files and is scoped to this repository. Cache cleanup is also scoped to the app base, so it cannot clear another repository's caches. It never caches Supabase requests, forces activation, clears authentication, or deletes manufacturing state. Registration bypasses the HTTP cache when checking for SW updates (`updateViaCache: none`), since GitHub Pages controls response headers.

The app precaches route directories with trailing slashes, avoiding redirected HTML responses during offline recovery. Updates wait until all old windows close. The manifest ID/scope/start URL stay inside the repository, and installation metadata is preserved.

Before moving from the old Site to the GitHub URL, wait for **Synced** on the old app. Sign in again on the new origin to restore the active session from Supabase. Unsynced events cannot transfer between origins. The old installed app will keep its old URL; install from the final GitHub Pages URL.

## Executed verification

- **46 unit/database/recovery/deployment tests passed**, including the original 31 regressions.
- TypeScript, lint and production build passed for `/lechic-manufacturing/`.
- A plain static HTTP server (no SPA fallback or Cloudflare emulation) hosted the production files under that repository path. All requested deep routes loaded and refreshed, URLs stayed correct, and Back/Forward worked.
- Existing sample employee workflow passed at 320/375/390/430px; admin screens passed at desktop width.
- Manifest paths, real icon dimensions, repository SW scope, offline refresh/reopen in Working/Walking/Interruption, unfinished quantity and completed receipt recovery passed.
- SW update waited while a session was open, activated after close/reopen, and preserved its ID/start timestamp.
- No uncaught browser errors or external API requests occurred. The browser test used the existing isolated sample workspace and did not modify live Supabase data.
- The build retains the non-blocking ~688 kB JavaScript chunk-size warning; no UI redesign/code-splitting project was added.

Real GitHub Actions deployment, final-host headers, real account confirmation/reset delivery and iPhone/Android installation must be checked after publication. `docs/DEPLOYMENT.md` and `docs/DEPLOYMENT-VALIDATION.md` record the earlier Cloudflare preparation, not the current hosting destination.

## Reproduce the repository-path test

```sh
npm ci
BASE_PATH=/lechic-manufacturing/ npm run verify
# Serve dist under /lechic-manufacturing/ with a plain static HTTP server.
# Then run, using local Chrome and a Playwright installation:
QA_ORIGIN=http://127.0.0.1:5176 QA_BASE_PATH=/lechic-manufacturing/ npm run test:static-browser
```

`QA_BASE_PATH` is test-only and never a production variable. `BASE_PATH` is build-only, validated as a root/repository path, and safe to expose as Vite's built-in `BASE_URL`. All other public variables and private-variable protections remain as documented in the earlier environment audit.

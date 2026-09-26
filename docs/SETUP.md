# Connect the independent Supabase project

## Current status

Supabase organization **le chic** owns **Le Chic Manufacturing**, project `bbbgrxvidrlmrrezfmil`, US East, quoted **$0/month** at creation. The following migrations are applied and tested:

- `20260926003308_manufacturing_core.sql`
- `20260926005814_qa_stabilization.sql`
- `20260926011457_advisor_indexes.sql`
- `20260926033822_username_and_device_pin_login.sql`
- `20260926050941_position_access_and_pin_expiration.sql`
- `20260926053636_optional_pin_expiration_date.sql`
- `20260926224939_employee_workflow_options.sql` (see [My Work workflow and validation](MY-WORK.md))

`supabase/bootstrap-admin.sql` reserved **lechicmiami@gmail.com**, display name **Le Chic Miami**, with the Administrator role. No owner password was created and no email was sent. Local `.env.local` and the Site runtime have the project URL and modern publishable key. The frontend uses no service-role key; the protected login Edge Function uses Supabase’s built-in server key. Temporary QA users and all QA manufacturing/catalog rows were removed; employee KPI visibility is OFF.

For the current static GitHub Pages deployment, follow [GITHUB-PAGES.md](GITHUB-PAGES.md), including the public build variables, actual production URL and origin-transition instructions. The older private Site is a review deployment.

## Remaining launch configuration

1. The current Site URL is **https://lcwork.luhlo.com/** and both its exact redirect and the prior GitHub Pages redirect are authorized. Public signups and anonymous sign-ins are disabled. Keep email confirmation enabled; administrator-created accounts are individually auto-confirmed. Configure SMTP for password reset delivery.
2. The existing owner account is already created and assigned to OM/full access. Refresh **https://lcwork.luhlo.com/**. Configure primary position permissions in **Positions → App access**. No manual Supabase step is required. Subsequent employee accounts are created by an administrator under **Employees → Login options**. See [POSITION-ACCESS.md](POSITION-ACCESS.md).
3. Create your actual positions, activities and their position links, designs, and employee records. Assign capabilities through Positions → App access and create work assignments.
4. Deploy the static app to the independent GitHub Pages repository. The previous Sites review deployment remains owner-private; the GitHub Pages shell is reachable at its new URL, with Supabase sign-in/RLS protecting production data.
5. Verify installation, actual screen lock and app switching on one iPhone/Safari and one Android/Chrome. Desktop Chrome suspension and PWA tests passed, but those do not certify mobile OS behavior.

For a fresh independent environment, apply all files in `supabase/migrations/` in order and then the bootstrap SQL. Never point the app at Relay or Commissions. `.env.example` lists the two public variables. Existing migration timestamps in the hosted ledger may differ because the management API assigns deployment timestamps; names and SQL identify the same checked migrations.

## Supabase configuration

- RLS is enabled on all application tables. Clients have only SELECT on tables and authenticated EXECUTE on the explicit RPC API. Writes occur in checked transaction functions.
- Authorization reads current profile/role state, not user-editable metadata. Deactivation blocks database access with an existing token.
- Private implementation functions have fixed search paths and explicit authentication/capability checks. Public wrappers run as security invokers.
- `session_metrics` is a security-invoker view. Historical target snapshots and command receipts live in the unexposed `private` schema.
- The schema includes profiles, configurable roles and capabilities, positions, activities, products, assignments, settings, versioned KPIs, sessions, segments, and private operation/audit records.
- Only one running or awaiting-quantity session per employee is permitted. Core operations are idempotent and revision checked. No client can insert arbitrary segments directly.
- Run the Supabase security and performance advisors after applying the schema. The transactional SQL suites are in `supabase/tests/`. Run them on an isolated empty QA database: the core last-administrator assertion assumes its fixture is the only administrator. Both suites passed on the new hosted database before production setup.

## Local commands

Use Node 24.19.0 (pinned in `.node-version`) and npm.

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
```

`npm run build` creates static production output in `dist/` and fingerprints the service-worker cache. Installation precaches the generated JavaScript/CSS assets, so the first online visit prepares the shell for offline reopening. Existing installed clients update when the old app closes; the service worker does not forcibly replace a running timer.

## Employee access and launch

The Sites preview is owner-private. Employees need an intentionally shared production deployment they can reach, with Supabase sign-in still protecting all data. Set the auth redirect URLs to that origin. A private review URL alone is not an employee rollout.

Verify installation and a real lock/background/reopen cycle on both iPhone Safari and Android Chrome before introducing it to the team. Automated browser recovery tests do not replace testing each mobile OS's storage and suspension behavior. Browser storage can be cleared by a user or OS; reconnect frequently and wait for Synced before switching phones. New sessions require connectivity; ongoing work can queue transitions, Finish, and quantity temporarily offline.

If a session conflicts with another device, the app retains pending commands and offers explicit server recovery, saving an audit copy in IndexedDB. A manager should review pending timestamps before recovery. V1 does not include editing historical session times or automatic conflict merging.

Manufacturing time is separate from Square clock-in/payroll. No payroll, scheduling, barcode, or notification integration is included.

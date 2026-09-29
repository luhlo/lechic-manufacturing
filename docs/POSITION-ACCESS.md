# Position access and optional PIN expiration

## Operator guide

The existing **OM** position is reused and grants full access through the existing Administrator role (`*`). The owner's existing account, **lechicmiami@gmail.com**, is assigned to OM. **No manual Supabase step is needed for this existing user.** Open https://lcwork.luhlo.com/, refresh, and use **Positions → OM → App access** to review full access. Use **Email / username** and a password for credential administration.

To configure another position, open **Positions → its App access**, select pages and View/Manage choices, and save. Assign employees to that position in **Employees → Edit**. New positions start with My work; App access can remove it. A position with zero permissions has no workspace access. Individual role assignments under **Permissions → Assign roles → Employees** remain additive advanced overrides; they may explain why an employee retains access after a position changes.

| Feature | Stable permission IDs |
| --- | --- |
| My work | `my_work.access` |
| Dashboard | `dashboard.view` |
| Assignments | `assignments.view`, `assignments.manage` |
| KPIs | `kpis.view`, `kpis.manage` |
| Employees | `employees.view`, `employees.manage` |
| Positions | `positions.view`, `positions.manage` |
| Activities | `activities.view`, `activities.manage` |
| Designs/products | `products.view`, `products.manage` |
| Analytics | `analytics.view` |
| Permissions | `permissions.manage` |
| Settings | `settings.manage` |
| Full administration | `*` |

Manage includes View for the same module. Dashboard and Analytics are independent. View-only screens contain no Add, Edit, credential or write controls. Navigation is shared across desktop/mobile/PWA. Explicit unauthorized pages show Access unavailable, including `/analytics`, `/admin`, `/employees`, and `/settings`. Users without My work cannot start timers.

## Actual schema and migration

Migrations: `20260926050941_position_access_and_pin_expiration.sql` and `20260926053636_optional_pin_expiration_date.sql`.

- Reuses `profiles.position_id`, `positions`, `roles`, `role_permissions`, `position_roles`, and `profile_roles`. There is no parallel permission framework.
- Adds `roles.managed_position_id`, a unique optional position FK. Saving App access creates/reuses this position's dedicated role and atomically replaces its position-role links. Existing reusable roles, employee role overrides, employee IDs, and historical work remain intact. Dedicated position roles cannot be assigned as employee overrides or edited through the advanced role editor.
- `private.has_permission(profile, capability)` resolves active employee + active roles + active position inheritance. `private.can` uses the verified identity. OM's name is used only for the one-time migration/bootstrap lookup; authorization uses grants, never name checks.
- Backfills previously implicit My work for existing positions, and explicit Dashboard access for legacy analytics roles. Only previously linked, unassigned non-admin accounts receive the compatibility Employee override; unlinked employee records do not acquire overrides that could defeat future position restrictions.
- Adds `profiles.pin_expiration_enabled boolean NOT NULL DEFAULT false`. Existing private PIN digests and `private.login_pins.updated_at` remain unchanged. No PIN reset is required.
- The trusted migration reuses OM and links it to an active full-access role. It assigns the already-authorized owner only if their position is empty; existing nonempty position assignments are never overwritten. `bootstrap-admin.sql` documents a trusted SQL-only path for a fresh installation. It reserves the owner/OM but creates no Auth account, password, or email. Public registration stays disabled, and no public bootstrap endpoint exists.

## Last administrator and privilege boundaries

Administrative RPC changes use a shared transaction lock. Before committing, they require at least one active employee with a linked, confirmed, non-banned Auth account and effective `*` access from an active direct or position role. Deactivating/moving an employee, deactivating a position/role, removing a role link, or removing the last full-access grant rolls back if it would eliminate the final usable administrator. Pending/unlinked OM employees do not count. Once a second usable full administrator exists, the first can be reassigned safely. Supabase owner/service-role access remains trusted maintenance access outside client RPC boundaries.

`employees.manage` alone cannot change privileged employees, assign a privileged position, or reset a privileged employee's credentials. These actions also need `permissions.manage`; dormant grants are included to prevent reactivation attacks. Regular My work-only positions do not make employees privileged. Table DML remains unavailable to clients; writes use checked RPCs. Permission changes do not rely on stale token role claims.

RLS now uses granular View permissions. Assignment/analytics/position screens get a minimal employee directory (ID, name, position, active), not other employees' emails, usernames, or Auth IDs. Dashboard-only users receive a bounded daily aggregate and active-session labels through a checked RPC; they cannot fetch Analytics session history or KPI configuration tables. Private credentials remain inaccessible.

UI access refreshes immediately after a manager saves, when the app regains focus/connectivity, and every 30 seconds while visible/online. Backend checks use current grants on every request. Refresh also updates permissions and clears revoked catalog data while unsynced work needs review. Offline clients retain their last authorized cached view until reconnecting; they cannot start new sessions offline. If My work is removed during a session, the employee can finish and submit quantity for that existing session, but cannot start another. This preserves already-recorded work.

## PIN login and expiration

PIN is always first/default, including after refresh/logout. The visible field and option say **PIN**. Input is masked, requests a numeric mobile keypad, and automatically submits four digits. Email/username + password remains secondary. A browser still needs studio approval; the disabled PIN field explains how to obtain approval. Device approvals expire independently after 90 days and still lock after five incorrect attempts.

**Employees → Edit employee → PIN expiration → PIN expires** controls each employee separately. It is OFF by default; OFF means no automatic PIN expiration. When turned on, choose **On a date I choose** and enter a required date. The PIN remains valid through that calendar day in Miami (`America/New_York`), expiring at the following midnight, including daylight-saving transitions. A past date makes it immediately expired. Resetting the PIN does not extend this fixed deadline: change the date or disable expiration to renew access.

The **90 days after PIN change** option remains available for the previous rolling policy. Existing enabled policies without a date keep this behavior. The nullable `profiles.pin_expiration_date` column defaults to null, preserving existing employees and private credential timestamps/digests. Switching to the rolling option clears the custom date. Turning expiration off preserves a chosen date; re-enabling applies that same date. Policy edits never refresh the PIN's last-change timestamp. A genuine PIN reset renews only the rolling 90-day policy. The editor shows last change, next expiration, and Active/Expired/Not set; no existing PIN/digest is shown.

The private, client-inaccessible `private.pin_expires_at(uuid)` helper computes the same cutoff for login enforcement and manager metadata. Both date-only changes and toggle changes require password authentication.

Changing expiration requires `employees.manage`, a password-authenticated session, and `permissions.manage` when targeting a privileged employee. Metadata and PIN/device operations retain the existing password-only manager check. An expired correct PIN returns **Your PIN has expired.** and directs the employee to ask their manager to renew PIN access or use password login. It does not issue a session and does not consume an incorrect-PIN attempt. Existing sessions and email/username/password sign-in remain unaffected.

## Verification

- `npm run verify`: 100 passing tests; TypeScript, ESLint, and production build pass. Includes six transactional PostgreSQL suites, all local and rolled back.
- Migration fixture verifies existing PIN digest/timestamp preservation, expiration OFF, existing OM reuse, correct owner linking, and full permission inheritance.
- A–E permission cases cover work only; work + assignment management; work + analytics; assignment/KPI view + analytics without work; and OM. Tests cover view/manage implication, RLS, safe directories, direct writes/self-promotion denial, live grant changes, and inherited last-admin protections including a pending second OM and a usable second admin.
- Eight PIN policy scenarios cover OFF/old PINs, ON/expired PINs, employee isolation, disabling, re-enabling, legitimate reset, precise 90-day boundary, and unauthorized/password-method changes. Edge tests distinguish expiration from incorrect PIN and prove no token issuance on expiry.
- Custom-date tests cover inclusive Miami dates, both daylight-saving changes, server/session timezone independence, fixed versus rolling reset behavior, disabling/re-enabling, invalid dates, date-only password enforcement, unauthorized edits, and private helper grants. Local fixture browser checks verify selecting, saving and reopening a date, turning expiration off, and restoring the chosen date. The in-app browser native calendar popup crashed during automation; date entry through the input and save/reopen passed. Physical-device calendar interaction remains an acceptance check.
- Manufacturing regressions retain work/walking/interruption transitions, finish, quantity, assignments, KPI history, elapsed/productive metrics, idempotency, offline recovery, conflicts, and concurrent tabs. Permission revocation during pending-work conflicts is tested.
- CUA browser checks against an isolated local fixture preview exercise the actual app components: A–E navigation, view-only actions, direct protected routes, immediate navigation changes after App access save, expiration toggle/save/reopen, masked numeric PIN input, correct/incorrect/expired PIN responses, automatic login, logout/reopen default, and password fallback. Mobile menu and 320/390 px layouts have no horizontal overflow. No browser errors were observed during that earlier access/PIN rollout. Fixture files are outside the repository and never shipped.
- Static build verification covers root custom-domain assets, direct route directories including aliases, standalone manifest, PWA cache versioning, safe waiting updates, and no server secrets/sample entry points.

Local synthetic Auth records and mocked successful browser logins are not real production employee logins. No production test accounts, PIN changes, test emails, or manufacturing records are created. Physical iPhone/Android installation, keyboard behavior, and OS suspension still need device acceptance; no physical phone was attached. An already-open PWA waits to update until its tabs close, preserving in-progress work.

Production backend verification after deployment: all five employee records, the existing PIN, three device approvals, and the single Auth account remain. No manufacturing records were removed; expiration is OFF for all five employees, and OM grants full access to the linked owner. Unlinked employee records have no unintended individual access overrides. The login gateway remains service-role-only; The optional-date rollout preserves these counts and settings, leaves all custom dates empty, and keeps the new helper inaccessible to clients; Edge Function version 4 is active and Deno checking passes.

Supabase advisors show no database security warnings. Informational findings concern intentionally private policy-free tables and unused indexes in the new database. One Auth warning remains: leaked-password protection is disabled; [Supabase makes it available on Pro and above](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The project was created on the free plan, and no billing upgrade was made.

## Assignment hierarchy

Configure **Positions → Add/Edit → Assignment hierarchy level**. Blank means **Not configured**; levels are positive integers (maximum 2147483647). Higher numbers have more assignment authority. Multiple positions may use the same level. The table shows the level; access administrators also see **Can assign work**, derived independently from the existing active role grants. Individual employee overrides can differ from this position summary.

An ordinary sender must have effective `assignments.manage`, an active linked verified Auth account, and an active position with a configured level. An active recipient must also have an active position with a configured level, and `sender.assignment_level >= recipient.assignment_level`. Rank never grants permissions. An individual `assignments.manage` grant follows exactly the same rank comparison. An active verified effective `*` administrator bypasses rank, retaining existing active-employee eligibility even while positions are unconfigured, inactive or absent. No position name supplies authority.

`private.assignment_scope_error` is the shared internal rule. `public.assignment_recipients()` is an authenticated, invoker-only wrapper for a guarded private function returning eligible names/position labels and setup status. It does not expose email/login fields. Existing `employee_directory`, read RLS, Analytics, Dashboard, My Work and KPI visibility are unchanged. The existing Add/Edit assignment forms use only this scoped result; no new assignment workflows were introduced.

The existing `private.manage` assignment branch acquires the same management advisory lock (`8417201`) as hierarchy, employee and permission changes, then checks the current actor and **both current and proposed recipients**. Creating an assignment earlier gives no ongoing ownership exemption. Editing, cancelling and retries use current permissions/ranks. Started/completed session reassignment restrictions remain. Employee `session_command` completion/progress is intentionally separate and requires no assignment-management capability.

Changing a level (including clearing it or configuring a new position) requires **both `positions.manage` and `permissions.manage`**. Activating/deactivating a ranked position also requires permission management. `private.audit_log` records entity `assignment_hierarchy`, actor, position ID, previous/new level and timestamp. Omitting the level in a normal name edit preserves it. Changing an employee's stored position rank, including a transition from/to NULL or dormant rank, requires **`employees.manage` and `permissions.manage`**. Moving between equally ranked positions remains subject to the existing privileged/dormant-role safeguards; changing the position's active eligibility at a configured rank also requires access management. Role-link overrides remain permission-managed, and last-administrator protection is unchanged.

Recipient scope refreshes with context/catalog refresh (focus, reconnect, visible-app polling and management saves), and when an assignment editor opens. A failed save refreshes context and scope while preserving draft fields. An invalid old recipient prevents editing/reassignment/cancellation; an invalid proposed recipient is removed from choices and blocks saving. Loading/error states fail closed. A select-control empty event during options refresh cannot erase the stored draft selection.

Migration `20260929030445_assignment_hierarchy.sql` adds a nullable level without guessing ranks or rewriting existing records/grants. Until OM configures levels, ordinary assignment managers get a setup message. Full administrators can continue assigning during setup. There is no bypass switch.

Local verification: `npm run verify`; PostgreSQL integration includes `supabase/tests/assignment_hierarchy.sql` with isolated A–P fixtures (rolled back), alongside all previous security/session/PIN/workflow suites. UI scope helpers and the dedicated API have additional tests in `tests/assignment-access.test.ts`. Browser validation uses a separate localhost fixture, never production employee changes.

Authorization guidance checked against the current [Supabase database functions documentation](https://supabase.com/docs/guides/database/functions) and [API security documentation](https://supabase.com/docs/guides/api/securing-your-api): fixed empty search paths, private definer implementation, explicit RPC grants, server authorization and unchanged restricted table DML.

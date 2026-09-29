# Assignment hierarchy verification

Date: September 28, 2026 (America/Chicago).

## Implementation and configuration

- Configure Positions → Add/Edit → Assignment hierarchy level. Blank is Not configured. Levels and assignment permissions are separate.
- Ordinary rule: active verified actor + effective assignments.manage + active configured sender/recipient positions + sender level >= recipient level. Equal levels across different positions qualify.
- Effective full administrators (`*`) bypass numeric hierarchy, preserving existing active-employee eligibility during setup. Neither position names nor high levels grant capabilities.
- Both old/new recipients are authorized under the management transaction lock. Creation ownership does not bypass current scope. Existing session reassignment restrictions and own-work completion remain intact.
- Level changes require positions.manage + permissions.manage and are audited. Authority-changing employee position moves require employees.manage + permissions.manage. Existing privileged/dormant role safeguards and last-admin checks are preserved.
- Add/Edit assignment choices use a dedicated server scope. Read visibility and shared directories remain unchanged. Context refresh and failed saves refresh options and retain draft fields; an invalid recipient blocks saving.

## Automated checks

`npm run verify` passed: **142 tests across 12 files**, TypeScript checking, ESLint, production build and static-route/PWA asset validation.

The PostgreSQL integration applies every versioned migration and executes nine transactional SQL suites, including the new `supabase/tests/assignment_hierarchy.sql` A–P cases. It covers down/equal/upward scope, no permission/view-only users, effective full admins, NULL/inactive/missing positions, forged claims/direct DML, current authorization on retry, promotion/demotion/revocation, both reassignment recipients, creator edit/cancel denial, authority-sensitive employee/position edits, individual overrides, independent analytics, own assignment completion/idempotency, rank audits, positive-integer validation and last-admin retention.

All previous category/step/activity creation, assigned-design search/progress, work/walking/interruption/finish/quantity, reporting/timeline gaps, recovery/offline queue, PIN/expiry, access/admin and KPI tests still pass. The existing Vite large-bundle advisory remains; it does not fail the build.

## Browser checks

Used a separate localhost preview with synthetic fixtures, with no production edits or test accounts/emails:

- Full-admin Positions table shows independent level and permission columns.
- Create a level, edit it, clear it back to Not configured; no permission is granted by setting a level.
- Ordinary positions.manage user sees a disabled rank field and setup guidance.
- Ordinary assignment manager sees lower/equal recipients only; higher/unconfigured assignments remain visible but read-only. Full admin also sees higher/unconfigured active recipients.
- New and existing assignment forms use scoped choices; eligible reassignment succeeds.
- Simulated promotion before saving rejects the write, refreshes recipients, retains design/date/quantity/notes, and disables save until a valid employee is chosen.
- Simulated permission revocation rejects an open edit and preserves the draft without a success toast.
- Recipient choices refreshing no longer clear the existing selected employee via Radix's empty-select event.
- Unconfigured senders see an actionable message and disabled Add button. View-only users retain authorized rows without mutation controls.
- Position editor checked at 390 CSS pixels; no document overflow. No browser console errors observed.

## Production database verification

Applied **assignment_hierarchy** to project **bbbgrxvidrlmrrezfmil**. Local migration file: `20260929030445_assignment_hierarchy.sql`; Supabase's applied history version: **20260929031954** (the connected migration tool assigns its own application timestamp).

Before/after counts and whole-row checksums matched across **24 tables**, excluding only the new nullable positions.assignment_level column. This included positions, profiles, role grants, products, assignments, sessions, segments, categories/steps, settings/KPIs, PIN/device records, audit history and command receipts. Eight sessions and 28 segments were preserved. No production employee or work fixtures were used.

Verified: anonymous RPC execution denied, authenticated recipient RPC granted, internal rule execution denied to browser roles, public wrapper SECURITY INVOKER, private implementations with empty search_path, no authenticated INSERT/UPDATE/DELETE on assignments/positions/profiles.

Security advisors produced no new findings. Existing findings remain: six INFO notices for intentionally closed private tables and [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). This update does not change Auth policy.

Current unconfigured positions: **OM, Lydia, Madison, Ileana, Alejo**. OM must choose the intended levels; no names were translated into ranks. An effective full administrator can leave their own rank unset and still assign. Other assignment senders need configured levels before assigning.

Production authenticated employee workflows were not exercised by changing real accounts/data. Authorization behavior was tested against isolated PostgreSQL fixtures; deployed schema/grants were inspected separately. GitHub Actions is the existing release path; deployment URL is https://lcwork.luhlo.com/.

# Employee My Work refinement

Release: 2026-09-26. App: https://lcwork.luhlo.com/

This documents the initial My Work phase. The 2026-09-27 extension adds categories, optional steps and Chicago reporting; see [Categories and daily timeline](CATEGORIES-TIMELINE.md) for current navigation, assignment step scope and verification.

## Scope and employee workflow

The existing React screens, configured Supabase catalog, timestamp/session engine, durable IndexedDB queue, PIN-first authentication and position permissions are retained. Management changes are the two activity controls only. Analytics changes are limited to compatibility with optional designs and quantities.

My Work-only employees land directly on My Work. The home shows a first-name greeting, local date and large position-filtered activity buttons. There was no activity ordering field; activities now use stable name/ID ordering. Nothing seeds or hardcodes real production activities.

| Requires design | Requires quantity | Flow |
| --- | --- | --- |
| Yes | Yes | Activity → assigned/searched design → Start → Finish → quantity → Save |
| Yes | No | Activity → assigned/searched design → Start → Finish → completed |
| No | Yes | Activity → Start → Finish → quantity → Save |
| No | No | Activity → Start → Finish → completed |

A normal assigned task takes **three taps to begin**: activity, design, Start. Completion takes Finish, number entry, Save (**two action taps plus typing**, with the numeric field focused automatically). Continue same activity is one next-action tap; the following task then takes design and Start, without reselecting the activity. A no-design continuation opens Start directly.

Today's assigned/in-progress designs precede Search another design. Cards show name, SKU and assigned quantity or accumulated completed/target progress when available. Search remains case-insensitive and supports partial names and SKUs. Progress is a read-only sum of existing completed session quantities; a transient failure leaves assignments usable without an invented progress value.

The active screen concentrates on the task, elapsed time, explicit WORKING/WALKING/INTERRUPTION text and large controls. Walking and Interruption each have a one-tap Resume work action. The narrowest layout stacks these controls. Busy text and disabled actions acknowledge taps immediately; errors do not claim unsaved changes are safe.

## Activity settings and data

Activities default to **requires_design = true** and **requires_quantity = true**, preserving the inspected original behavior: every activity previously required a design and quantity. Both existing production activities kept these defaults. Appropriately authorized users change the controls in the existing Activities editor.

Sessions snapshot both settings when they start. Editing an activity affects future sessions, including same-activity continuation; it never changes the requirements of work already started or historical records. Missing flags in an old device cache mean the legacy required behavior.

A design-free session has a NULL product ID and assignment ID, with empty design/SKU labels; no fake product is created. A quantity-free finish stores **NULL**, distinct from a real quantity of **0**, and completes without quantity entry. Quantity-based work accepts only integers from 0 through 1,000,000,000.

Assignment quantities accumulate only from saved, quantity-based sessions. A numeric target remains in progress until met; quantity-free work does not satisfy it. An assignment with no numeric target completes on the first completed session. Existing cancellation and started-assignment reassignment protections remain.

All time is included in time analytics. Output rates use only sessions with meaningful quantities and only their corresponding time denominators. Quantity-free rates/baselines/targets are not shown. No-design work remains visible by employee/activity/time and under “No design.” A zero-output quantity session correctly contributes a zero rate and its time.

Employee KPI visibility still defaults to OFF. When authorized, target display stays secondary; actual output rate appears after quantity is saved. Quantity-free sessions expose no output KPI even when the global display setting is on.

## Recovery and safety

Finish closes the timestamp immediately. The UI is notified only **after** the local stopped-session/command write succeeds, before waiting for the network acknowledgement. Quantity entry never accrues time. No success is published if local persistence fails.

The existing UUID receipts, expected revisions, row/Web Locks, atomic segment transitions and conflict archive remain. Offline transitions and completion are queued durably. A quantity-free finish follows the same queue and retry protocol. Another task cannot start until queued work is synced; uncertain starts reuse the original request/session IDs.

Reopening/refreshing with a running or awaiting-quantity session opens My Work directly when authorized, including when the saved URL points at another screen. Additional permitted navigation remains available, with a prominent return-to-work reminder while a session is unfinished. Revoked access and protected-route denial behavior remain; the existing recovery surface permits finishing previously started work without permitting new work.

## Migration and production verification

- Source: `supabase/migrations/20260926224939_employee_workflow_options.sql`.
- Applied migration name: `employee_workflow_options`; hosted version: `20260926231222` in `bbbgrxvidrlmrrezfmil`. The Supabase management API assigns the hosted timestamp; SQL/name match the source file.
- Adds activity/session flags, makes product ID optional, and strengthens workflow-aware session constraints.
- Updates the existing checked session/manage/KPI/baseline functions; adds bounded, authenticated, security-invoker `assignment_progress(uuid[])` with RLS plus explicit self-ownership.
- Production verification preserved all existing row counts and compared unchanged-data digests for profiles, activities, sessions, assignments, products, roles, KPI targets and settings. No test users, test sessions, test emails, manufacturing-data edits or deletes were performed on production.
- RLS remains enabled. Supabase security advisors reported only the existing Auth warning ([leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)) and informational findings for [intentionally private policy-free tables](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). No account/billing/security-policy changes were made.

## Verification

`npm run verify`: **113 tests across eight files**, TypeScript, ESLint and production build passed. Seven transactional PostgreSQL integration suites run on local PGlite, including the new `supabase/tests/employee_workflow.sql`. A pre-migration historical fixture proves its existing fields/quantity remain identical and both new defaults are true. Existing authentication, permissions, last-administrator, PIN expiry/date, deployment and recovery tests remain included.

New tests cover all four database workflows, design validation, bounded quantity including zero, snapshot edits during work, exact segments/recovery, retry idempotency, assignment progress/completion/isolation, no-design baselines, NULL versus zero rates, offline no-quantity completion/reopening, and publishing the stopped timer before a slow server response. Optional progress failures cannot block the catalog or hide authorization failures.

| Browser scenario | Result |
| --- | --- |
| A: design + quantity; 24 saved; continue → another design → Start | Passed |
| B: design without quantity; Finish directly completes | Passed |
| C: quantity without design; no design step/context | Passed |
| D: neither; direct Start, Finish, direct same-activity Start | Passed |
| E/F: Walking and Interruption, one-tap Resume | Passed |
| G: reopen from another URL; exact active state and elapsed time restored | Passed |
| H: today's assignments before search; 24/30 progress | Passed |
| I: partial mixed-case name and partial SKU search | Passed |
| J: KPI OFF hides KPI; authorized target/actual stay secondary | Passed |
| Permissions/editor | My Work-only has no management navigation; explicit protected route denied; OM retains navigation; new activity flags ON, time-only flags OFF |
| Layout | Measured 320/375/390/430 CSS-pixel widths; no document overflow; long design text wraps; numeric keyboard attribute verified; active touch targets at least 64px; desktop remains functional |

Browser scenarios use isolated local API fixtures with the real app components and SessionStore. They never touch production manufacturing data. Browser console checks found no errors. Static verification checks physical refresh routes, custom-domain root assets, manifest/scope, safe versioned service-worker updates and public-only credentials. Vite still reports the existing large single-bundle size advisory; code splitting was outside this UX phase.

## Real-device acceptance

On an actual iPhone/Safari and Android/Chrome, install/open the PWA, sign in on an approved PIN device, and test one real assigned job. Check numeric keyboard/focus, thumb reach, lock/unlock, switching apps, closing/reopening, and an offline Walking/Finish/Save followed by reconnection. Confirm Synced before clearing storage or changing devices. Physical mobile OS suspension, virtual keyboards and installation prompts are not certified by desktop viewport tests.

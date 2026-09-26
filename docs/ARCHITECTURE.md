# Architecture and implementation plan

An independent Le Chic Miami manufacturing PWA. Relay is read-only reference material and its Supabase project is explicitly blocked in the client configuration.

## Relay inspection

Inspected `lib/model.dart`, `lib/storage.dart`, `lib/cloud.dart`, `lib/account.dart`, lifecycle handling in `lib/main.dart`, web manifest, and Supabase setup. Reuse timestamp-derived timers, persistent authentication, lifecycle refresh, large controls, publishable-only browser keys, authenticated RPC writes, and optimistic revisions. Do not copy family/household concepts, shift kinds, automatic finish-on-start, whole-account JSON records, cloud-online-only save behavior, production credentials, identity, or deployment. No Relay files or database records are changed.

## Application

React 19 / TypeScript / Vite 8 static SPA; responsive employee and management surfaces. The deployment pass removed the unused Sites Vinext server wrapper and starter D1/Worker infrastructure. GitHub Pages serves static `dist/` assets and physical route directories; no application server is deployed. Supabase Auth and Postgres are the source of truth. IndexedDB stores a user-scoped session snapshot and durable operation queue. A service worker caches only the application shell/assets, never Supabase responses. No sample production catalog is seeded. Public sample entry and registration are unavailable; local fixtures are isolated from the production application.

See [the current position-permission and PIN-policy design](POSITION-ACCESS.md) for the latest schema and verification.

## Data and authorization

Profiles can be preauthorized by email, then linked to verified Supabase users. Roles grant permission identifiers; roles can belong to employees or positions. The administrator role grants `*`; it is not a profile boolean. Database policies enforce reads; authenticated commands enforce writes. Definer implementation functions live in a private schema, use a fixed search path and check the authenticated profile. Public RPC wrappers are invokers. No browser table writes are granted. Soft deactivation retains references. Sessions snapshot labels at start; KPI targets are versioned and sessions retain the selected version privately.

## Timer protocol

New sessions require network confirmation. A partial unique index permits one running or awaiting-quantity session per employee. Profile row locks serialize commands across devices. Every operation has a UUID idempotency key and checks the expected revision. A replay with different input is rejected. The state machine closes one segment before opening the next in one transaction. Finish closes time immediately; quantity entry does not accrue time. An unfinished quantity prompt is restored after a restart.

Temporary disconnection permits transitions, Finish, and quantity entry on the already confirmed session. Each local command is durably persisted before success is shown. Browser Web Locks serialize tabs. Requests replay in order. Revision conflicts preserve pending commands and require review, never silently overwrite the server. Timestamps must be monotonic and not more than 60 seconds in the future. Device timestamps are necessary for offline event recording; device-clock manipulation is not a payroll-grade timekeeping guarantee. Square remains separate.

## Metrics

Rates are aggregate quantity / aggregate seconds, not averages of individual rates. Zero productive time yields no rate. Baseline uses completed sessions before the selected period for the same activity/product; target is management-defined and selected using product-specific then activity fallback. Historical target snapshots are separate from current targets. Date filters allocate completed sessions to their start date in the browser's local timezone; this cohort choice keeps units and time together and is displayed in analytics. Segment boundaries remain available for future time-window allocation.

## Work phases

A Relay inspection → B schema/auth/RLS → C employee/session engine → D walking/interruption → E management → F assignments → G KPIs → H analytics → I offline/PWA → J database, domain, browser and responsive tests, launch documentation.

## Stabilization decisions

Pending commands are retained until both server acknowledgement and local persistence succeed. Reads cannot clear an unacknowledged queue. Web Locks serialize all browser mutations, including clearing a completed receipt and sign-out checks; unsupported browsers fail explicitly. Expired sign-in keeps the queue retryable. A confirmed authorization denial clears cached management capability/catalog data while retaining the employee's pending events for recovery.

Segments have a per-session ordinal and deferred database integrity validation: no gaps, overlap, missing first segment, or status/end mismatch is accepted. Unique active-session/open-segment constraints and idempotency receipts remain independent protections.

Today's assignment list includes only today's assigned/in-progress items; managers reschedule overdue work through the existing date field. A null quantity target completes on the first saved session; a numeric target completes when accumulated saved quantity meets it. Zero is a valid quantity. Started assignments cannot change employee/product, and cancellation is preserved.

Analytics fetches only when its screen is open, applies date/employee/position/activity/design/SKU filters in the database, and paginates matching sessions. Historical baseline aggregation runs in PostgreSQL for only the activity/design pairs being compared. KPI version editing is limited to the latest version. Privileged profile/position edits require permission-management capability.

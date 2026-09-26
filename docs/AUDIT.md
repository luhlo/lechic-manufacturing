# Manufacturing QA audit

> Historical initial-build/QA report. The current static Pages deployment changes and checks are in [DEPLOYMENT-VALIDATION.md](DEPLOYMENT-VALIDATION.md).

Initial inspection (before stabilization), compared with the original manufacturing specification:

| Requirement                                                   | Initial status        | Evidence / issue                                                                                                                  |
| ------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Independent app and database                                  | PARTIALLY IMPLEMENTED | Separate source and blocked Relay/Commissions references; new manufacturing Supabase project now provisioned.                     |
| PWA manifest, icons, standalone, shell caching                | IMPLEMENTED           | Production service worker and prior offline browser test. Physical-device installation remains acceptance work.                   |
| Authentication and preapproved employee enrollment            | PARTIALLY IMPLEMENTED | Auth UI and SQL enrollment guard; no hosted end-to-end verification yet. Demo exit and expired-auth recovery need fixes.          |
| Employees, positions, activities and position links           | IMPLEMENTED           | Database-driven management forms and guarded RPC. Inactive position filtering needs correction.                                   |
| Capability roles and server authorization                     | BROKEN / NEEDS FIX    | RLS and capability guards present; position activation and privileged employee editing need stronger guards.                      |
| Products, design/SKU search                                   | IMPLEMENTED           | Normalized case-insensitive search.                                                                                               |
| Assignments                                                   | BROKEN / NEEDS FIX    | Priority display exists; old items clutter list and completion does not advance assignment status.                                |
| Employee start, work, walking, interruption, finish, quantity | IMPLEMENTED           | Atomic command RPC and timestamp segments; rapid start guard needs improvement.                                                   |
| Unique active session and open segment                        | IMPLEMENTED           | Partial unique indexes; idempotency receipts and revision locking.                                                                |
| Durable recovery and offline replay                           | BROKEN / NEEDS FIX    | A failed write followed by successful reads can discard pending queue. Storage acknowledgement and cross-tab clearing need fixes. |
| Historical names, SKU and target snapshots                    | IMPLEMENTED           | Snapshots stored at start, deactivation preserves records.                                                                        |
| Activity and activity/product KPI fallback                    | PARTIALLY IMPLEMENTED | SQL priority correct; local timezone comparison and editing retired versions need fixes.                                          |
| KPI visibility OFF / TARGET_ONLY / TARGET_AND_ACTUAL          | IMPLEMENTED           | Default OFF; target recording independent from visibility.                                                                        |
| Baseline / target / actual and weighted rates                 | IMPLEMENTED           | Separate concepts; zero time returns no rate.                                                                                     |
| Analytics and filters                                         | PARTIALLY IMPLEMENTED | Filters affect client data; unbounded history download needs removal.                                                             |
| Responsive employee and desktop management                    | PARTIALLY IMPLEMENTED | Previous 390/1440 checks; four requested mobile widths and complete management QA pending.                                        |
| Live Supabase/RLS verification                                | MISSING               | Local PostgreSQL tests existed; hosted migration and actual HTTP verification now possible.                                       |

The remainder of this document records the final evidence and any remaining limits after fixes.

## Final assessment

**Ready for UI/UX refinement.** No major visual redesign was made. Production employee rollout still depends on the launch configuration below.

| Area                                              | Final status          | Evidence                                                                                                                                                 |
| ------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent Supabase connection                   | IMPLEMENTED           | New healthy project `bbbgrxvidrlmrrezfmil` in le chic; three migrations applied; live SQL assertions passed.                                             |
| Password sign-in and preapproved enrollment guard | IMPLEMENTED           | Live Auth password sign-in; database enrollment/ownership assertions. Owner account/email-delivery acceptance remains pending.                           |
| Catalog, management and granular permissions      | IMPLEMENTED           | Browser CRUD/role workflows and restricted-role SQL tests; escalation paths closed.                                                                      |
| Employee workflow and search                      | IMPLEMENTED           | Real Auth/Data API browser run completed the full workflow and immediate next session.                                                                   |
| Assignments                                       | IMPLEMENTED           | Today-only list, quantity-driven completion, null-target completion, cancellation guard, immutable employee/design after work starts.                    |
| Timers, recovery and duplicate protection         | IMPLEMENTED           | Exact 61/4/5/70-minute test, all-state refresh/reopen, offline replay, concurrent tabs, storage failure, idempotency and deferred integrity constraints. |
| Historical data                                   | IMPLEMENTED           | Names/SKU and KPI targets remain interpretable after rename/deactivation/version changes.                                                                |
| KPIs, fallback, visibility and metrics            | IMPLEMENTED           | SQL and domain assertions plus settings UI test; visibility default restored to OFF after QA.                                                            |
| Analytics and performance                         | IMPLEMENTED           | All six filters change underlying queries/results; no history request from worker screens; server-aggregated historical baseline.                        |
| Mobile/desktop browser layout                     | IMPLEMENTED           | 320/375/390/430 employee widths and 1440 desktop; inspected screenshots; no horizontal overflow or uncaught errors.                                      |
| PWA recovery and update behavior                  | IMPLEMENTED           | Production offline refresh/reopen in all states; waiting update preserves active session; no API response caching.                                       |
| Physical phones and launch mail/access setup      | PARTIALLY IMPLEMENTED | Browser equivalents passed; actual mobile OS tests, SMTP, redirects, owner password and employee sharing remain launch steps.                            |

## Issues fixed

- Pending queue loss when writes failed but reads succeeded.
- In-memory start/acknowledgement changes before durable storage succeeded.
- Rapid-start and cross-tab clearing races; UI actions now have a synchronous guard.
- Expired credentials incorrectly becoming permanent revision conflicts.
- Demo exit/auth callback initialization and stale asynchronous state publication.
- Completed receipt disappearing during automatic refresh.
- Privilege escalation through position activation and privileged employee mutation.
- Assignment completion, old assignment clutter, cancellation and identity mutation races.
- Timezone-string KPI comparisons and editing already-replaced KPI versions.
- Unbounded analytics history downloads, client-only filtering and missing foreign-key indexes.
- Missing database segment continuity validation; explicit ordering supports equal timestamps safely.
- Stale KPI display after visibility changes and inactive-position activity tiles.

## Final verification

Automated tests: **31 passed**, including both PostgreSQL suites. Live SQL suites: **passed**. Real Supabase employee/admin browser runs and production PWA run: **passed**. TypeScript, ESLint and production build are checked for the final source before publication.

The hosted database was cleaned after browser QA: **0 Auth users, 1 reserved administrator profile, 0 sessions, 0 assignments, 0 products, 0 activities, 0 positions; KPI visibility OFF**. No QA passwords or test records remain as production configuration. No Relay or Commissions changes were made.

Security advisors: no WARN/ERROR findings; private-table policy-free RLS INFO notices are intentional deny-all defaults. See VALIDATION.md for links, test scope and remaining limitations. See SETUP.md for owner signup, Auth email/redirect configuration, sharing and physical-device acceptance.

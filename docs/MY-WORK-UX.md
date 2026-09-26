# Employee My Work refinement

Implemented on `employee-my-work-ux`, based on `ab7ea18`, in the existing Le Chic Manufacturing app. The original Flow application is unrelated and was not changed.

## Employee experience

1. **My Work:** greeting/date, position-filtered Supabase activity tiles, assigned designs first, a simple Start state, a focused active screen, fast quantity entry and short completion receipt. Activity order is stable alphabetical order with an ID tie-breaker; no ranking subsystem was introduced.
2. **Workflow:** PIN sign-in → My Work → Activity → assigned Design (when needed) → Start → Work / Walking / Interruption → Finish → Quantity and Save (when needed) → next action.
3. **Tap count:** an assigned production job starts in **3 taps** (Activity, Design, Start). Finishing takes Finish, numeric entry, Save: **2 action taps plus quantity input/keyboard taps**. Continue same activity takes one next-action tap, then Design → Start (**2 setup taps**). No-design work takes Activity → Start; no-quantity work finishes in one tap.
4. **Requires design/product:** an authorized activity editor can switch this off. The selector is then skipped, and the session stores a NULL product ID and no assignment. No placeholder design is created.
5. **Requires quantity:** when off, Finish completes directly and stores NULL quantity. An entered zero remains zero for quantity-based work. Time-only sessions count toward time/activity/employee analytics, but not production-rate denominators or baselines.
6. **Same activity:** the completion receipt keeps the previous activity and returns directly to assigned designs/search, or Start for a designless activity. Choose different activity returns to the activity tiles.
7. **Assignments:** today's assigned/in-progress designs appear before search, with design name, SKU and target when present. Name/SKU search supports partial and case-insensitive matches. Existing assignment status/quantity completion behavior is retained; no additional progress calculation or planning feature was introduced.
8. **Recovery:** existing timestamp segments, user-scoped IndexedDB, Web Locks, ordered commands, request IDs, revision conflicts and recovery archives remain in place. A recovered running/unfinished-quantity session opens directly in My Work. Work/Walking/Interruption continue across display suspension. Offline completion remains queued; next-session actions wait for acknowledgement. Starting new sessions still requires a connection, as before.

## Database and compatibility

9. Migration: `supabase/migrations/20260926205410_employee_my_work_requirements.sql`.
   - Both flags default to true for existing activities and existing sessions because the inspected prior architecture required a product and quantity for every session.
   - Session-level flag snapshots prevent subsequent activity edits from changing active/historical behavior.
   - Product ID becomes nullable with a design-requirement constraint. Completion constraints distinguish NULL from zero. No historical quantities, designs, assignments, employees, KPI records or permissions are rewritten.
   - Existing RPCs, RLS, permission checks, PIN expiration and OM access remain intact. Only the activity editor receives management UI controls.
   - KPI OFF remains hidden; target settings remain respected; actual rates appear after a meaningful quantity exists.

## Verification performed

10. **Mobile browser QA:** local production build, real React UI/SessionStore/IndexedDB, intercepted Supabase boundary. Scenarios A–J passed. Widths 320, 375, 390, 430 and desktop 1440 passed without horizontal overflow. All visible employee-panel controls were at least 44px tall; primary actions are 64px. Search, assignment order, numeric input mode, same-activity continuation, state recovery and queued offline completion were exercised. Screenshots/results are delivered beside the source in `../my-work-qa/`. This is Chrome viewport testing, not physical iPhone/Android testing.
11. **Automated verification:** 106 tests across 7 files pass, including PostgreSQL/PGlite migration/security/session integration and recovery tests. TypeScript, ESLint and production build pass. Static PWA checks passed for protected routes, PIN-first login, direct refresh, mobile login, manifest/icons/scope, offline shell and waiting service-worker update. The existing non-blocking large-JavaScript-chunk build warning remains. No production test records were created.
12. **Remaining real-device checks:** after rollout, use employee and OM accounts on an installed iPhone/Safari and Android/Chrome PWA. Check PIN sign-in/expiration, numeric keyboard with Save visible, screen lock/app switching, close/reopen in each state, airplane-mode completion and reconnect, two-device conflict review, and a service-worker update with pending work. Check actual assignments and configured KPI modes with real permissions. Hosted Supabase/PostgREST and physical-device end-to-end validation remain rollout checks; local PostgreSQL tests do not substitute for those.

## Rollout status

This phase is prepared on a review branch. **It is not published, and the new migration has not been applied to the production Supabase project.** Read-only checks confirmed the live project is still on the six existing migrations. The established app remains at https://lcwork.luhlo.com/.

Apply the new migration to the existing manufacturing project (`bbbgrxvidrlmrrezfmil`) before publishing the frontend through the existing GitHub Pages workflow. Both activity flags initially remain on, so managers can deliberately configure exceptions after release. Do not run a database reset. Do not redeploy older private RPC definitions over this migration. Existing service-worker updates continue waiting for old app windows to close; close/reopen after syncing before configuring new activity combinations.

## Reproduce checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
python3 -m http.server 5187 --bind 127.0.0.1 --directory dist
# In another terminal with Playwright available:
PLAYWRIGHT_MODULE=/path/to/playwright QA_ORIGIN=http://127.0.0.1:5187 node tests/my-work-browser-qa.mjs
PLAYWRIGHT_MODULE=/path/to/playwright QA_ORIGIN=http://127.0.0.1:5187 node tests/static-browser-qa.mjs
```

The browser harness blocks external traffic and uses synthetic fixtures only at the network boundary; example activities are not in production application code. Database tests apply the full migration chain in isolated PostgreSQL/PGlite and roll back synthetic scenarios.

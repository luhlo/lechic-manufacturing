# Categories, optional steps and daily work chronology

Release date: 2026-09-27. Production: https://lcwork.luhlo.com/

## Employee flow

My Work begins with assigned category choices. An active category appears when it is explicitly linked to the employee's active position or has an active activity linked to that position. Explicitly assigned empty categories remain visible even when employee creation is off, with an explanation to ask the manager for an activity. My Work applies this scope even for administrators who can load the full management catalog. Missing/inactive positions have no choices. Category links never grant access to another position's existing activities.

Categories and activities share a count-based layout: 1–4 large tiles, 5–6 medium tiles, 7–8 compact tiles, and 9 or more list rows. More than 12 choices adds search; long lists use normal page scrolling with no truncated records or nested scroll area. The existing green/cream palette is retained. Layout density uses the full assigned choice count, so searching does not turn rows into tiles.

Category → Activity → optional Step → optional Design → explicit Start. Selecting or changing navigation does not create, stop or relabel a session. Assigned designs and case-insensitive name/SKU search remain available. All four design/quantity combinations remain supported. Finish stops the timestamped session immediately; quantity entry cannot extend it. Quantity-free work stores NULL, while an entered zero remains a real quantity.

The chosen category is saved under an employee-specific browser key and revalidated against current active/access rules. Running and awaiting-quantity recovery always owns the screen before navigation preferences. After completion:

- **Continue same activity** keeps the category/activity and a still-valid step, then opens design selection or Start.
- **Another activity in this category** returns to the same category's choices.
- **Change category** clears that employee's preference and returns to category choices.

Unavailable categories fail back to category selection. A moved/deactivated activity cannot continue under stale category context. A deactivated step is reselected, or omitted when steps are no longer applicable. Existing running sessions retain their recorded context.

## Management controls

**Activities → Workflow settings**, beside the existing Add activity surface:

- **Allow employees to add new activities**: defaults OFF for a new installation; enabled in this workspace at the owner's request on 2026-09-29 UTC.
- **Enable activity steps**: defaults OFF, independent of the creation switch.

Both global controls require the existing settings-management capability. Viewing or managing activities does not implicitly grant settings access. The existing full-access role retains both capabilities without an OM-name shortcut.

Expand **Activities → Categories** to add/edit name, active status, display order, **Assign category to positions**, and default **Requires design/product** / **Requires quantity**. Both category defaults initially remain true. Activity managers can choose one category in each activity editor. The only migration seed is **Uncategorized activities**, an editable fallback; no illustrative business configuration is seeded.

**Activities → Filter by category** narrows the management list and combines with text search. All categories remains available, including inactive categories for management. Adding an activity while filtering preselects that category; editing retains the record's actual category.

The activity editor retains its design/quantity switches and adds **Use steps for this activity**, initially OFF. The row's **Steps** button opens step add/rename/order/deactivate controls. Configured steps remain editable and preserved with the global switch OFF. Category/activity/step changes require the existing activity-management capability; records are soft-deactivated rather than deleted.

Employee step choices appear only when the global switch and activity switch are ON and active steps exist. **General activity** is always available. Steps inherit the parent activity's requirements and are optional detail, not a sequence or separate timer.

## Scoped employee creation

With the creation switch ON, **+ New activity** appears at the bottom of the selected category's activity choices, including an empty category. The form shows **Saving under [category]** and only asks for Activity name → Save and select. Saving selects the activity without starting a timer. Connectivity is required. The existing RPC derives the current employee and active position, validates My Work/category access and the current switch, then links the new activity only to that position. Category defaults are copied, the creator is stored, and the action is audited.

Writes share management's transaction lock, including duplicate checks. Names compare case-insensitively after collapsing/stripping whitespace. An accessible match is returned instead of duplicated. A match in another position does not reveal or extend that activity's access. Arbitrary position IDs are not accepted by the employee RPC. Turning creation OFF rejects stale requests and retains saved activities and ongoing work.

## Session architecture and historical data

The existing SessionStore, IndexedDB queue, cross-tab locking, command UUID receipts, revisions, timestamp segments and recovery are reused. Start snapshots category ID/name, optional step ID/name and applicable step settings alongside the existing activity, design and quantity context. All transitions stay in one session. Queued events preserve their original timestamps when synchronized.

Existing activity IDs and position links remain intact in the fallback category. Existing sessions have NULL category/step references and display **Legacy / uncategorized**. Current configuration is never retroactively presented as historical fact. Renaming or moving configuration affects future sessions only.

Step work is not compared with a whole-activity KPI. Baselines require the same activity/design/step scope. Step quantities remain in reporting as **recorded units processed**, but do not satisfy whole-design assignment targets or inflate their progress. Existing general-session assignment behavior is preserved. Processing counts across activities/stages are not unique finished-product counts. KPI visibility remains OFF unless management changes it.

## Time and chronology

Manufacturing display and date boundaries use **America/Chicago** (San Antonio). ISO/timestamptz instants are retained without historical rewrites. The active employee screen adds a small Started / Now clock; the timestamp-based elapsed timer stays primary. Management details display start, actual Finish end, elapsed duration and each segment's clock times. Dates and CDT/CST offsets distinguish midnight and daylight-saving boundaries.

KPI effective-date input is interpreted in Chicago rather than the device zone. Nonexistent or ambiguous daylight-saving wall times are rejected rather than guessed. The separate PIN-expiration America/New_York policy is unchanged.

Open **Analytics → Work timeline**, select an employee and date, and use **Refresh timeline**. Analytics permission is checked by the backend RPC; My Work access does not grant a timeline. The response includes the complete relevant employee chronology, including sessions that began earlier and overlap the selected Chicago day. More than 2,000 relevant sessions yields an explicit error instead of a silently partial report.

Rows remain chronological and can expand into segments. Running work says **In progress** with the response's as-of time; no end is saved or invented. Daily durations clip to the day boundaries, including 23/25-hour DST days. Cross-day quantities are labeled as whole-session counts and are not allocated across days. Time breakdowns use recorded category/activity/step identity and labels; each breakdown contains the same underlying time once, not additive parent/child timers.

Gaps are derived from the union of full session intervals, before any category/activity/design/step filtering. The view deliberately keeps full chronology visible. Only bounded intervals between known sessions count as **Unrecorded time**. Finish, not later quantity save, is the endpoint. Walking and interruption remain recorded time. There are no assumed arrival/departure, shift, lunch, payroll or attendance intervals. Prior-day work that does not overlap the selected day is excluded instead of creating an overnight gap.

Overlaps are flagged and coverage is counted once. Conflicting timestamps withhold ambiguous state breakdowns; invalid chronology also withholds gap totals. Unplaceable records remain explicitly visible for review. Management cannot edit historical timestamps in this phase.

The timeline states **Based on synced records** and its as-of time. It flags this browser's known pending commands but cannot see another phone's offline queue. Refresh or the existing workspace refresh recomputes after delayed sync. No gap is represented as a stored/editable work record or included in production-rate denominators.

## Migrations and production preservation

Created using the project's Supabase CLI migration workflow, tested locally, then actually applied to the independent manufacturing project `bbbgrxvidrlmrrezfmil`:

| Repository migration | Hosted ledger name/version |
| --- | --- |
| `20260927044612_categories_steps_timeline.sql` | `categories_steps_timeline` / `20260927051836` |
| `20260927052023_activity_name_whitespace.sql` | `activity_name_whitespace` / `20260927052052` |

The small follow-up also normalizes tabs/newlines in direct RPC input and rebuilds the corresponding expression index. Current Supabase function/RLS and PostgreSQL timezone documentation were checked before the API changes. Public wrappers are security invokers; private implementations have fixed empty search paths and explicit permissions. The three new tables have RLS and authenticated SELECT only, with no anonymous access to either new RPC.

Before/after counts and complete-row checksums across 17 existing public/private tables matched, excluding only the intentionally added columns. This includes profiles, activity links, sessions/segments, quantities, permission grants, PIN rows, historical targets and command receipts. Both production switches and KPI visibility were confirmed OFF. No production account, session or catalog record was used as a test fixture. Relay and unrelated projects were not modified.

## Verification

### My Work choice update — 2026-09-29 UTC

- `npm run verify`: 155 tests across 12 files, TypeScript, lint, production build and static/PWA checks passed. New regressions cover full management catalogs staying scoped in My Work, empty category assignments, revoked links and inactive/missing positions. Existing SQL suites verify creation permissions, category defaults, duplicate reuse, position isolation and switch-off denial.
- Local browser fixtures exercised both category and activity layouts at 4, 6, 8, 10, 12 and 14 choices, search, empty assigned categories, activity persistence after refresh, duplicate reuse, stale-access denial, and creation disabled by management. The Activities filter combines with search and preselects the category for Add activity. Saving a new activity does not start a session.
- Eight-choice phone layouts passed at 320, 375, 390 and 430 CSS pixels with no horizontal page overflow; choices remained at least 92px tall. List choices were at least 56px tall. Desktop management filtering was checked at 1280px. No browser console errors were observed.
- No schema or function changes were needed. The production employee creation RPC and authenticated-only execution grants were verified. The owner-requested creation switch was enabled through the existing settings row and audited as configuration work, without impersonating an employee. Complete-row checksums across 24 tables found only the expected settings change and one additional audit entry; the other 22 tables, including activities, categories, grants, sessions, PINs and approved devices, were unchanged. No test records were created in production.

### Original category release

- `npm run verify`: **135 tests in 11 files passed**, type checking passed, lint passed, production build passed. The database integration test executes eight transactional SQL suites against isolated PGlite PostgreSQL, including the new hierarchy/creation/step/timeline suite. Follow-up whitespace SQL checks also passed.
- Regression coverage includes four workflows, NULL versus zero, Finish boundary, assignments, offline queue/recovery/idempotency, PIN login/expiry, position permissions, last-admin protection, KPI visibility, and static PWA routes/scope/update behavior.
- New coverage includes category access and account-specific preferences; step switch combinations and continuation; scoped duplicate matching; employee/manager/analyst/anonymous denials; snapshots after move/rename/deactivation; delayed sync; exact gaps and interval union; employee isolation; contradictory clocks; midnight and both DST boundaries.
- Isolated local browser fixtures used the actual React screens and SessionStore with mocked server/auth. Checked categories, sticky refresh, completion actions, step selection/General, running and quantity recovery, all four workflows, SKU search, zero quantity, creation persistence/duplicates, management category/step saves, independent switches, PIN auto sign-in/expired message, and timeline date selection/expanded segments.
- Employee design/active/completion and management timeline were checked at **320, 375, 390 and 430 CSS pixels**. No horizontal page overflow was measured. Primary employee controls were at least 64 pixels high. Desktop timeline was checked at 1280 CSS pixels. No browser error/warning logs were observed in the tested fixture.
- Browser date selection was verified with native keyboard input. This browser automation's programmatic date fill did not trigger React's change event reliably; no synthetic success is claimed from that fill operation.
- Production verification comprises actual migration application, ledger/RLS/grants/default checks, data-preservation checksums, existing GitHub Actions deployment and public HTTPS/PWA asset verification. No authenticated production task was fabricated to test UI flows.

The build retains the existing non-blocking large-JavaScript-chunk advisory. Supabase security advisors report the existing [leaked-password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), plus informational [private tables with RLS and intentionally no client policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Performance findings are informational unused indexes, including newly added indexes without usage history. No new security warning was introduced; billing and authentication policies were not changed.

## Delivery and remaining acceptance

The release uses the existing `main` → GitHub Actions → GitHub Pages workflow. The final task response identifies the deployed commit and run; this document is included in that commit. Existing installed clients receive the new shell through the existing safe service-worker update flow, without forcing a running session to reload.

Still requires physical-device acceptance on an iPhone/Safari and Android/Chrome: install/update, lock/background/reopen an active step session, offline transitions/Finish/quantity then reconnect, verify the manager's refreshed timeline after delayed sync, and change users to confirm remembered categories remain separate. Production configuration and real employee workflows should be accepted by the owner after organizing the fallback category. No browser fixture certifies mobile OS storage/suspension behavior.

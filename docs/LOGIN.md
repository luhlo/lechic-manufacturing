# Username and PIN sign-in

Employees can use their email **or username plus their existing password** on any device. On an approved studio browser, entering the fourth PIN digit signs them in automatically without requesting an email or password. These are real Supabase sessions with the existing employee permissions, RLS and manufacturing session engine.

## Set up an employee

1. The employee must first create and confirm their existing preauthorized email account. This change does not create accounts or assign passwords.
2. Sign in as a manager **using a password**. Open **Employees → Login options** beside the employee.
3. Assign a unique username and four-digit PIN. Username: 3–32 characters, starts with a letter, and accepts letters, numbers, dots, hyphens and underscores. Usernames are case-insensitive. Leading zeroes in PINs are supported. The current PIN is never displayed.
4. On each shared studio browser, an administrator opens **Settings → PIN sign-in devices**, names the device, and selects **Approve this device**.
5. Sign out. Employees can enter only their PIN. Use **Email / username** to return to password login.

Device approval is browser- and origin-specific, expires after 90 days, and is lost if browser storage is cleared. A separately installed PWA may need its own approval. Five incorrect PIN attempts since the last approval lock the device; a successful PIN does not reset that allowance. A manager must sign in with a password and approve that browser again to unlock it. This limits guessing against the small four-digit code space. Only approve devices controlled by the studio.

**Remove approval** blocks future PIN sign-ins on that browser. It does not terminate an existing employee session. A manager can replace or disable an employee's PIN in Login options. Empty PIN fields preserve the current PIN. Inactive employees cannot sign in through these endpoints; deleting an Auth account also deletes its PIN. Accounts with verified MFA factors must continue using password/MFA sign-in.

## Backend and access controls

- Migration: `supabase/migrations/20260926033822_username_and_device_pin_login.sql`. Deployed in project `bbbgrxvidrlmrrezfmil` under migration version `20260926035746`.
- Edge Function: `manufacturing-login`. Deploy all three files in `supabase/functions/manufacturing-login/`. JWT verification at the gateway is disabled because login starts before a session exists. The handler performs its own authentication: an existing password for username login, an approved device secret plus PIN for PIN login, or a server-verified password-authenticated user token for manager actions. CORS is restricted but is not relied upon for authentication.
- The function uses Supabase's built-in server environment variables. No service-role key enters the frontend, build variables, source repository, responses or logs. PINs are HMAC-SHA-256 digests with the service-role key; rotating that key requires managers to reset PINs. High-entropy device tokens are SHA-256 hashed in storage. Browser storage holds the device secret, never an employee PIN.
- Credentials, device hashes and rate-limit records are in private, RLS-enabled tables without client policies or client grants. The RPC is executable only by the service role. Manager identity is obtained from Auth token verification; request-body actor IDs are ignored. Password authentication is required again after PIN login to manage login credentials/devices.
- Employee credentials require `employees.manage`. Updating a privileged employee additionally requires `permissions.manage`, matching the existing employee editor. Device management requires `permissions.manage`. Administrative checks share the existing transaction lock to prevent role-change races. PIN failures use a row lock so concurrent guesses cannot bypass the limit.
- Username login uses the employee's current Auth email internally and verifies the existing password, without returning that email. Attempts are limited to 10 per username per 15 minutes, and 1,000 globally per 15 minutes. Email/password login remains available.
- PIN login first checks a linked, active, confirmed, non-banned, non-anonymous account without verified MFA. It generates and immediately exchanges an existing-account-only recovery token server-side; no email is sent, no account is created, and no password changes. Returned IDs must match the PIN's account. The browser receives only access/refresh tokens and uses `auth.setSession`, so it enters the normal signed-in workflow, not the password-reset screen. Supabase may replace an outstanding recovery link during this exchange; request a fresh reset link when needed. [Supabase generateLink reference](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).
- Audit details record username changes, PIN change/disable flags and device approval/revocation; they exclude PINs, credential digests and device secrets.

## Verification and limits

- 72 unit/integration tests passed, including local PostgreSQL tests for service-only access, manager privilege boundaries, duplicate usernames/PINs, rollback, locks, revocation, expiry, inactive/deleted users, PIN disabling and rate limits. Synthetic Auth fixtures run only inside local PGlite transactions.
- Edge handler tests cover account mismatch, inactive/unconfirmed/banned/MFA account rejection, password-only management, verified actors, hashed credentials, oversized bodies, CORS and redacted responses. Deno type checking passed.
- Local browser checks verified username/email request routing, automatic submission after four digits, a single request per attempt, PIN clearing, no email/password inputs in PIN mode, small-phone layouts and signup/reset screens. Every backend request in this browser test was mocked. Existing static/offline/timer/PWA checks also passed.
- Live negative checks returned 403 for an unapproved PIN device, 401 for an unknown username/password, and 401 for unauthenticated device management. Database privileges were verified on production. Supabase advisors reported only informational findings: [private tables intentionally have no client RLS policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), and [some indexes have no usage yet](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- At rollout there were zero Auth accounts, one reserved employee profile, and no assigned PINs or approved devices. No production accounts, emails or manufacturing records were created for testing. Positive sign-in with a real employee and physical-device installation remain unverified until the owner creates an account and assigns credentials.

The frontend is deployed by GitHub Actions; database and Edge Function changes are deployed separately to the same manufacturing Supabase project. Do not deploy these files to Relay or Commissions.

# Manufacturing product source

The app reads **earring variants** from **020 sku database / Le Chic Miami PIM**:
https://le-chic-pim.lechic-miami.workers.dev/

Source project: `caikfzxvlyzmqvgpvgye`. Destination: `bbbgrxvidrlmrrezfmil`.

## Behavior

- A Supabase Cron job runs every five minutes, including while the app is closed. Designs → **Refresh products** queues the same operation. Open apps reload their catalog every 30 seconds and on focus/reconnection.
- All assigned earring SKUs are linked by permanent PIM variant/product UUIDs. The initial import matches existing canonical SKUs and retains Manufacturing IDs. Later name/photo/status updates target those same IDs. A changed permanent identity/SKU or duplicate SKU fails the whole refresh.
- Only variants whose parent and variant are both active can be selected for new work. Draft/archived records remain available in history. Local Active switches remain independent and are never overwritten by sync.
- Existing designs without a matching source SKU remain retained and editable. The first import retained 82 such records. No fuzzy name matching or deletion is performed.
- Existing sessions, historical labels, employees, permissions, assignments, quantities and timing are not modified. Imported metadata is read-only in Manufacturing; its local availability switch remains editable.
- A successful first import disables the Google Sheet connection. The sheet cannot be reconnected while PIM sync is enabled. Failed refreshes leave the last complete catalog in place and retry on the next schedule.
- Saved catalog/work queues continue using the existing device-scoped offline workflow. New or changed PIM products require connectivity before appearing. Cached photos can display offline; photos never viewed/cached cannot be fetched offline.

## Photos

Select variant-specific saved photography before a generic product cover, then approved marketplace listing photos. Other variants, pending imports, design files and local filesystem references are not substitutes. Empty/unsupported/broken images display no placeholder.

External images are limited to the five observed Shopify, Faire, Etsy and Square CDN hosts in the handler. They load in the browser; neither server fetches arbitrary URLs. Private PIM photos are signed for 24 hours, with the existing URL retained until six hours remain, to keep browser caches stable. Refresh renews those URLs. Photos are not made public or copied between storage accounts.

## Security and operation

`manufacturing-catalog` is deployed only to the **PIM** project, from `integrations/pim/manufacturing-catalog`. Its dedicated randomly generated bearer credential is hashed in `private.manufacturing_catalog_access`. The service-only RPC returns a bounded, consistent SQL snapshot with names, assigned SKUs, availability and the selected photo. It exposes no marketplace credentials, pending imports, audit data or other product types. Disable its access row to revoke the reader.

`manufacturing-pim-sync` is deployed only to **Manufacturing**. A separate job credential authenticates each call. Both the reader token and job token are in Supabase Vault; only the privileged internal RPCs retrieve them. No source-project service key is given to Manufacturing. The source's own Edge runtime uses its built-in key locally. Both functions implement custom authorization and therefore have `verify_jwt=false`; browser/anonymous roles cannot invoke their underlying RPCs.

A five-minute lease prevents concurrent commits. Sync validates the source project, complete bounded payload, snapshot time, earring SKU format, image scheme, UUIDs and unique identities. A lease failure, stale snapshot, partial response, unexpected empty established catalog or conflict rolls back all product changes. Public status/refresh and local availability RPCs require current `products.manage` permission. Sync status never returns secrets.

Cron job: `manufacturing-pim-catalog`, schedule `*/5 * * * *`. Its fixed HTTPS request is `private.queue_pim_sync()`. To pause, set `private.pim_connection.enabled=false`; retain credentials and history. To revoke permanently, also disable the source access row. Do not rotate the unrelated Forms or other app credentials.

Migrations are `20261106073204_manufacturing_catalog_feed` on PIM and `20261106073205_pim_catalog_sync` on Manufacturing. The PIM migration copy in this repository is deployment documentation, **not** a Manufacturing migration. Credentials are provisioned separately and must never be committed.

## Verification — November 6, 2026

- First live run: 354 canonical-SKU matches and five new records; 359 linked variants, 238 currently available, all 359 with selected photo references. 82 unmatched legacy designs retained.
- All 12 existing work sessions, employee records and assignments retained identical fingerprints. PIM products, variants and marketplace listings retained identical fingerprints.
- Local suite: 172 tests including real PostgreSQL/PGlite migration, permission, atomic import, archive, idempotence and legacy workflow checks. HTTP tests cover authentication, pinned hosts, unsafe images, private signing and source failures. PGlite models Vault/HTTP/Cron interfaces; hosted verification checks the real scheduled job separately.
- Security advisors: no new error/warning specific to the integration. Private default-deny tables intentionally have RLS with no policies. Both projects retain their existing leaked-password-protection warning: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

- The first unattended Cron run completed at 07:35 UTC with all 359 variants unchanged, confirming duplicate-free repeated refresh.
- The browser-control connection was unavailable during this release. The authenticated UI was not visually exercised; database/API and production-build checks were completed.

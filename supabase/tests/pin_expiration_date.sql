-- LOCAL ONLY, no real PIN values. Digests here are inert test strings.
begin;
insert into public.profiles(id,email,name) values
 ('40000000-0000-4000-8000-000000000001','expiry-admin@example.invalid','Expiry Admin'),
 ('40000000-0000-4000-8000-000000000002','expiry-worker@example.invalid','Expiry Worker'),
 ('40000000-0000-4000-8000-000000000003','expiry-other@example.invalid','Expiry Other');
insert into auth.users(id,email) select id,email from public.profiles where email like 'expiry-%';
insert into public.profile_roles select '40000000-0000-4000-8000-000000000001',id from public.roles where name='Administrator';
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$ declare admin uuid='40000000-0000-4000-8000-000000000001'; worker uuid='40000000-0000-4000-8000-000000000002'; body jsonb; login jsonb; changed timestamptz; info jsonb; begin
 assert not exists(select 1 from public.profiles where pin_expiration_date is not null),'new column defaults empty';
 perform public.login_gateway('credentials',jsonb_build_object('profile_id',worker,'pin_digest',repeat('a',64)),admin);
 perform public.login_gateway('approve_device',jsonb_build_object('device_digest',repeat('c',64),'name','Date fixture'),admin);
 login=jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64));
 body=jsonb_build_object('id',worker,'name','Expiry Worker','email','expiry-worker@example.invalid');
 update private.login_pins set updated_at=now()-interval '200 days' where profile_id=worker;
 select updated_at into changed from private.login_pins where profile_id=worker;
 perform public.manage('profiles',body||'{"pin_expiration_enabled":false,"pin_expiration_date":"2020-01-01"}');
 assert public.login_gateway('pin',login)->>'user_id'=worker::text,'OFF ignores saved date and PIN age';
 assert private.pin_expires_at(worker) is null,'OFF has no deadline';
 perform public.manage('profiles',body||'{"pin_expiration_enabled":true,"pin_expiration_date":"2099-06-15"}');
 assert public.login_gateway('pin',login)->>'user_id'=worker::text,'future custom date overrides rolling age';
 assert private.pin_expires_at(worker)='2099-06-16T04:00:00Z'::timestamptz,'valid through selected Miami date';
 info=public.login_gateway('credential_status',jsonb_build_object('profile_id',worker),admin);
 assert (info->>'pin_expires_at')::timestamptz='2099-06-16T04:00:00Z'::timestamptz and not (info->>'pin_expired')::boolean,'metadata uses same deadline as gateway';
 assert (select updated_at from private.login_pins where profile_id=worker)=changed,'policy edits do not alter PIN timestamp';
 -- Date-only changes need the same password proof as changing the toggle.
 perform set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',true);
 begin perform public.manage('profiles',body||'{"pin_expiration_date":"2099-06-16"}');raise exception 'FAIL date bypass';exception when insufficient_privilege then null;end;
 assert private.pin_expires_at(worker)='2099-06-16T04:00:00Z'::timestamptz,'failed request preserves deadline';
 perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
 perform set_config('request.jwt.claim.sub',worker::text,true);
 begin perform public.manage('profiles',body||'{"pin_expiration_date":"2099-06-16"}');raise exception 'FAIL worker date change';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 -- Fixed dates are independent of the caller/database session time zone and daylight saving.
 perform set_config('TimeZone','Pacific/Honolulu',true);
 perform public.manage('profiles',body||'{"pin_expiration_date":"2026-03-08"}');
 assert private.pin_expires_at(worker)='2026-03-09T04:00:00Z'::timestamptz,'spring boundary';
 perform public.manage('profiles',body||'{"pin_expiration_date":"2026-11-01"}');
 assert private.pin_expires_at(worker)='2026-11-02T05:00:00Z'::timestamptz,'fall boundary';
 perform set_config('TimeZone','UTC',true);
 perform public.manage('profiles',body||'{"pin_expiration_date":"2020-01-01"}');
 assert public.login_gateway('pin',login)->>'error'='pin_expired','past date returns explicit expiration';
 -- Resetting a credential must not silently extend an administrator-chosen deadline.
 perform public.login_gateway('credentials',jsonb_build_object('profile_id',worker,'pin_digest',repeat('d',64)),admin);
 login=login||jsonb_build_object('pin_digest',repeat('d',64));
 assert public.login_gateway('pin',login)->>'error'='pin_expired','PIN reset keeps fixed deadline';
 perform public.manage('profiles',body||'{"pin_expiration_enabled":false}');
 assert public.login_gateway('pin',login)->>'user_id'=worker::text,'turning toggle off restores PIN access';
 assert (select pin_expiration_date from public.profiles where id=worker)='2020-01-01'::date,'OFF retains chosen date';
 perform public.manage('profiles',body||'{"pin_expiration_enabled":true}');
 assert public.login_gateway('pin',login)->>'error'='pin_expired','re-enabling saved past date expires immediately';
 perform public.manage('profiles',body||'{"pin_expiration_date":null}');
 assert public.login_gateway('pin',login)->>'user_id'=worker::text,'90-day option remains available after reset';
 assert private.pin_expires_at(worker)=now()+interval '90 days','rolling option unchanged';
 begin perform public.manage('profiles',body||'{"pin_expiration_date":"infinity"}');raise exception 'FAIL infinite date';exception when check_violation then null;end;
 begin perform public.manage('profiles',body||'{"pin_expiration_date":"2026-02-30"}');raise exception 'FAIL invalid date';exception when datetime_field_overflow then null;end;
 assert (select count(*) from private.login_pins)=1,'policy operations preserve PIN';
end $$;
set local role authenticated;
do $$ begin
 begin perform private.pin_expires_at('40000000-0000-4000-8000-000000000002');raise exception 'FAIL private helper public';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: custom date, OFF and rolling compatibility, private metadata, password/manager guards, timezone and DST, reset preservation, invalid dates, and no credential loss';
rollback;

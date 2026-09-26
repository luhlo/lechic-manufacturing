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
do $$ declare admin uuid='40000000-0000-4000-8000-000000000001'; worker uuid='40000000-0000-4000-8000-000000000002'; other uuid='40000000-0000-4000-8000-000000000003'; body jsonb; login jsonb; before_change timestamptz; meta jsonb; begin
 assert not exists(select 1 from public.profiles where pin_expiration_enabled),'existing/new profiles default OFF';
 perform public.login_gateway('credentials',jsonb_build_object('profile_id',worker,'pin_digest',repeat('a',64)),admin);
 perform public.login_gateway('credentials',jsonb_build_object('profile_id',other,'pin_digest',repeat('b',64)),admin);
 perform public.login_gateway('approve_device',jsonb_build_object('device_digest',repeat('c',64),'name','Expiry fixture'),admin);
 login=jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64));
 body=jsonb_build_object('id',worker,'name','Expiry Worker','email','expiry-worker@example.invalid');
 update private.login_pins set updated_at=now()-interval '120 days';
 select updated_at into before_change from private.login_pins where profile_id=worker;
 -- 1: OFF ignores PIN age (device approval remains independently enforced).
 assert public.login_gateway('pin',login)->>'user_id'=worker::text,'old PIN works when expiration OFF';
 -- 2: ON uses original timestamp; does not grant another 90 days.
 perform public.manage('profiles',body||'{"pin_expiration_enabled":true}');
 assert (select updated_at from private.login_pins where profile_id=worker)=before_change,'toggle does not reset timestamp';
 assert public.login_gateway('pin',login)->>'error'='pin_expired','ON old PIN explicitly expired';
 assert (select failures from private.login_devices where token_digest=repeat('c',64))=0,'expired PIN does not consume incorrect attempts';
 -- 3: Other employees remain independent and OFF.
 assert public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('b',64)))->>'user_id'=other::text,'per-employee policy isolation';
 -- 4: Disabling expiry restores a valid unchanged PIN.
 perform public.manage('profiles',body||'{"pin_expiration_enabled":false}');
 assert public.login_gateway('pin',login)->>'user_id'=worker::text,'disabling expiration restores valid PIN';
 -- 5: Re-enabling preserves original age and expires immediately.
 perform public.manage('profiles',body||'{"pin_expiration_enabled":true}');
 assert public.login_gateway('pin',login)->>'error'='pin_expired','re-enable old PIN';
 -- 6: Legitimate reset renews timestamp and removes expiration lockout.
 perform public.login_gateway('credentials',jsonb_build_object('profile_id',worker,'pin_digest',repeat('d',64)),admin);
 login=login||jsonb_build_object('pin_digest',repeat('d',64));
 assert (select updated_at from private.login_pins where profile_id=worker)=now(),'reset records actual last change';
 assert public.login_gateway('pin',login)->>'user_id'=worker::text,'reset PIN active';
 meta=public.login_gateway('credential_status',jsonb_build_object('profile_id',worker),admin);
 assert (meta->>'pin_changed_at')::timestamptz=now() and (meta->>'pin_expires_at')::timestamptz=now()+interval '90 days','metadata dates';
 assert not (meta->>'pin_expired')::boolean and not meta ? 'digest','metadata redacts credentials';
 -- 7: Threshold is precise; before 90 days valid, at 90 days expired.
 update private.login_pins set updated_at=now()-interval '90 days'+interval '1 second' where profile_id=worker;
 assert public.login_gateway('pin',login)->>'user_id'=worker::text,'before threshold works';
 update private.login_pins set updated_at=now()-interval '90 days' where profile_id=worker;
 assert public.login_gateway('pin',login)->>'error'='pin_expired','exact threshold expires';
 -- 8: A worker or PIN-authenticated administrator cannot change PIN policy.
 perform set_config('request.jwt.claim.sub',worker::text,true);
 begin perform public.manage('profiles',body||'{"pin_expiration_enabled":false}');raise exception 'FAIL employee policy';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',true);
 begin perform public.manage('profiles',body||'{"pin_expiration_enabled":false}');raise exception 'FAIL PIN session policy';exception when insufficient_privilege then null;end;
 -- Username/password path is independent of expiry. Only PIN gateway has an expiry condition.
 perform public.login_gateway('credentials',jsonb_build_object('profile_id',worker,'username','expiry.worker'),admin);
 assert public.login_gateway('username',jsonb_build_object('username','expiry.worker','bucket',repeat('e',64)))->>'user_id'=worker::text,'password fallback still resolves expired employee';
end $$;
select 'PASS: default OFF, aged PIN, ON expiration, independent employees, disable/re-enable, legitimate reset, exact 90-day boundary, private metadata, permissions and password fallback';
rollback;

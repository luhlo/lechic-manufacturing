-- Isolated fixtures only: never use real devices/accounts to test lockouts.
begin;
insert into public.profiles(id,email,name) values
 ('90000000-0000-4000-8000-000000000001','unlock-admin@example.invalid','Unlock admin'),
 ('90000000-0000-4000-8000-000000000002','unlock-worker@example.invalid','Unlock worker'),
 ('90000000-0000-4000-8000-000000000003','unlock-manager@example.invalid','Unlock employee manager');
insert into auth.users(id,email) select id,email from public.profiles where email like 'unlock-%@example.invalid';
insert into public.profile_roles select '90000000-0000-4000-8000-000000000001',id from public.roles where name='Administrator';
insert into public.roles(id,name) values('90000000-0000-4000-8000-000000000010','Unlock limited manager');
insert into public.role_permissions values('90000000-0000-4000-8000-000000000010','employees.manage');
insert into public.profile_roles values('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000010');
insert into private.login_pins(profile_id,auth_user_id,digest) values('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000002',repeat('a',64));
insert into private.login_devices(id,name,token_digest,approved_by,failures,expires_at,revoked) values
 ('90000000-0000-4000-8000-000000000020','Remote locked',repeat('c',64),'90000000-0000-4000-8000-000000000001',5,now()+interval '7 days',false),
 ('90000000-0000-4000-8000-000000000021','Other locked',repeat('d',64),'90000000-0000-4000-8000-000000000001',5,now()+interval '3 days',false),
 ('90000000-0000-4000-8000-000000000022','Removed',repeat('e',64),'90000000-0000-4000-8000-000000000001',5,now()+interval '3 days',true),
 ('90000000-0000-4000-8000-000000000023','Expired',repeat('f',64),'90000000-0000-4000-8000-000000000001',5,now()-interval '1 day',false);
create temp table unlock_before as select * from private.login_devices;
-- Authenticated callers cannot forge an actor or update the private table directly.
set local role authenticated;
do $$ begin
 begin perform public.login_gateway('unlock_device','{"id":"90000000-0000-4000-8000-000000000020"}','90000000-0000-4000-8000-000000000001');raise exception 'FAIL direct gateway';exception when insufficient_privilege then null;end;
 begin update private.login_devices set failures=0;raise exception 'FAIL direct update';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role service_role;
do $$ declare admin uuid='90000000-0000-4000-8000-000000000001'; worker uuid='90000000-0000-4000-8000-000000000002'; manager uuid='90000000-0000-4000-8000-000000000003'; p jsonb='{"id":"90000000-0000-4000-8000-000000000020"}'; result jsonb; login jsonb=jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64)); begin
 assert public.login_gateway('pin',login)->>'error'='device_locked';
 begin perform public.login_gateway('unlock_device',p,worker);raise exception 'FAIL worker';exception when insufficient_privilege then null;end;
 begin perform public.login_gateway('unlock_device',p,manager);raise exception 'FAIL employee manager';exception when insufficient_privilege then null;end;
 begin perform public.login_gateway('unlock_device',p,null);raise exception 'FAIL missing actor';exception when insufficient_privilege then null;end;
 result=public.login_gateway('unlock_device',p,admin);
 assert result->>'id'=p->>'id' and result->>'locked'='false','unlock returns sanitized status';
 assert not result ? 'token_digest' and not result ? 'token','no token needed or exposed';
 assert public.login_gateway('pin',login)->>'user_id'=worker::text,'original browser secret and PIN work after remote unlock';
 -- A stale double-click/retry must not erase a new incorrect attempt on an unlocked device.
 perform public.login_gateway('pin',login||jsonb_build_object('pin_digest',repeat('b',64)));
 assert public.login_gateway('unlock_device',p,admin)=result,'unlocked response is repeat-safe';
 -- Removed/expired/missing devices are not reapproved or extended by this action.
 begin perform public.login_gateway('unlock_device','{"id":"90000000-0000-4000-8000-000000000022"}',admin);raise exception 'FAIL revoked';exception when invalid_parameter_value then null;end;
 begin perform public.login_gateway('unlock_device','{"id":"90000000-0000-4000-8000-000000000023"}',admin);raise exception 'FAIL expired';exception when invalid_parameter_value then null;end;
 begin perform public.login_gateway('unlock_device','{"id":"90000000-0000-4000-8000-000000000099"}',admin);raise exception 'FAIL missing';exception when invalid_parameter_value then null;end;
end $$;
reset role;
do $$ begin
 assert (select failures from private.login_devices where id='90000000-0000-4000-8000-000000000020')=1,'retry preserves new failed attempt';
 assert not exists(select 1 from private.login_devices d join unlock_before b using(id) where to_jsonb(d)-'failures' is distinct from to_jsonb(b)-'failures'),'token/expiry/name/approver preserved';
 assert not exists(select 1 from private.login_devices d join unlock_before b using(id) where d.id<>'90000000-0000-4000-8000-000000000020' and to_jsonb(d) is distinct from to_jsonb(b)),'other devices unchanged';
 assert (select count(*) from private.audit_log where entity='login_device' and record_id='90000000-0000-4000-8000-000000000020' and details->>'action'='unlocked')=1,'one audit for actual reset';
 assert exists(select 1 from private.audit_log where actor_id='90000000-0000-4000-8000-000000000001' and record_id='90000000-0000-4000-8000-000000000020' and details='{"action":"unlocked","previous_failures":5}'::jsonb and created_at is not null),'trusted actor/device/count/time audit';
end $$;
-- Current active identity and current permissions, not old token claims, authorize unlock.
update public.profiles set active=false where id='90000000-0000-4000-8000-000000000001';
do $$ begin
 begin perform public.login_gateway('unlock_device','{"id":"90000000-0000-4000-8000-000000000021"}','90000000-0000-4000-8000-000000000001');raise exception 'FAIL inactive admin';exception when insufficient_privilege then null;end;
end $$;
update public.profiles set active=true where id='90000000-0000-4000-8000-000000000001';
update auth.users set banned_until=now()+interval '1 day' where id='90000000-0000-4000-8000-000000000001';
do $$ begin
 begin perform public.login_gateway('unlock_device','{"id":"90000000-0000-4000-8000-000000000021"}','90000000-0000-4000-8000-000000000001');raise exception 'FAIL banned admin';exception when insufficient_privilege then null;end;
end $$;
update auth.users set banned_until=null where id='90000000-0000-4000-8000-000000000001';
delete from public.profile_roles where profile_id='90000000-0000-4000-8000-000000000001';
do $$ begin
 begin perform public.login_gateway('unlock_device','{"id":"90000000-0000-4000-8000-000000000021"}','90000000-0000-4000-8000-000000000001');raise exception 'FAIL revoked permission';exception when insufficient_privilege then null;end;
end $$;
select 'PASS: remote PIN unlock, existing admin access, no client actor forgery, original token and expiry preserved, no reapproval, retry safety, current permissions and audit';
rollback;

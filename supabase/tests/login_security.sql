-- LOCAL PGlite fixtures only. Never run these account fixtures in production.
begin;
insert into public.profiles(id,email,name) values
('20000000-0000-4000-8000-000000000001','pin-admin@example.invalid','PIN admin'),
('20000000-0000-4000-8000-000000000002','pin-worker@example.invalid','PIN worker'),
('20000000-0000-4000-8000-000000000003','pin-other@example.invalid','PIN other'),
('20000000-0000-4000-8000-000000000004','pin-unlinked@example.invalid','PIN unlinked'),
('20000000-0000-4000-8000-000000000005','pin-manager@example.invalid','PIN limited manager');
insert into auth.users(id,email) select id,email from public.profiles where email like 'pin-%@example.invalid' and name<>'PIN unlinked';
insert into public.profile_roles select '20000000-0000-4000-8000-000000000001',id from public.roles where name='Administrator';
insert into public.roles(id,name) values('20000000-0000-4000-8000-000000000010','PIN employee manager');
insert into public.role_permissions values('20000000-0000-4000-8000-000000000010','employees.manage');
insert into public.profile_roles values('20000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000010');
do $$ declare r text; t text; begin
 foreach r in array array['anon','authenticated'] loop
  assert not has_function_privilege(r,'public.login_gateway(text,jsonb,uuid)','execute'),'public gateway denied';
  assert not has_function_privilege(r,'private.login_gateway(text,jsonb,uuid)','execute'),'private gateway denied';
  foreach t in array array['login_pins','login_devices','login_limits'] loop
   assert not has_table_privilege(r,'private.'||t,'select'),'private credentials unreadable';
  end loop;
 end loop;
 assert has_function_privilege('service_role','public.login_gateway(text,jsonb,uuid)','execute'),'service can use gateway';
end $$;
set local role authenticated;
do $$ begin
 begin perform public.login_gateway('devices','{}','20000000-0000-4000-8000-000000000001');raise exception 'FAIL forged actor';exception when insufficient_privilege then null;end;
 begin perform digest from private.login_pins;raise exception 'FAIL leaked PIN';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role service_role;
do $$ declare admin uuid='20000000-0000-4000-8000-000000000001'; worker uuid='20000000-0000-4000-8000-000000000002'; manager uuid='20000000-0000-4000-8000-000000000005'; p jsonb; result jsonb; d jsonb; begin
 begin perform public.login_gateway('devices','{}',worker);raise exception 'FAIL worker device approval';exception when insufficient_privilege then null;end;
 begin perform public.login_gateway('devices','{}',manager);raise exception 'FAIL limited manager devices';exception when insufficient_privilege then null;end;
 begin perform public.login_gateway('credential_status',jsonb_build_object('profile_id',admin),manager);raise exception 'FAIL manager targets admin';exception when insufficient_privilege then null;end;
 begin perform public.login_gateway('credentials',jsonb_build_object('profile_id',manager,'username','myself','pin_digest',repeat('a',64)),manager);raise exception 'FAIL privileged self reset';exception when insufficient_privilege then null;end;
 p=jsonb_build_object('profile_id',worker,'username','  WORKER.One  ','pin_digest',repeat('a',64));
 perform public.login_gateway('credentials',p,manager);
 result=public.login_gateway('credential_status',jsonb_build_object('profile_id',worker),admin);
 assert result->>'username'='worker.one' and (result->>'pin_enabled')::boolean,'normalized username and PIN saved';
 begin perform public.login_gateway('credentials',p||jsonb_build_object('profile_id','20000000-0000-4000-8000-000000000003','username','other.one'),admin);raise exception 'FAIL duplicate PIN';exception when unique_violation then null;end;
 begin perform public.login_gateway('credentials',p||jsonb_build_object('profile_id','20000000-0000-4000-8000-000000000003','pin_digest',repeat('b',64)),admin);raise exception 'FAIL duplicate username';exception when unique_violation then null;end;
 begin perform public.login_gateway('credentials',p||'{"username":"@bad"}',admin);raise exception 'FAIL invalid username';exception when raise_exception then if SQLERRM like 'FAIL%' then raise;end if;end;
 begin perform public.login_gateway('credentials',p||jsonb_build_object('profile_id','20000000-0000-4000-8000-000000000004','username','notready'),admin);raise exception 'FAIL unlinked PIN';exception when raise_exception then if SQLERRM like 'FAIL%' then raise;end if;end;
 assert public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64)))->>'error'='device_unapproved','unknown device fails';
 d=public.login_gateway('approve_device',jsonb_build_object('device_digest',repeat('c',64),'name','Local test tablet'),admin);
 assert not d ? 'token_digest' and not public.login_gateway('devices','{}',admin)::text like '%token_digest%','device hashes stay private';
 assert public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64)))->>'user_id'=worker::text,'unique PIN resolves correct employee';
 for i in 1..4 loop
  assert public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('f',64)))->>'error'='invalid_pin','failed PIN counted';
 end loop;
 -- Success must not reset a stolen device's guessing allowance.
 perform public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64)));
 assert public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('f',64)))->>'error'='device_locked','fifth failure locks device';
 assert public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64)))->>'error'='device_locked','correct PIN cannot bypass lock';
 perform public.login_gateway('approve_device',jsonb_build_object('device_digest',repeat('c',64),'name','Local test tablet'),admin);
 assert public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64)))->>'user_id'=worker::text,'password manager can unlock';
 perform public.login_gateway('revoke_device',jsonb_build_object('id',d->>'id'),admin);
 assert public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64)))->>'error'='device_unapproved','revocation enforced';
 perform public.login_gateway('approve_device',jsonb_build_object('device_digest',repeat('c',64),'name','Local test tablet'),admin);
 for i in 1..10 loop
  assert public.login_gateway('username',jsonb_build_object('bucket',repeat('d',64),'username','worker.one'))->>'user_id'=worker::text,'username resolves with bounded attempts';
 end loop;
  assert public.login_gateway('username',jsonb_build_object('bucket',repeat('d',64),'username','worker.one'))->>'error'='rate_limited','11th username attempt rejected';
 perform public.login_gateway('credentials',jsonb_build_object('profile_id',worker,'username','worker.one','disable_pin',true),admin);
 assert public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64)))->>'error'='invalid_pin','disabled PIN cannot authenticate';
 perform public.login_gateway('credentials',p,admin);
end $$;
reset role;
do $$ begin
 assert not exists(select 1 from private.audit_log where entity like 'login_%' and (details::text like '%'||repeat('a',64)||'%' or details::text like '%'||repeat('c',64)||'%')),'audit contains no credentials';
 assert (select username from public.profiles where id='20000000-0000-4000-8000-000000000003') is null,'failed duplicate request rolls back username';
end $$;
update public.profiles set active=false where id='20000000-0000-4000-8000-000000000002';
do $$ begin
 assert public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64)))->>'error'='invalid_pin','inactive employee cannot use PIN';
 assert public.login_gateway('username',jsonb_build_object('bucket',repeat('e',64),'username','worker.one'))->>'user_id' is null,'inactive username cannot sign in';
end $$;
update private.login_devices set expires_at=now()-interval '1 second';
do $$ begin
 assert public.login_gateway('pin',jsonb_build_object('device_digest',repeat('c',64),'pin_digest',repeat('a',64)))->>'error'='device_unapproved','expired device denied';
end $$;
update private.login_limits set attempts=1000 where bucket='username-global';
do $$ begin
 assert public.login_gateway('username',jsonb_build_object('bucket',repeat('f',64),'username','unknown'))->>'error'='rate_limited','global limit bounds unknown username spray';
end $$;
update private.login_limits set started_at=now()-interval '16 minutes';
do $$ begin
 assert public.login_gateway('username',jsonb_build_object('bucket',repeat('d',64),'username','unknown'))->>'error' is null,'rate limit window expires';
end $$;
delete from auth.users where id='20000000-0000-4000-8000-000000000002';
do $$ begin
 assert not exists(select 1 from private.login_pins where profile_id='20000000-0000-4000-8000-000000000002'),'deleting an account invalidates its PIN permanently';
end $$;
select 'PASS: private credentials, service-only gateway, manager scope, uniqueness, rollback, device approval/expiry/revocation, persistent lockout, inactive/deleted employees, PIN disabling, audit redaction and username limits' as result;
rollback;

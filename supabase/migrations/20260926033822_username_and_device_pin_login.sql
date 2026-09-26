-- PIN digests and device secrets never enter the public catalog or audit details.
alter table public.profiles add column username text;
alter table public.profiles add constraint profiles_username_format check(username is null or username ~ '^[a-z][a-z0-9._-]{2,31}$');
create unique index profiles_username_unique on public.profiles(username) where username is not null;
create table private.login_pins(profile_id uuid primary key references public.profiles(id), auth_user_id uuid not null unique references auth.users(id) on delete cascade, digest text not null unique check(digest ~ '^[0-9a-f]{64}$'), updated_at timestamptz not null default now());
create table private.login_devices(id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 80), token_digest text not null unique check(token_digest ~ '^[0-9a-f]{64}$'), approved_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '90 days', revoked boolean not null default false, failures integer not null default 0 check(failures between 0 and 5));
create index login_devices_approved_by on private.login_devices(approved_by);
create table private.login_limits(bucket text primary key, attempts integer not null, started_at timestamptz not null default now());
alter table private.login_pins enable row level security;
alter table private.login_devices enable row level security;
alter table private.login_limits enable row level security;
revoke all on private.login_pins,private.login_devices,private.login_limits from public,anon,authenticated;

-- Only the authenticated Edge Function service role can invoke this gateway.
-- actor is derived from a verified user token by the function, never from its request body.
create function private.login_gateway(action text, payload jsonb, actor uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare who uuid; can_employees boolean; can_devices boolean; device private.login_devices; target public.profiles; u text; n integer; result jsonb;
begin
 if action='username' then
  insert into private.login_limits(bucket,attempts) values('username-global',1)
  on conflict(bucket) do update set attempts=case when login_limits.started_at<now()-interval '15 minutes' then 1 else least(login_limits.attempts+1,1001) end, started_at=case when login_limits.started_at<now()-interval '15 minutes' then now() else login_limits.started_at end returning attempts into n;
  if n>1000 then return jsonb_build_object('error','rate_limited');end if;
  if length(coalesce(payload->>'bucket',''))<>64 then raise exception 'Invalid request';end if;
  insert into private.login_limits(bucket,attempts) values(payload->>'bucket',1)
  on conflict(bucket) do update set attempts=case when login_limits.started_at<now()-interval '15 minutes' then 1 else least(login_limits.attempts+1,11) end, started_at=case when login_limits.started_at<now()-interval '15 minutes' then now() else login_limits.started_at end
  returning attempts into n;
  -- Bounded cleanup prevents unbounded expired rate-limit records.
  delete from private.login_limits where bucket in(select bucket from private.login_limits where started_at<now()-interval '1 day' limit 100);
  if n>10 then return jsonb_build_object('error','rate_limited');end if;
  select * into target from public.profiles where username=payload->>'username' and active and auth_user_id is not null;
  return jsonb_build_object('user_id',target.auth_user_id);
 elsif action='pin' then
  select * into device from private.login_devices where token_digest=payload->>'device_digest' for update;
  if device.id is null or device.revoked or device.expires_at<=now() then return jsonb_build_object('error','device_unapproved');end if;
  if device.failures>=5 then return jsonb_build_object('error','device_locked');end if;
  select p.* into target from private.login_pins lp join public.profiles p on p.id=lp.profile_id and p.auth_user_id=lp.auth_user_id where lp.digest=payload->>'pin_digest' and p.active;
  if target.id is null then
   update private.login_devices set failures=failures+1 where id=device.id;
   return jsonb_build_object('error',case when device.failures=4 then 'device_locked' else 'invalid_pin' end);
  end if;
  return jsonb_build_object('user_id',target.auth_user_id);
 end if;
 -- Share the existing administration lock so permission changes cannot race a reset.
 perform pg_advisory_xact_lock(8417201);
 select id into who from public.profiles where auth_user_id=actor and active;
 if who is null then raise exception 'Permission denied' using errcode='42501';end if;
 select coalesce(bool_or(rp.permission_id in ('*','employees.manage')),false),coalesce(bool_or(rp.permission_id in ('*','permissions.manage')),false)
 into can_employees,can_devices from public.roles r join public.role_permissions rp on rp.role_id=r.id
 where r.active and (exists(select 1 from public.profile_roles pr where pr.role_id=r.id and pr.profile_id=who) or exists(select 1 from public.position_roles pr join public.positions ps on ps.id=pr.position_id and ps.active join public.profiles p on p.position_id=ps.id where pr.role_id=r.id and p.id=who));
 if action in ('credentials','credential_status') then
  if not can_employees then raise exception 'Permission denied' using errcode='42501';end if;
  select * into target from public.profiles where id=(payload->>'profile_id')::uuid for update;
  if target.id is null then raise exception 'Employee not found';end if;
  -- Employee managers must not gain another role by assigning its owner a PIN.
  -- Match the existing employee editor's restrictions, including inactive grants.
  if not can_devices and (
   exists(select 1 from public.profile_roles pr join public.role_permissions rp on rp.role_id=pr.role_id where pr.profile_id=target.id)
   or exists(select 1 from public.position_roles pr where pr.position_id=target.position_id)
  ) then raise exception 'Permission management is required to change a privileged employee' using errcode='42501';end if;
  if action='credential_status' then return jsonb_build_object('username',target.username,'user_id',target.auth_user_id,'pin_enabled',exists(select 1 from private.login_pins where profile_id=target.id));end if;
  u=nullif(lower(trim(payload->>'username')),'');
  if u is not null and u !~ '^[a-z][a-z0-9._-]{2,31}$' then raise exception 'Use 3–32 letters, numbers, dots, hyphens or underscores, starting with a letter.';end if;
  update public.profiles set username=u where id=target.id;
  if coalesce((payload->>'disable_pin')::boolean,false) then delete from private.login_pins where profile_id=target.id;
  elsif payload->>'pin_digest' is not null then
   if not target.active or target.auth_user_id is null then raise exception 'The employee must finish creating their account first.';end if;
   insert into private.login_pins(profile_id,auth_user_id,digest) values(target.id,target.auth_user_id,payload->>'pin_digest') on conflict(profile_id) do update set auth_user_id=excluded.auth_user_id,digest=excluded.digest,updated_at=now();
  end if;
  insert into private.audit_log(actor_id,entity,record_id,details) values(who,'login_credentials',target.id::text,jsonb_build_object('username',u,'pin_changed',payload->>'pin_digest' is not null,'pin_disabled',coalesce((payload->>'disable_pin')::boolean,false)));
  return jsonb_build_object('ok',true);
 elsif action in ('devices','approve_device','revoke_device') then
  if not can_devices then raise exception 'Permission denied' using errcode='42501';end if;
  if action='devices' then
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'expires_at',expires_at,'locked',failures>=5) order by created_at desc),'[]') into result from private.login_devices where not revoked and expires_at>now();return result;
  elsif action='approve_device' then
   if (select count(*) from private.login_devices where not revoked and expires_at>now())>=50 and not exists(select 1 from private.login_devices where token_digest=payload->>'device_digest') then raise exception 'Remove an old device before approving another.';end if;
   insert into private.login_devices(name,token_digest,approved_by) values(trim(payload->>'name'),payload->>'device_digest',who)
   on conflict(token_digest) do update set name=excluded.name,approved_by=who,revoked=false,failures=0,expires_at=now()+interval '90 days' returning * into device;
   insert into private.audit_log(actor_id,entity,record_id,details) values(who,'login_device',device.id::text,jsonb_build_object('action','approved','name',device.name));
   return jsonb_build_object('id',device.id,'name',device.name,'expires_at',device.expires_at);
  else
   update private.login_devices set revoked=true where id=(payload->>'id')::uuid;
   insert into private.audit_log(actor_id,entity,record_id,details) values(who,'login_device',payload->>'id',jsonb_build_object('action','revoked'));
   return jsonb_build_object('ok',true);
  end if;
 end if;
 raise exception 'Invalid request';
end $$;
create function public.login_gateway(action text,payload jsonb,actor uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.login_gateway(action,payload,actor) $$;
revoke all on function private.login_gateway(text,jsonb,uuid),public.login_gateway(text,jsonb,uuid) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.login_gateway(text,jsonb,uuid),public.login_gateway(text,jsonb,uuid) to service_role;

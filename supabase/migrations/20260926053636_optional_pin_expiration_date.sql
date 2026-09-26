-- Optional fixed PIN expiration. Existing OFF/90-day policies and all PINs remain unchanged.
alter table public.profiles add column pin_expiration_date date;
alter table public.profiles add constraint pin_expiration_finite_date check(pin_expiration_date is null or (isfinite(pin_expiration_date) and pin_expiration_date between date '0001-01-01' and date '9999-12-31'));
comment on column public.profiles.pin_expiration_date is 'When expiration is enabled, PIN is valid through this date in America/New_York. NULL retains the existing rolling 90-day policy. Ignored when disabled.';

create function private.pin_expires_at(person uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
 select case when not p.pin_expiration_enabled then null
 when p.pin_expiration_date is not null then (p.pin_expiration_date+1)::timestamp at time zone 'America/New_York'
 else lp.updated_at+interval '90 days' end
 from public.profiles p join private.login_pins lp on lp.profile_id=p.id where p.id=person
$$;
revoke all on function private.pin_expires_at(uuid) from public,anon,authenticated;

create or replace function private.manage(p_entity text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare who uuid=private.me(); rid uuid=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); permission text; existing uuid; result jsonb; old public.kpi_targets; item jsonb; access_role uuid; is_new boolean; begin
 permission=case p_entity when 'profiles' then 'employees.manage' when 'positions' then 'positions.manage' when 'activities' then 'activities.manage' when 'products' then 'products.manage' when 'assignments' then 'assignments.manage' when 'kpi_targets' then 'kpis.manage' when 'settings' then 'settings.manage' when 'roles' then 'permissions.manage' when 'profile_roles' then 'permissions.manage' when 'position_roles' then 'permissions.manage' when 'position_access' then 'permissions.manage' end;
 perform pg_advisory_xact_lock(8417201);
 if who is null or permission is null or not private.can(permission) then raise exception 'Permission denied' using errcode='42501';end if;
 -- Serialize administration to protect the last administrator and avoid lost role updates.
 perform pg_advisory_xact_lock(8417201);
 if p_entity='positions' then is_new=not exists(select 1 from public.positions where id=rid);end if;
 if p_entity in ('positions','activities') then
  if p_entity='positions' then
   if not private.can('permissions.manage') and private.privileged_position(rid) then raise exception 'Permission management is required to change a privileged position' using errcode='42501';end if;
   insert into public.positions(id,name,active) values(rid,trim(p->>'name'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,active=excluded.active;
   if is_new then insert into public.position_roles select rid,id from public.roles where name='Employee';end if;
  else insert into public.activities(id,name,active) values(rid,trim(p->>'name'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,active=excluded.active;
   delete from public.activity_positions where activity_id=rid;insert into public.activity_positions select rid,value::uuid from jsonb_array_elements_text(coalesce(p->'position_ids','[]'));
  end if;
 elsif p_entity='products' then insert into public.products(id,name,sku,active) values(rid,trim(p->>'name'),trim(p->>'sku'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,sku=excluded.sku,active=excluded.active;
 elsif p_entity='profiles' then
  if trim(p->>'email')!~'^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email';end if;
  if exists(select 1 from public.profiles where id=rid and auth_user_id is not null and lower(email)<>lower(trim(p->>'email'))) then raise exception 'Linked sign-in email cannot be changed here';end if;
  if not private.can('permissions.manage') and (private.privileged_profile(rid) or private.privileged_position(nullif(p->>'position_id','')::uuid)) then raise exception 'Permission management is required to change a privileged employee or position' using errcode='42501';end if;
  if ((p ? 'pin_expiration_enabled' and coalesce((p->>'pin_expiration_enabled')::boolean,false) is distinct from coalesce((select pin_expiration_enabled from public.profiles where id=rid),false))
   or (p ? 'pin_expiration_date' and nullif(p->>'pin_expiration_date','')::date is distinct from (select pin_expiration_date from public.profiles where id=rid)))
   and not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) a where a->>'method'='password') then
   raise exception 'Sign in with your password to change PIN expiration' using errcode='42501';end if;
  insert into public.profiles(id,name,email,position_id,active,external_employee_id) values(rid,trim(p->>'name'),lower(trim(p->>'email')),nullif(p->>'position_id','')::uuid,coalesce((p->>'active')::boolean,true),nullif(p->>'external_employee_id','')) on conflict(id) do update set name=excluded.name,email=excluded.email,position_id=excluded.position_id,active=excluded.active,external_employee_id=excluded.external_employee_id;

  if p ? 'pin_expiration_enabled' then update public.profiles set pin_expiration_enabled=(p->>'pin_expiration_enabled')::boolean where id=rid;end if;
  if p ? 'pin_expiration_date' then update public.profiles set pin_expiration_date=nullif(p->>'pin_expiration_date','')::date where id=rid;end if;
 elsif p_entity='assignments' then
  perform 1 from public.assignments where id=rid for update;
  if exists(select 1 from public.sessions where assignment_id=rid) and exists(select 1 from public.assignments where id=rid and (employee_id is distinct from (p->>'employee_id')::uuid or product_id is distinct from (p->>'product_id')::uuid)) then raise exception 'Work has started. Create a new assignment to change its employee or design.';end if;
  if not exists(select 1 from public.profiles where id=(p->>'employee_id')::uuid and active) or not exists(select 1 from public.products where id=(p->>'product_id')::uuid and active) then raise exception 'Choose an active employee and design';end if;
  insert into public.assignments(id,employee_id,product_id,work_date,target_quantity,status,notes,assigned_by) values(rid,(p->>'employee_id')::uuid,(p->>'product_id')::uuid,(p->>'work_date')::date,nullif(p->>'target_quantity','')::integer,coalesce(p->>'status','assigned'),coalesce(p->>'notes',''),who) on conflict(id) do update set employee_id=excluded.employee_id,product_id=excluded.product_id,work_date=excluded.work_date,target_quantity=excluded.target_quantity,status=excluded.status,notes=excluded.notes;
 elsif p_entity='kpi_targets' then
  if p->>'id' is not null then select * into old from public.kpi_targets where id=rid;if old.id is null then raise exception 'KPI version not found';end if;
   if old.valid_until is not null or exists(select 1 from public.kpi_targets where supersedes_id=old.id) then raise exception 'This KPI version was replaced. Edit its latest version.';end if;
   if coalesce(nullif(p->>'effective_from','')::timestamptz,now())<old.effective_from then raise exception 'A new KPI version cannot begin before its predecessor';end if;update public.kpi_targets set valid_until=coalesce(nullif(p->>'effective_from','')::timestamptz,now()) where id=rid;rid=gen_random_uuid();end if;
  insert into public.kpi_targets(id,activity_id,product_id,target_value,active,effective_from,supersedes_id,changed_by) values(rid,(p->>'activity_id')::uuid,nullif(p->>'product_id','')::uuid,(p->>'target_value')::numeric,coalesce((p->>'active')::boolean,true),coalesce(nullif(p->>'effective_from','')::timestamptz,now()),old.id,who);
 elsif p_entity='settings' then update public.settings set employee_kpi_visibility=p->>'employee_kpi_visibility',updated_by=who where id='main';
 elsif p_entity='roles' then
  if exists(select 1 from public.roles where id=rid and managed_position_id is not null) then raise exception 'Edit this access in Positions';end if;
  insert into public.roles(id,name,active) values(rid,trim(p->>'name'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,active=excluded.active;
  delete from public.role_permissions where role_id=rid;insert into public.role_permissions select rid,value from jsonb_array_elements_text(coalesce(p->'permission_ids','[]'));
 elsif p_entity='position_access' then
  if not exists(select 1 from public.positions where id=rid) then raise exception 'Position not found';end if;
  if jsonb_typeof(p->'permission_ids') is distinct from 'array' then raise exception 'Choose position access';end if;
  insert into public.roles(name,managed_position_id) values('Position access '||rid::text,rid)
   on conflict(managed_position_id) do update set active=true returning id into access_role;
  delete from public.role_permissions where role_id=access_role;
  insert into public.role_permissions select access_role,value from (select distinct value from jsonb_array_elements_text(p->'permission_ids')) x;
  -- Replace this position's grants atomically; existing reusable roles and employee overrides survive.
  delete from public.position_roles where position_id=rid;
  insert into public.position_roles values(rid,access_role);
 elsif p_entity='profile_roles' then
  if exists(select 1 from jsonb_array_elements_text(coalesce(p->'role_ids','[]')) x join public.roles r on r.id=x.value::uuid where r.managed_position_id is not null) then raise exception 'Use Positions to configure position access';end if;
  delete from public.profile_roles where profile_id=rid;insert into public.profile_roles select rid,value::uuid from jsonb_array_elements_text(coalesce(p->'role_ids','[]'));
 elsif p_entity='position_roles' then
  if exists(select 1 from jsonb_array_elements_text(coalesce(p->'role_ids','[]')) x join public.roles r on r.id=x.value::uuid where r.managed_position_id is not null) then raise exception 'Use Positions to configure position access';end if;
  delete from public.position_roles where position_id=rid;insert into public.position_roles select rid,value::uuid from jsonb_array_elements_text(coalesce(p->'role_ids','[]'));
 end if;
 perform private.require_administrator();
 insert into private.audit_log(actor_id,entity,record_id,details) values(who,p_entity,rid::text,p);
 return jsonb_build_object('id',rid);
end $$;

create or replace function private.login_gateway(action text, payload jsonb, actor uuid default null) returns jsonb
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
  if coalesce(private.pin_expires_at(target.id)<=now(),false) then return jsonb_build_object('error','pin_expired');end if;
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
  if not can_devices and private.privileged_profile(target.id) then raise exception 'Permission management is required to change a privileged employee' using errcode='42501';end if;
  if action='credential_status' then return jsonb_build_object('username',target.username,'user_id',target.auth_user_id,
   'pin_enabled',exists(select 1 from private.login_pins where profile_id=target.id),
   'pin_expiration_enabled',target.pin_expiration_enabled,
   'pin_changed_at',(select updated_at from private.login_pins where profile_id=target.id),
   'pin_expires_at',private.pin_expires_at(target.id),
   'pin_expired',coalesce(private.pin_expires_at(target.id)<=now(),false));end if;
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


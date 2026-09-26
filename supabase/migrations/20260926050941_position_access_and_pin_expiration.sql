-- Position access extends the existing role architecture. No credentials or work history are replaced.
alter table public.profiles add column pin_expiration_enabled boolean not null default false;
alter table public.roles add column managed_position_id uuid unique references public.positions(id);
insert into public.permissions(id,name) values
 ('my_work.access','My work'),('dashboard.view','View dashboard'),
 ('assignments.view','View assignments'),('kpis.view','View KPIs'),
 ('employees.view','View employees'),('positions.view','View positions'),
 ('activities.view','View activities'),('products.view','View designs') on conflict(id) do nothing;

-- Management includes viewing only its own module. No name-based authorization.
create function private.has_permission(person uuid, capability text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.roles r on r.active
 join public.role_permissions rp on rp.role_id=r.id
 where p.id=person and p.active and (rp.permission_id in ('*',capability)
 or (capability like '%.view' and rp.permission_id=replace(capability,'.view','.manage')))
 and (exists(select 1 from public.profile_roles x where x.profile_id=p.id and x.role_id=r.id)
 or exists(select 1 from public.position_roles x join public.positions ps on ps.id=x.position_id and ps.active where x.position_id=p.position_id and x.role_id=r.id)))
$$;
create or replace function private.can(p_permission text) returns boolean language sql stable security definer set search_path='' as $$ select private.has_permission(private.me(),p_permission) $$;
-- Include dormant grants in editing protections: activating one must not be an escalation path.
create function private.privileged_position(pos uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.position_roles x join public.role_permissions rp on rp.role_id=x.role_id where x.position_id=pos and rp.permission_id<>'my_work.access') $$;
create function private.privileged_profile(person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profile_roles x join public.role_permissions rp on rp.role_id=x.role_id where x.profile_id=person and rp.permission_id<>'my_work.access')
 or exists(select 1 from public.profiles p where p.id=person and private.privileged_position(p.position_id)) $$;
create function private.require_administrator() returns void language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.auth_user_id
 where p.active and private.has_permission(p.id,'*')
 and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=now()
 and (not to_jsonb(u) ? 'email_confirmed_at' or to_jsonb(u)->>'email_confirmed_at' is not null)) then
 raise exception 'Keep at least one active full-access administrator with a usable login account';end if;
end $$;
revoke all on function private.has_permission(uuid,text),private.privileged_position(uuid),private.privileged_profile(uuid),private.require_administrator() from public,anon,authenticated;

-- Preserve previously implicit My work and Dashboard access for existing employees/roles.
insert into public.role_permissions select distinct role_id,'dashboard.view' from public.role_permissions where permission_id='analytics.view' on conflict do nothing;
insert into public.role_permissions select id,'my_work.access' from public.roles where name='Employee' on conflict do nothing;
insert into public.position_roles select p.id,r.id from public.positions p cross join public.roles r where r.name='Employee' on conflict do nothing;
insert into public.profile_roles select p.id,r.id from public.profiles p cross join public.roles r where p.position_id is null and p.auth_user_id is not null and r.name='Employee' and not private.has_permission(p.id,'*') on conflict do nothing;

-- One-time trusted bootstrap: reuse the existing OM and already-authorized owner, never expose a bootstrap RPC.
do $$ declare pos uuid; admin_role uuid; begin
 select id into pos from public.positions where lower(trim(name))='om';
 select r.id into admin_role from public.roles r join public.role_permissions rp on rp.role_id=r.id where r.active and rp.permission_id='*' order by (r.name='Administrator') desc,r.id limit 1;
 if pos is not null and admin_role is not null then
  insert into public.position_roles values(pos,admin_role) on conflict do nothing;
  update public.profiles set position_id=pos where lower(email)='lechicmiami@gmail.com' and position_id is null and auth_user_id is not null and active and private.has_permission(id,'*');
 end if;
end $$;

create or replace function private.session_command(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare who public.profiles; s public.sessions; seg public.segments; receipt private.command_receipts; aid uuid; pid uuid; asid uuid; req uuid=(p->>'request_id')::uuid; sid uuid=(p->>'session_id')::uuid; action text=p->>'action'; at_time timestamptz=(p->>'at')::timestamptz; result jsonb; target public.kpi_targets; assigned public.assignments; begin
 select * into who from public.profiles where id=private.me() for update;
 if who.id is null then raise exception 'Employee account is inactive or unauthorized' using errcode='42501';end if;
 if req is null or sid is null then raise exception 'Missing operation identifier';end if;
 select * into receipt from private.command_receipts where id=req;
 if receipt.id is not null then if receipt.employee_id<>who.id or receipt.payload<>p then raise exception 'Idempotency key reused with different input' using errcode='22023';end if;return receipt.result;end if;
 if at_time is null or at_time>clock_timestamp()+interval '60 seconds' then raise exception 'Device clock is ahead. Correct it before continuing.' using errcode='22023';end if;
 if action='start' then
  if not private.can('my_work.access') then raise exception 'My work access is required to start a session' using errcode='42501';end if;
  if (p->>'expected_revision')::int is distinct from 0 then raise exception 'Invalid initial revision';end if;
  if at_time<clock_timestamp()-interval '5 minutes' then raise exception 'Reconnect to start a new session';end if;
  if exists(select 1 from public.sessions where employee_id=who.id and status<>'completed') then raise exception 'You already have an active session. Refresh to recover it.' using errcode='40001';end if;
  if exists(select 1 from public.sessions where employee_id=who.id and ended_at>at_time) then raise exception 'New session overlaps earlier work. Check your device clock.' using errcode='22023';end if;
  aid=(p->>'activity_id')::uuid;pid=(p->>'product_id')::uuid;asid=nullif(p->>'assignment_id','')::uuid;
  if not exists(select 1 from public.activities a join public.activity_positions ap on ap.activity_id=a.id join public.positions pos on pos.id=ap.position_id where a.id=aid and a.active and pos.active and ap.position_id=who.position_id) then raise exception 'Activity is unavailable for your position' using errcode='42501';end if;
  if not exists(select 1 from public.products where id=pid and active) then raise exception 'Design is inactive';end if;
  if asid is not null then
   select * into assigned from public.assignments where id=asid for update;
   if assigned.id is null or assigned.employee_id<>who.id or assigned.product_id<>pid or assigned.status not in ('assigned','in_progress') then raise exception 'Assignment is unavailable' using errcode='42501';end if;
  end if;
  insert into public.sessions(id,employee_id,position_id,activity_id,product_id,assignment_id,employee_name,position_name,activity_name,product_name,sku,started_at)
   select sid,who.id,who.position_id,aid,pid,asid,who.name,coalesce(pos.name,''),a.name,pr.name,pr.sku,at_time from public.activities a,public.products pr left join public.positions pos on pos.id=who.position_id where a.id=aid and pr.id=pid;
  insert into public.segments(id,session_id,kind,started_at,ordinal) values(req,sid,'WORK',at_time,1);
  select * into target from public.kpi_targets where active and activity_id=aid and (product_id=pid or product_id is null) and effective_from<=at_time and (valid_until is null or valid_until>at_time) order by (product_id is not null) desc,effective_from desc,created_at desc limit 1;
  insert into private.session_targets(session_id,kpi_id,target_value) values(sid,target.id,target.target_value);
  if asid is not null then update public.assignments set status='in_progress' where id=asid;end if;
 else
  select * into s from public.sessions where id=sid and employee_id=who.id for update;
  if s.id is null then raise exception 'Session not found' using errcode='42501';end if;
  if (p->>'expected_revision')::int is distinct from s.revision then raise exception 'Another device changed this session. Review recovery before continuing.' using errcode='40001';end if;
  if action='complete' then
   if s.status<>'awaiting_quantity' then raise exception 'Finish the session before saving quantity';end if;
   if not coalesce((p->>'quantity')~'^\d+$',false) then raise exception 'Enter a whole quantity of zero or more';end if;
   update public.sessions set status='completed',quantity=(p->>'quantity')::int,revision=revision+1 where id=sid;
   if s.assignment_id is not null then
    select * into assigned from public.assignments where id=s.assignment_id for update;
    if assigned.status in ('assigned','in_progress') and (assigned.target_quantity is null or (select coalesce(sum(quantity),0) from public.sessions where assignment_id=assigned.id and status='completed')>=assigned.target_quantity) then
     update public.assignments set status='completed' where id=assigned.id;
    end if;
   end if;
  else
   if s.status<>'running' then raise exception 'Session is no longer running';end if;
   select * into seg from public.segments where session_id=sid and ended_at is null for update;
   if seg.id is null or at_time<seg.started_at then raise exception 'Device clock moved backwards. Reconnect before continuing.';end if;
   if action not in ('transition','finish') then raise exception 'Invalid action';end if;
   if action='transition' and (p->>'kind' is null or p->>'kind' not in ('WORK','WALKING','INTERRUPTION') or p->>'kind'=seg.kind) then raise exception 'Invalid timer state';end if;
   update public.segments set ended_at=at_time where id=seg.id;
   if action='transition' then insert into public.segments(id,session_id,kind,started_at,ordinal) values(req,sid,p->>'kind',at_time,s.revision+1);update public.sessions set revision=revision+1 where id=sid;
   else update public.sessions set status='awaiting_quantity',ended_at=at_time,revision=revision+1 where id=sid;end if;
  end if;
 end if;
 result=private.session_json(sid);
 insert into private.command_receipts(id,employee_id,payload,result) values(req,who.id,p,result);
 return result;
end $$;

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
  if p ? 'pin_expiration_enabled' and coalesce((p->>'pin_expiration_enabled')::boolean,false) is distinct from coalesce((select pin_expiration_enabled from public.profiles where id=rid),false)
   and not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) a where a->>'method'='password') then
   raise exception 'Sign in with your password to change PIN expiration' using errcode='42501';end if;
  insert into public.profiles(id,name,email,position_id,active,external_employee_id) values(rid,trim(p->>'name'),lower(trim(p->>'email')),nullif(p->>'position_id','')::uuid,coalesce((p->>'active')::boolean,true),nullif(p->>'external_employee_id','')) on conflict(id) do update set name=excluded.name,email=excluded.email,position_id=excluded.position_id,active=excluded.active,external_employee_id=excluded.external_employee_id;

  if p ? 'pin_expiration_enabled' then update public.profiles set pin_expiration_enabled=(p->>'pin_expiration_enabled')::boolean where id=rid;end if;
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
  if target.pin_expiration_enabled and exists(select 1 from private.login_pins where profile_id=target.id and updated_at+interval '90 days'<=now()) then return jsonb_build_object('error','pin_expired');end if;
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
   'pin_expires_at',(select case when target.pin_expiration_enabled then updated_at+interval '90 days' end from private.login_pins where profile_id=target.id),
   'pin_expired',target.pin_expiration_enabled and exists(select 1 from private.login_pins where profile_id=target.id and updated_at+interval '90 days'<=now()));end if;
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

-- Data access follows page access. Work catalogs remain available only as necessary lookups.
alter policy read_profiles on public.profiles using(id=(select private.me()) or (select private.can('employees.view')) or (select private.can('permissions.manage')));
alter policy read_positions on public.positions using(id=(select private.my_position()) or (select private.can('positions.view')) or (select private.can('employees.view')) or (select private.can('permissions.manage')) or (select private.can('analytics.view')) or (select private.can('activities.view')));
alter policy read_activities on public.activities using((select private.can('activities.view')) or (select private.can('analytics.view')) or (select private.can('kpis.view')) or ((select private.can('my_work.access')) and active and exists(select 1 from public.activity_positions ap where ap.activity_id=id and ap.position_id=(select private.my_position()))));
alter policy read_products on public.products using((select private.can('products.view')) or (select private.can('assignments.view')) or (select private.can('analytics.view')) or (select private.can('kpis.view')) or (active and (select private.can('my_work.access'))));
alter policy read_assignments on public.assignments using((employee_id=(select private.me()) and (select private.can('my_work.access'))) or (select private.can('assignments.view')) or (select private.can('analytics.view')));
alter policy read_kpis on public.kpi_targets using((select private.can('kpis.view')) or (select private.can('analytics.view')));
alter policy read_sessions on public.sessions using((employee_id=(select private.me()) and ((select private.can('my_work.access')) or status<>'completed')) or (select private.can('analytics.view')));
alter policy read_activity_positions on public.activity_positions using(position_id=(select private.my_position()) or (select private.can('activities.view')) or (select private.can('positions.view')) or (select private.can('analytics.view')) or (select private.can('kpis.view')));
alter policy read_settings on public.settings using((select private.can('settings.manage')));

-- Minimal lookup directory, not employee account details, for assignment/analytics/position screens.
create function private.employee_directory() returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if not (private.can('assignments.view') or private.can('analytics.view') or private.can('positions.view')) then return '[]';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'position_id',position_id,'active',active) order by name,id) from public.profiles),'[]');
end $$;
create function public.employee_directory() returns jsonb language sql security invoker set search_path='' as $$ select private.employee_directory() $$;
-- Dashboard exposes a bounded daily summary, not Analytics history or employee account details.
create function private.dashboard_summary(p_from timestamptz,p_to timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if not private.can('dashboard.view') then raise exception 'Permission denied' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '25 hours' then raise exception 'Choose one dashboard day';end if;
 return jsonb_build_object('completed',(select count(*) from public.session_metrics where started_at>=p_from and started_at<p_to),
 'quantity',(select coalesce(sum(quantity),0) from public.session_metrics where started_at>=p_from and started_at<p_to),
 'work_seconds',(select coalesce(sum(work_seconds),0) from public.session_metrics where started_at>=p_from and started_at<p_to),
 'walking_seconds',(select coalesce(sum(walking_seconds),0) from public.session_metrics where started_at>=p_from and started_at<p_to),
 'interruption_seconds',(select coalesce(sum(interruption_seconds),0) from public.session_metrics where started_at>=p_from and started_at<p_to),
 'active',coalesce((select jsonb_agg(jsonb_build_object('id',id,'employee_name',employee_name,'activity_name',activity_name,'product_name',product_name,'status',status,'started_at',started_at) order by started_at) from public.sessions where status<>'completed'),'[]'));
end $$;
create function public.dashboard_summary(p_from timestamptz,p_to timestamptz) returns jsonb language sql security invoker set search_path='' as $$ select private.dashboard_summary(p_from,p_to) $$;
revoke all on function private.employee_directory(),public.employee_directory(),private.dashboard_summary(timestamptz,timestamptz),public.dashboard_summary(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function private.employee_directory(),public.employee_directory(),private.dashboard_summary(timestamptz,timestamptz),public.dashboard_summary(timestamptz,timestamptz) to authenticated;

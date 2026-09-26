-- Preserve existing behavior and snapshot workflow rules for every session.
alter table public.activities add column requires_design boolean not null default true;
alter table public.activities add column requires_quantity boolean not null default true;
alter table public.sessions add column requires_design boolean not null default true;
alter table public.sessions add column requires_quantity boolean not null default true;
alter table public.sessions alter column product_id drop not null;
alter table public.sessions drop constraint sessions_check1;
alter table public.sessions add constraint sessions_workflow_state check(
 (status='running' and ended_at is null and quantity is null)
 or (status='awaiting_quantity' and ended_at is not null and quantity is null and requires_quantity)
 or (status='completed' and ended_at is not null and ((requires_quantity and quantity is not null) or (not requires_quantity and quantity is null)))
);
alter table public.sessions add constraint sessions_workflow_design check(
 (requires_design and product_id is not null)
 or (not requires_design and product_id is null and assignment_id is null)
);
comment on column public.sessions.requires_design is 'Activity setting snapshotted at start. Historical and already-running sessions retain their original workflow.';
comment on column public.sessions.requires_quantity is 'Activity setting snapshotted at start. False means quantity is not applicable, stored as NULL, never zero.';


create or replace function private.session_command(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare who public.profiles; s public.sessions; seg public.segments; receipt private.command_receipts; aid uuid; pid uuid; asid uuid; req uuid=(p->>'request_id')::uuid; sid uuid=(p->>'session_id')::uuid; action text=p->>'action'; at_time timestamptz=(p->>'at')::timestamptz; result jsonb; target public.kpi_targets; assigned public.assignments; activity public.activities; begin
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
  aid=(p->>'activity_id')::uuid;pid=nullif(p->>'product_id','')::uuid;asid=nullif(p->>'assignment_id','')::uuid;
  select a.* into activity from public.activities a where a.id=aid and a.active and exists(select 1 from public.activity_positions ap join public.positions pos on pos.id=ap.position_id where ap.activity_id=a.id and pos.active and ap.position_id=who.position_id) for share;
  if activity.id is null then raise exception 'Activity is unavailable for your position' using errcode='42501';end if;
  if activity.requires_design then
   if pid is null or not exists(select 1 from public.products where id=pid and active) then raise exception 'Choose an active design before starting';end if;
  elsif pid is not null or asid is not null then raise exception 'This activity does not use a design. Refresh and choose it again';end if;
  if asid is not null then
   select * into assigned from public.assignments where id=asid for update;
   if assigned.id is null or assigned.employee_id<>who.id or assigned.product_id<>pid or assigned.status not in ('assigned','in_progress') then raise exception 'Assignment is unavailable' using errcode='42501';end if;
  end if;
  insert into public.sessions(id,employee_id,position_id,activity_id,product_id,assignment_id,employee_name,position_name,activity_name,product_name,sku,started_at,requires_design,requires_quantity)
   values(sid,who.id,who.position_id,aid,pid,asid,who.name,coalesce((select name from public.positions where id=who.position_id),''),activity.name,coalesce((select name from public.products where id=pid),''),coalesce((select sku from public.products where id=pid),''),at_time,activity.requires_design,activity.requires_quantity);
  insert into public.segments(id,session_id,kind,started_at,ordinal) values(req,sid,'WORK',at_time,1);
  if activity.requires_quantity then select * into target from public.kpi_targets where active and activity_id=aid and (product_id=pid or product_id is null) and effective_from<=at_time and (valid_until is null or valid_until>at_time) order by (product_id is not null) desc,effective_from desc,created_at desc limit 1;end if;
  insert into private.session_targets(session_id,kpi_id,target_value) values(sid,target.id,target.target_value);
  if asid is not null then update public.assignments set status='in_progress' where id=asid;end if;
 else
  select * into s from public.sessions where id=sid and employee_id=who.id for update;
  if s.id is null then raise exception 'Session not found' using errcode='42501';end if;
  if (p->>'expected_revision')::int is distinct from s.revision then raise exception 'Another device changed this session. Review recovery before continuing.' using errcode='40001';end if;
  if action='complete' then
   if s.status<>'awaiting_quantity' or not s.requires_quantity then raise exception 'Finish the session before saving quantity';end if;
   if not coalesce((p->>'quantity')~'^\d+$',false) then raise exception 'Enter a whole quantity of zero or more';end if;
   if (p->>'quantity')::numeric>1000000000 then raise exception 'Quantity must be 1,000,000,000 or less';end if;
   update public.sessions set status='completed',quantity=(p->>'quantity')::int,revision=revision+1 where id=sid;

  else
   if s.status<>'running' then raise exception 'Session is no longer running';end if;
   select * into seg from public.segments where session_id=sid and ended_at is null for update;
   if seg.id is null or at_time<seg.started_at then raise exception 'Device clock moved backwards. Reconnect before continuing.';end if;
   if action not in ('transition','finish') then raise exception 'Invalid action';end if;
   if action='transition' and (p->>'kind' is null or p->>'kind' not in ('WORK','WALKING','INTERRUPTION') or p->>'kind'=seg.kind) then raise exception 'Invalid timer state';end if;
   update public.segments set ended_at=at_time where id=seg.id;
   if action='transition' then insert into public.segments(id,session_id,kind,started_at,ordinal) values(req,sid,p->>'kind',at_time,s.revision+1);update public.sessions set revision=revision+1 where id=sid;
   else update public.sessions set status=case when requires_quantity then 'awaiting_quantity' else 'completed' end,ended_at=at_time,revision=revision+1 where id=sid;end if;
  end if;
   if s.assignment_id is not null and exists(select 1 from public.sessions where id=sid and status='completed') then
    select * into assigned from public.assignments where id=s.assignment_id for update;
    if assigned.status in ('assigned','in_progress') and (assigned.target_quantity is null or (s.requires_quantity and (select coalesce(sum(quantity),0) from public.sessions where assignment_id=assigned.id and status='completed' and quantity is not null)>=assigned.target_quantity)) then
     update public.assignments set status='completed' where id=assigned.id;
    end if;
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
   if p ? 'requires_design' then update public.activities set requires_design=(p->>'requires_design')::boolean where id=rid;end if;
   if p ? 'requires_quantity' then update public.activities set requires_quantity=(p->>'requires_quantity')::boolean where id=rid;end if;
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

create or replace function private.employee_kpi(p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare v text; val numeric; begin
 if not exists(select 1 from public.sessions where id=p_session and employee_id=private.me()) then raise exception 'Unauthorized' using errcode='42501';end if;
 if not (select requires_quantity from public.sessions where id=p_session) then return jsonb_build_object('visibility','OFF');end if;
 select employee_kpi_visibility into v from public.settings where id='main';if v='OFF' then return jsonb_build_object('visibility',v);end if;
 select target_value into val from private.session_targets where session_id=p_session;return jsonb_build_object('visibility',v,'target',val);
end $$;

create or replace function private.analytics_baselines(p_before timestamptz,p_pairs jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if not private.can('analytics.view') then raise exception 'Permission denied' using errcode='42501';end if;
 if jsonb_array_length(p_pairs)>500 then raise exception 'Too many comparison pairs';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
  select m.activity_id,m.product_id,count(*)::int samples,
   (sum(m.quantity)*3600.0/nullif(sum(m.work_seconds),0))::float8 rate
  from public.session_metrics m
  where m.quantity is not null and m.started_at<p_before and exists(select 1 from jsonb_to_recordset(p_pairs) as p(activity_id uuid,product_id uuid) where p.activity_id=m.activity_id and p.product_id is not distinct from m.product_id)
  group by m.activity_id,m.product_id
 ) x),'[]');
end $$;

-- A bounded, read-only convenience endpoint. RLS and explicit ownership both apply.
create function public.assignment_progress(p_ids uuid[]) returns table(id uuid,completed_quantity bigint)
language sql stable security invoker set search_path='' as $$
 select a.id,coalesce(sum(s.quantity),0)::bigint from public.assignments a
 left join public.sessions s on s.assignment_id=a.id and s.status='completed' and s.quantity is not null
 where a.id=any(p_ids[1:500]) and a.employee_id=(select private.me())
 group by a.id
$$;
revoke all on function public.assignment_progress(uuid[]) from public,anon,authenticated;
grant execute on function public.assignment_progress(uuid[]) to authenticated;


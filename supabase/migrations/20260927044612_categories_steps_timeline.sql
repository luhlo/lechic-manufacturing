-- One hierarchy; existing sessions remain historical facts, never inferred categories.
create table public.activity_categories(
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 100),
 active boolean not null default true, sort_order integer not null default 0 check(sort_order between 0 and 1000000),
 requires_design_default boolean not null default true, requires_quantity_default boolean not null default true,
 is_fallback boolean not null default false, created_by uuid references public.profiles,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index category_name on public.activity_categories(lower(btrim(name)));
create unique index category_fallback on public.activity_categories(is_fallback) where is_fallback;
create index category_creator on public.activity_categories(created_by);
insert into public.activity_categories(name,is_fallback) values('Uncategorized activities',true);
create function private.fallback_category() returns uuid language sql stable security definer set search_path='' as $$
 select id from public.activity_categories where is_fallback
$$;
revoke all on function private.fallback_category() from public,anon,authenticated;
create table public.category_positions(category_id uuid not null references public.activity_categories,position_id uuid not null references public.positions,primary key(category_id,position_id));
create index category_positions_position on public.category_positions(position_id);
alter table public.activities add column category_id uuid not null default private.fallback_category() references public.activity_categories;
alter table public.activities add column use_steps boolean not null default false;
alter table public.activities add column created_by uuid references public.profiles;
create index activities_category on public.activities(category_id);
create index activities_creator on public.activities(created_by);
-- Duplicate scope is now category + intersecting position grants, enforced in the serialized write RPCs.
drop index public.activities_name;
create function private.activity_name_key(value text) returns text language sql immutable set search_path='' as $$ select lower(regexp_replace(btrim(value),'\s+',' ','g')) $$;
revoke all on function private.activity_name_key(text) from public,anon,authenticated;
create index activities_scoped_name on public.activities(category_id,private.activity_name_key(name));
create table public.activity_steps(
 id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.activities,
 name text not null check(length(btrim(name)) between 1 and 100), active boolean not null default true,
 sort_order integer not null default 0 check(sort_order between 0 and 1000000), created_by uuid references public.profiles,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index activity_step_name on public.activity_steps(activity_id,lower(btrim(name)));
create index activity_steps_creator on public.activity_steps(created_by);
alter table public.settings add column employee_activity_creation boolean not null default false;
alter table public.settings add column activity_steps_enabled boolean not null default false;
alter table public.sessions add column category_id uuid references public.activity_categories;
alter table public.sessions add column category_name text;
alter table public.sessions add column step_id uuid references public.activity_steps;
alter table public.sessions add column step_name text;
alter table public.sessions add column steps_enabled boolean not null default false;
alter table public.sessions add constraint session_recorded_context check(
 (category_id is null)=(category_name is null) and (step_id is null)=(step_name is null) and (step_id is null or steps_enabled)
);
create index sessions_category on public.sessions(category_id);
create index sessions_step on public.sessions(step_id);
comment on column public.sessions.category_name is 'Recorded at start; NULL on legacy sessions. Never infer a historical category from current configuration.';
comment on column public.sessions.step_name is 'Optional recorded step, not a checklist. Snapshot preserved through renames and feature switches.';
alter table public.activity_categories enable row level security;
alter table public.category_positions enable row level security;
alter table public.activity_steps enable row level security;
revoke all on public.activity_categories,public.category_positions,public.activity_steps from public,anon,authenticated;
grant select on public.activity_categories,public.category_positions,public.activity_steps to authenticated;
-- Private helper avoids policy recursion and never grants activity access via a category.
create function private.category_available(category uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.activity_categories c join public.profiles p on p.id=private.me()
 join public.positions pos on pos.id=p.position_id and pos.active
 where c.id=category and c.active and (exists(select 1 from public.category_positions cp where cp.category_id=c.id and cp.position_id=pos.id)
 or exists(select 1 from public.activities a join public.activity_positions ap on ap.activity_id=a.id where a.category_id=c.id and a.active and ap.position_id=pos.id)))
$$;
revoke all on function private.category_available(uuid) from public,anon,authenticated;
grant execute on function private.category_available(uuid) to authenticated;
create policy read_categories on public.activity_categories for select to authenticated using(
 (select private.can('activities.view')) or (select private.can('analytics.view')) or (select private.can('kpis.view'))
 or ((select private.can('my_work.access')) and private.category_available(id))
);
create policy read_category_positions on public.category_positions for select to authenticated using(
 position_id=(select private.my_position()) or (select private.can('activities.view')) or (select private.can('analytics.view'))
);
create policy read_activity_steps on public.activity_steps for select to authenticated using(
 (select private.can('activities.view')) or (select private.can('analytics.view'))
 or ((select private.can('my_work.access')) and active and exists(select 1 from public.activities a join public.activity_positions ap on ap.activity_id=a.id where a.id=activity_steps.activity_id and a.active and ap.position_id=(select private.my_position()) and private.category_available(a.category_id)))
);
alter policy read_activities on public.activities using((select private.can('activities.view')) or (select private.can('analytics.view')) or (select private.can('kpis.view')) or ((select private.can('my_work.access')) and active and private.category_available(category_id) and exists(select 1 from public.activity_positions ap where ap.activity_id=id and ap.position_id=(select private.my_position()))));

create or replace function private.app_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare p public.profiles; perms jsonb; config public.settings; begin
 select * into p from public.profiles where id=private.me();if p.id is null then raise exception 'Your employee account is not active. Contact your manager.' using errcode='42501';end if;
 select coalesce(jsonb_agg(id),'[]') into perms from public.permissions where private.can(id);
 select * into config from public.settings where id='main';
 return jsonb_build_object('profile',to_jsonb(p),'permissions',perms,'visibility',config.employee_kpi_visibility,
 'workflow',jsonb_build_object('employee_activity_creation',config.employee_activity_creation,'activity_steps_enabled',config.activity_steps_enabled));
end $$;


create or replace function private.manage(p_entity text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare who uuid=private.me(); rid uuid=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); permission text; existing uuid; result jsonb; old public.kpi_targets; item jsonb; access_role uuid; is_new boolean; cat uuid; normalized_name text; begin
 permission=case p_entity when 'profiles' then 'employees.manage' when 'positions' then 'positions.manage' when 'activities' then 'activities.manage' when 'activity_categories' then 'activities.manage' when 'activity_steps' then 'activities.manage' when 'workflow_settings' then 'settings.manage' when 'products' then 'products.manage' when 'assignments' then 'assignments.manage' when 'kpi_targets' then 'kpis.manage' when 'settings' then 'settings.manage' when 'roles' then 'permissions.manage' when 'profile_roles' then 'permissions.manage' when 'position_roles' then 'permissions.manage' when 'position_access' then 'permissions.manage' end;
 perform pg_advisory_xact_lock(8417201);
 if who is null or permission is null or not private.can(permission) then raise exception 'Permission denied' using errcode='42501';end if;
 -- Serialize administration to protect the last administrator and avoid lost role updates.
 perform pg_advisory_xact_lock(8417201);
 if p_entity='positions' then is_new=not exists(select 1 from public.positions where id=rid);end if;
 if p_entity='workflow_settings' then
  if p ? 'employee_activity_creation' then update public.settings set employee_activity_creation=(p->>'employee_activity_creation')::boolean,updated_by=who,updated_at=now() where id='main';end if;
  if p ? 'activity_steps_enabled' then update public.settings set activity_steps_enabled=(p->>'activity_steps_enabled')::boolean,updated_by=who,updated_at=now() where id='main';end if;
 elsif p_entity='activity_categories' then
  insert into public.activity_categories(id,name,active,sort_order,requires_design_default,requires_quantity_default,created_by)
   values(rid,btrim(p->>'name'),coalesce((p->>'active')::boolean,true),coalesce((p->>'sort_order')::int,0),coalesce((p->>'requires_design_default')::boolean,true),coalesce((p->>'requires_quantity_default')::boolean,true),who)
   on conflict(id) do update set name=excluded.name,active=excluded.active,sort_order=excluded.sort_order,requires_design_default=excluded.requires_design_default,requires_quantity_default=excluded.requires_quantity_default,updated_at=now();
  delete from public.category_positions where category_id=rid;
  insert into public.category_positions select rid,value::uuid from jsonb_array_elements_text(coalesce(p->'position_ids','[]'));
 elsif p_entity='activity_steps' then
  if exists(select 1 from public.activity_steps where id=rid and activity_id is distinct from (p->>'activity_id')::uuid) then raise exception 'A step cannot be moved to another activity. Add a new step instead.';end if;
  insert into public.activity_steps(id,activity_id,name,active,sort_order,created_by) values(rid,(p->>'activity_id')::uuid,btrim(p->>'name'),coalesce((p->>'active')::boolean,true),coalesce((p->>'sort_order')::int,0),who)
   on conflict(id) do update set name=excluded.name,active=excluded.active,sort_order=excluded.sort_order,updated_at=now();
 elsif p_entity in ('positions','activities') then
  if p_entity='positions' then
   if not private.can('permissions.manage') and private.privileged_position(rid) then raise exception 'Permission management is required to change a privileged position' using errcode='42501';end if;
   insert into public.positions(id,name,active) values(rid,trim(p->>'name'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,active=excluded.active;
   if is_new then insert into public.position_roles select rid,id from public.roles where name='Employee';end if;
  else
   cat=coalesce(nullif(p->>'category_id','')::uuid,(select category_id from public.activities where id=rid),private.fallback_category());
   if not exists(select 1 from public.activity_categories where id=cat) then raise exception 'Choose an existing category';end if;
   normalized_name=private.activity_name_key(p->>'name');
   if exists(select 1 from public.activities a where a.id<>rid and a.category_id=cat and private.activity_name_key(a.name)=normalized_name
    and (exists(select 1 from public.activity_positions ap where ap.activity_id=a.id and ap.position_id in(select value::uuid from jsonb_array_elements_text(coalesce(p->'position_ids','[]'))))
    or (not exists(select 1 from public.activity_positions ap where ap.activity_id=a.id) and jsonb_array_length(coalesce(p->'position_ids','[]'))=0))) then raise exception 'An activity with this name already exists in this category for the selected positions';end if;
   insert into public.activities(id,name,active,category_id,created_by) values(rid,btrim(p->>'name'),coalesce((p->>'active')::boolean,true),cat,who)
    on conflict(id) do update set name=excluded.name,active=excluded.active,category_id=excluded.category_id;
   if p ? 'use_steps' then update public.activities set use_steps=(p->>'use_steps')::boolean where id=rid;end if;
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

create or replace function private.session_command(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare who public.profiles; s public.sessions; seg public.segments; receipt private.command_receipts; aid uuid; pid uuid; asid uuid; req uuid=(p->>'request_id')::uuid; sid uuid=(p->>'session_id')::uuid; action text=p->>'action'; at_time timestamptz=(p->>'at')::timestamptz; result jsonb; target public.kpi_targets; assigned public.assignments; activity public.activities; category public.activity_categories; step public.activity_steps; use_steps boolean; requested_step uuid; begin
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
  select * into category from public.activity_categories where id=activity.category_id and active for share;
  if category.id is null then raise exception 'This category is unavailable. Choose another category.' using errcode='42501';end if;
  select activity_steps_enabled and activity.use_steps into use_steps from public.settings where id='main' for share;
  requested_step=nullif(p->>'step_id','')::uuid;
  if requested_step is not null then
   if not use_steps then raise exception 'Steps are no longer enabled. Refresh before starting.';end if;
   select * into step from public.activity_steps where id=requested_step and activity_id=activity.id and active for share;
   if step.id is null then raise exception 'This step is unavailable. Choose another step.';end if;
  end if;
  if activity.requires_design then
   if pid is null or not exists(select 1 from public.products where id=pid and active) then raise exception 'Choose an active design before starting';end if;
  elsif pid is not null or asid is not null then raise exception 'This activity does not use a design. Refresh and choose it again';end if;
  if asid is not null then
   select * into assigned from public.assignments where id=asid for update;
   if assigned.id is null or assigned.employee_id<>who.id or assigned.product_id<>pid or assigned.status not in ('assigned','in_progress') then raise exception 'Assignment is unavailable' using errcode='42501';end if;
  end if;
  insert into public.sessions(id,employee_id,position_id,activity_id,product_id,assignment_id,employee_name,position_name,activity_name,product_name,sku,started_at,requires_design,requires_quantity,category_id,category_name,step_id,step_name,steps_enabled)
   values(sid,who.id,who.position_id,aid,pid,asid,who.name,coalesce((select name from public.positions where id=who.position_id),''),activity.name,coalesce((select name from public.products where id=pid),''),coalesce((select sku from public.products where id=pid),''),at_time,activity.requires_design,activity.requires_quantity,category.id,category.name,step.id,step.name,use_steps);
  insert into public.segments(id,session_id,kind,started_at,ordinal) values(req,sid,'WORK',at_time,1);
  if activity.requires_quantity and step.id is null then select * into target from public.kpi_targets where active and activity_id=aid and (product_id=pid or product_id is null) and effective_from<=at_time and (valid_until is null or valid_until>at_time) order by (product_id is not null) desc,effective_from desc,created_at desc limit 1;end if;
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
   if s.assignment_id is not null and s.step_id is null and exists(select 1 from public.sessions where id=sid and status='completed') then
    select * into assigned from public.assignments where id=s.assignment_id for update;
    if assigned.status in ('assigned','in_progress') and (assigned.target_quantity is null or (s.requires_quantity and (select coalesce(sum(quantity),0) from public.sessions where assignment_id=assigned.id and status='completed' and quantity is not null and step_id is null)>=assigned.target_quantity)) then
     update public.assignments set status='completed' where id=assigned.id;
    end if;
   end if;
 end if;
 result=private.session_json(sid);
 insert into private.command_receipts(id,employee_id,payload,result) values(req,who.id,p,result);
 return result;
end $$;

create or replace function private.employee_kpi(p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare v text; val numeric; begin
 if not exists(select 1 from public.sessions where id=p_session and employee_id=private.me()) then raise exception 'Unauthorized' using errcode='42501';end if;
 if not (select requires_quantity and step_id is null from public.sessions where id=p_session) then return jsonb_build_object('visibility','OFF');end if;
 select employee_kpi_visibility into v from public.settings where id='main';if v='OFF' then return jsonb_build_object('visibility',v);end if;
 select target_value into val from private.session_targets where session_id=p_session;return jsonb_build_object('visibility',v,'target',val);
end $$;

create or replace function private.analytics_baselines(p_before timestamptz,p_pairs jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if not private.can('analytics.view') then raise exception 'Permission denied' using errcode='42501';end if;
 if jsonb_array_length(p_pairs)>500 then raise exception 'Too many comparison pairs';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
  select m.activity_id,m.product_id,s.step_id,count(*)::int samples,
   (sum(m.quantity)*3600.0/nullif(sum(m.work_seconds),0))::float8 rate
  from public.session_metrics m join public.sessions s on s.id=m.id
  where m.quantity is not null and m.started_at<p_before and exists(select 1 from jsonb_to_recordset(p_pairs) as p(activity_id uuid,product_id uuid,step_id uuid) where p.activity_id=m.activity_id and p.product_id is not distinct from m.product_id and p.step_id is not distinct from s.step_id)
  group by m.activity_id,m.product_id,s.step_id
 ) x),'[]');
end $$;


create function private.employee_create_activity(p_category uuid,p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
 declare who public.profiles; category public.activity_categories; existing public.activities; new_id uuid; begin
 -- Shares management's lock so toggles, names and position grants are checked atomically.
 perform pg_advisory_xact_lock(8417201);
 select * into who from public.profiles where id=private.me();
 if who.id is null or not private.can('my_work.access') or not exists(select 1 from public.positions where id=who.position_id and active) then raise exception 'My Work access and an active position are required.' using errcode='42501';end if;
 if not (select employee_activity_creation from public.settings where id='main') then raise exception 'Employee activity creation is currently off. Choose an existing activity.' using errcode='42501';end if;
 if not private.category_available(p_category) then raise exception 'This category is unavailable for your position.' using errcode='42501';end if;
 if p_name is null or length(btrim(p_name)) not between 1 and 100 then raise exception 'Enter an activity name between 1 and 100 characters.';end if;
 select * into category from public.activity_categories where id=p_category and active;
 select a.* into existing from public.activities a join public.activity_positions ap on ap.activity_id=a.id
 where a.category_id=p_category and ap.position_id=who.position_id and private.activity_name_key(a.name)=private.activity_name_key(p_name) order by a.active desc,a.created_at,a.id limit 1;
 if existing.id is not null then
  if not existing.active then raise exception 'This activity name is unavailable in this category. Ask a manager.';end if;
  return jsonb_build_object('id',existing.id,'existing',true);
 end if;
 insert into public.activities(name,category_id,requires_design,requires_quantity,created_by)
 values(btrim(p_name),p_category,category.requires_design_default,category.requires_quantity_default,who.id) returning id into new_id;
 insert into public.activity_positions values(new_id,who.position_id);
 insert into private.audit_log(actor_id,entity,record_id,details) values(who.id,'employee_activity',new_id::text,jsonb_build_object('category_id',p_category,'position_id',who.position_id,'name',btrim(p_name)));
 return jsonb_build_object('id',new_id,'existing',false);
end $$;
create function public.employee_create_activity(p_category uuid,p_name text) returns jsonb language sql security invoker set search_path='' as $$ select private.employee_create_activity(p_category,p_name) $$;

-- Full employee chronology: no category/activity/design/step filters can manufacture gaps.
create function private.work_timeline(p_employee uuid,p_day date) returns jsonb language plpgsql security definer set search_path='' as $$
 declare day_start timestamptz; day_end timestamptz; as_of timestamptz=clock_timestamp(); records jsonb; count_records int; begin
 if not private.can('analytics.view') then raise exception 'Analytics access is required to view work timelines.' using errcode='42501';end if;
 if p_employee is null or p_day is null or not isfinite(p_day) or not exists(select 1 from public.profiles where id=p_employee) then raise exception 'Choose an employee and a valid reporting date.';end if;
 day_start=p_day::timestamp at time zone 'America/Chicago';day_end=(p_day+1)::timestamp at time zone 'America/Chicago';
 select count(*) into count_records from public.sessions where employee_id=p_employee and started_at<day_end and (ended_at is null or ended_at>day_start or started_at>=day_start);
 if count_records>2000 then raise exception 'This day has too many records to load completely. Contact your administrator; no partial timeline is shown.';end if;
 select coalesce(jsonb_agg(private.session_json(id) order by started_at,id),'[]') into records from public.sessions where employee_id=p_employee and started_at<day_end and (ended_at is null or ended_at>day_start or started_at>=day_start);
 return jsonb_build_object('employee_id',p_employee,'day',p_day,'timezone','America/Chicago','day_start',day_start,'day_end',day_end,'as_of',as_of,'sessions',records);
end $$;
create function public.work_timeline(p_employee uuid,p_day date) returns jsonb language sql security invoker set search_path='' as $$ select private.work_timeline(p_employee,p_day) $$;
revoke all on function private.employee_create_activity(uuid,text),public.employee_create_activity(uuid,text),private.work_timeline(uuid,date),public.work_timeline(uuid,date) from public,anon,authenticated;
grant execute on function private.employee_create_activity(uuid,text),public.employee_create_activity(uuid,text),private.work_timeline(uuid,date),public.work_timeline(uuid,date) to authenticated;

-- A partial step does not satisfy the whole-design assignment target. Historical
-- general-session behavior is unchanged; step units stay available in reporting.
create or replace function public.assignment_progress(p_ids uuid[]) returns table(id uuid,completed_quantity bigint)
language sql stable security invoker set search_path='' as $$
 select a.id,coalesce(sum(s.quantity),0)::bigint from public.assignments a
 left join public.sessions s on s.assignment_id=a.id and s.status='completed' and s.quantity is not null and s.step_id is null
 where a.id=any(p_ids[1:500]) and a.employee_id=(select private.me())
 group by a.id
$$;

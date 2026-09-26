-- QA stabilization: durable command ordering, assignment lifecycle and privilege boundaries.
alter table public.segments add column ordinal integer;
with ordered as (select id,row_number() over(partition by session_id order by started_at,created_at,id) n from public.segments)
update public.segments g set ordinal=o.n from ordered o where o.id=g.id;
alter table public.segments alter column ordinal set not null;
alter table public.segments add constraint segment_order_positive check(ordinal>0);
create unique index segment_order on public.segments(session_id,ordinal);
alter table public.kpi_targets add constraint kpi_valid_range check(valid_until is null or valid_until>=effective_from);
create unique index kpi_one_successor on public.kpi_targets(supersedes_id) where supersedes_id is not null;
create index assignments_current on public.assignments(employee_id,work_date) where status in ('assigned','in_progress');
create index session_targets_kpi on private.session_targets(kpi_id);
create index settings_updated_by on public.settings(updated_by);
create index audit_actor on private.audit_log(actor_id);

create or replace function private.session_json(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(s)||jsonb_build_object('segments',coalesce((select jsonb_agg(to_jsonb(g) order by g.ordinal) from public.segments g where g.session_id=s.id),'[]')) from public.sessions s where s.id=p_id and (s.employee_id=private.me() or private.can('analytics.view')) $$;
create or replace function private.session_command(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare who public.profiles; s public.sessions; seg public.segments; receipt private.command_receipts; aid uuid; pid uuid; asid uuid; req uuid=(p->>'request_id')::uuid; sid uuid=(p->>'session_id')::uuid; action text=p->>'action'; at_time timestamptz=(p->>'at')::timestamptz; result jsonb; target public.kpi_targets; assigned public.assignments; begin
 select * into who from public.profiles where id=private.me() for update;
 if who.id is null then raise exception 'Employee account is inactive or unauthorized' using errcode='42501';end if;
 if req is null or sid is null then raise exception 'Missing operation identifier';end if;
 select * into receipt from private.command_receipts where id=req;
 if receipt.id is not null then if receipt.employee_id<>who.id or receipt.payload<>p then raise exception 'Idempotency key reused with different input' using errcode='22023';end if;return receipt.result;end if;
 if at_time is null or at_time>clock_timestamp()+interval '60 seconds' then raise exception 'Device clock is ahead. Correct it before continuing.' using errcode='22023';end if;
 if action='start' then
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
declare who uuid=private.me(); rid uuid=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); permission text; existing uuid; result jsonb; old public.kpi_targets; item jsonb; begin
 permission=case p_entity when 'profiles' then 'employees.manage' when 'positions' then 'positions.manage' when 'activities' then 'activities.manage' when 'products' then 'products.manage' when 'assignments' then 'assignments.manage' when 'kpi_targets' then 'kpis.manage' when 'settings' then 'settings.manage' when 'roles' then 'permissions.manage' when 'profile_roles' then 'permissions.manage' when 'position_roles' then 'permissions.manage' end;
 perform pg_advisory_xact_lock(8417201);
 if who is null or permission is null or not private.can(permission) then raise exception 'Permission denied' using errcode='42501';end if;
 -- Serialize administration to protect the last administrator and avoid lost role updates.
 perform pg_advisory_xact_lock(8417201);
 if p_entity in ('positions','activities') then
  if p_entity='positions' then
   if not private.can('permissions.manage') and exists(select 1 from public.position_roles where position_id=rid) then raise exception 'Permission management is required to change a privileged position' using errcode='42501';end if;
   insert into public.positions(id,name,active) values(rid,trim(p->>'name'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,active=excluded.active;
  else insert into public.activities(id,name,active) values(rid,trim(p->>'name'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,active=excluded.active;
   delete from public.activity_positions where activity_id=rid;insert into public.activity_positions select rid,value::uuid from jsonb_array_elements_text(coalesce(p->'position_ids','[]'));
  end if;
 elsif p_entity='products' then insert into public.products(id,name,sku,active) values(rid,trim(p->>'name'),trim(p->>'sku'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,sku=excluded.sku,active=excluded.active;
 elsif p_entity='profiles' then
  if trim(p->>'email')!~'^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email';end if;
  if exists(select 1 from public.profiles where id=rid and auth_user_id is not null and lower(email)<>lower(trim(p->>'email'))) then raise exception 'Linked sign-in email cannot be changed here';end if;
  if not private.can('permissions.manage') and (exists(select 1 from public.profile_roles pr join public.role_permissions rp on rp.role_id=pr.role_id where pr.profile_id=rid and rp.permission_id is not null) or exists(select 1 from public.position_roles where position_id=nullif(p->>'position_id','')::uuid) or exists(select 1 from public.profiles pr join public.position_roles r on r.position_id=pr.position_id where pr.id=rid)) then raise exception 'Permission management is required to change a privileged employee or position' using errcode='42501';end if;
  insert into public.profiles(id,name,email,position_id,active,external_employee_id) values(rid,trim(p->>'name'),lower(trim(p->>'email')),nullif(p->>'position_id','')::uuid,coalesce((p->>'active')::boolean,true),nullif(p->>'external_employee_id','')) on conflict(id) do update set name=excluded.name,email=excluded.email,position_id=excluded.position_id,active=excluded.active,external_employee_id=excluded.external_employee_id;
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
  insert into public.roles(id,name,active) values(rid,trim(p->>'name'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,active=excluded.active;
  delete from public.role_permissions where role_id=rid;insert into public.role_permissions select rid,value from jsonb_array_elements_text(coalesce(p->'permission_ids','[]'));
 elsif p_entity='profile_roles' then
  delete from public.profile_roles where profile_id=rid;insert into public.profile_roles select rid,value::uuid from jsonb_array_elements_text(coalesce(p->'role_ids','[]'));
 elsif p_entity='position_roles' then
  delete from public.position_roles where position_id=rid;insert into public.position_roles select rid,value::uuid from jsonb_array_elements_text(coalesce(p->'role_ids','[]'));
 end if;
 if not exists(select 1 from public.profiles pr join public.profile_roles x on x.profile_id=pr.id join public.roles r on r.id=x.role_id join public.role_permissions rp on rp.role_id=r.id where pr.active and r.active and rp.permission_id='*') then raise exception 'Keep at least one active employee with the Administrator role';end if;
 insert into private.audit_log(actor_id,entity,record_id,details) values(who,p_entity,rid::text,p);
 return jsonb_build_object('id',rid);
end $$;

-- Deferred validation checks the final atomic result, allowing close/open within one command.
create function private.check_session_integrity() returns trigger language plpgsql security definer set search_path='' as $$
declare sid uuid; s public.sessions; g public.segments; previous_end timestamptz; n integer=0; open_count integer=0; begin
 if tg_table_name='sessions' then sid=coalesce(new.id,old.id);else sid=coalesce(new.session_id,old.session_id);end if;
 select * into s from public.sessions where id=sid;
 if s.id is null then return null;end if;
 previous_end=s.started_at;
 for g in select * from public.segments where session_id=sid order by ordinal loop
  n=n+1;
  if g.ordinal<>n or g.started_at is distinct from previous_end then raise exception 'Session segments must be contiguous and ordered' using errcode='23514';end if;
  previous_end=g.ended_at;
  if g.ended_at is null then open_count=open_count+1;end if;
 end loop;
 if n=0 or (s.status='running' and (open_count<>1 or previous_end is not null)) or (s.status<>'running' and (open_count<>0 or previous_end is distinct from s.ended_at)) then raise exception 'Session state and segment boundaries disagree' using errcode='23514';end if;
 return null;
end $$;
create constraint trigger valid_session after insert or update on public.sessions deferrable initially deferred for each row execute function private.check_session_integrity();
create constraint trigger valid_segments after insert or update or delete on public.segments deferrable initially deferred for each row execute function private.check_session_integrity();
revoke all on function private.check_session_integrity() from public,anon,authenticated;

-- Historical baseline is aggregated in PostgreSQL; phones never download prior history.
create function private.analytics_baselines(p_before timestamptz,p_pairs jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if not private.can('analytics.view') then raise exception 'Permission denied' using errcode='42501';end if;
 if jsonb_array_length(p_pairs)>500 then raise exception 'Too many comparison pairs';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
  select m.activity_id,m.product_id,count(*)::int samples,
   (sum(m.quantity)*3600.0/nullif(sum(m.work_seconds),0))::float8 rate
  from public.session_metrics m
  where m.started_at<p_before and exists(select 1 from jsonb_to_recordset(p_pairs) as p(activity_id uuid,product_id uuid) where p.activity_id=m.activity_id and p.product_id=m.product_id)
  group by m.activity_id,m.product_id
 ) x),'[]');
end $$;
create function public.analytics_baselines(p_before timestamptz,p_pairs jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.analytics_baselines(p_before,p_pairs) $$;
revoke all on function private.analytics_baselines(timestamptz,jsonb),public.analytics_baselines(timestamptz,jsonb) from public,anon,authenticated;
grant execute on function private.analytics_baselines(timestamptz,jsonb),public.analytics_baselines(timestamptz,jsonb) to authenticated;
alter table public.sessions add column sku_search text generated always as (lower(regexp_replace(sku,'[^[:alnum:]]','','g'))) stored;

-- Cache statement-constant authorization checks once per query.
alter policy read_profiles on public.profiles to authenticated using(id=(select private.me()) or (select private.can('employees.manage')) or (select private.can('assignments.manage')) or (select private.can('analytics.view')) or (select private.can('permissions.manage')));
alter policy read_positions on public.positions to authenticated using((select private.me()) is not null);
alter policy read_permissions on public.permissions to authenticated using((select private.can('permissions.manage')));
alter policy read_roles on public.roles to authenticated using((select private.can('permissions.manage')));
alter policy read_role_permissions on public.role_permissions to authenticated using((select private.can('permissions.manage')));
alter policy read_profile_roles on public.profile_roles to authenticated using((select private.can('permissions.manage')));
alter policy read_position_roles on public.position_roles to authenticated using((select private.can('permissions.manage')));
alter policy read_activities on public.activities to authenticated using((select private.can('activities.manage')) or (select private.can('analytics.view')) or (select private.can('kpis.manage')) or (active and exists(select 1 from public.activity_positions ap where ap.activity_id=id and ap.position_id=(select private.my_position()))));
alter policy read_activity_positions on public.activity_positions to authenticated using((select private.me()) is not null);
alter policy read_products on public.products to authenticated using((select private.me()) is not null and (active or (select private.can('products.manage')) or (select private.can('analytics.view')) or (select private.can('assignments.manage')) or (select private.can('kpis.manage'))));
alter policy read_assignments on public.assignments to authenticated using(employee_id=(select private.me()) or (select private.can('assignments.manage')) or (select private.can('analytics.view')));
alter policy read_settings on public.settings to authenticated using((select private.me()) is not null);
alter policy read_kpis on public.kpi_targets to authenticated using((select private.can('kpis.manage')) or (select private.can('analytics.view')));
alter policy read_sessions on public.sessions to authenticated using(employee_id=(select private.me()) or (select private.can('analytics.view')));
alter policy read_segments on public.segments to authenticated using(exists(select 1 from public.sessions s where s.id=session_id));

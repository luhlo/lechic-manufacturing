-- Rank only limits assignment management. It never grants a capability or changes read RLS.
-- Existing positions are deliberately unconfigured; existing records/grants are untouched.
alter table public.positions add column assignment_level integer check (assignment_level > 0);
comment on column public.positions.assignment_level is 'Nullable positive hierarchy level: assignments.manage plus sender >= recipient; effective full administrators bypass rank.';

-- One rule for selector and mutation. NULL recipient checks sender setup only.
-- Internal-only: actor identity and both levels always come from current database records.
create function private.assignment_scope_error(recipient uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare actor uuid=private.me(); sender_level integer; recipient_level integer; begin
 if actor is null or not exists(select 1 from public.profiles p join auth.users u on u.id=p.auth_user_id
  where p.id=actor and coalesce(u.banned_until,'-infinity')<=now() and u.email_confirmed_at is not null) then
  return 'An active verified employee account is required to manage assignments.';
 end if;
 if not private.can('assignments.manage') then return 'Assignment management permission is required.';end if;
 if not private.can('*') then
  select pos.assignment_level into sender_level from public.profiles p join public.positions pos on pos.id=p.position_id and pos.active where p.id=actor;
  if sender_level is null then return 'Ask your Operations Manager to configure the assignment hierarchy level on your active position before assigning work.';end if;
 end if;
 if recipient is null then return null;end if;
 if not exists(select 1 from public.profiles where id=recipient and active) then
  return 'Assignment access has changed. Choose an eligible active employee.';
 end if;
 -- Full access preserves existing active-employee eligibility during hierarchy setup.
 if private.can('*') then return null;end if;
 select pos.assignment_level into recipient_level from public.profiles p join public.positions pos on pos.id=p.position_id and pos.active where p.id=recipient;
 if recipient_level is null or recipient_level>sender_level then
  return 'Assignment access has changed. Choose an employee whose configured position level is the same as yours or below.';
 end if;
 return null;
end $$;
revoke all on function private.assignment_scope_error(uuid) from public,anon,authenticated;

-- Assignment-specific names and position labels; the shared directory/read policies are unchanged.
create function private.assignment_recipients() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare reason text=private.assignment_scope_error(null); recipients jsonb; begin
 if private.me() is null then raise exception 'Employee account is inactive or unauthorized' using errcode='42501';end if;
 if reason is not null then return jsonb_build_object('can_manage',false,'reason',reason,'recipients','[]'::jsonb);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'position_id',p.position_id,
  'position_name',pos.name,'position_active',pos.active,'assignment_level',pos.assignment_level) order by lower(p.name),p.id),'[]'::jsonb)
 into recipients from public.profiles p left join public.positions pos on pos.id=p.position_id
 where p.active and private.assignment_scope_error(p.id) is null;
 return jsonb_build_object('can_manage',true,'reason',null,'recipients',recipients);
end $$;
create function public.assignment_recipients() returns jsonb language sql security invoker set search_path='' as $$ select private.assignment_recipients() $$;
revoke all on function private.assignment_recipients(),public.assignment_recipients() from public,anon,authenticated;
grant execute on function private.assignment_recipients(),public.assignment_recipients() to authenticated;

create or replace function private.manage(p_entity text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare who uuid=private.me(); rid uuid=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); permission text; existing uuid; result jsonb; old public.kpi_targets; item jsonb; access_role uuid; is_new boolean; cat uuid; normalized_name text; prior_position public.positions; prior_level integer; next_level integer; scope_error text; current_recipient uuid; begin
 permission=case p_entity when 'profiles' then 'employees.manage' when 'positions' then 'positions.manage' when 'activities' then 'activities.manage' when 'activity_categories' then 'activities.manage' when 'activity_steps' then 'activities.manage' when 'workflow_settings' then 'settings.manage' when 'products' then 'products.manage' when 'assignments' then 'assignments.manage' when 'kpi_targets' then 'kpis.manage' when 'settings' then 'settings.manage' when 'roles' then 'permissions.manage' when 'profile_roles' then 'permissions.manage' when 'position_roles' then 'permissions.manage' when 'position_access' then 'permissions.manage' end;
 perform pg_advisory_xact_lock(8417201);
 if who is null or permission is null or not private.can(permission) then raise exception 'Permission denied' using errcode='42501';end if;
 -- The same lock serializes assignments, position/employee edits and permission changes.
 -- Resolve identity again after a possible lock wait.
 who=private.me();
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
   select * into prior_position from public.positions where id=rid;
   prior_level=prior_position.assignment_level;
   next_level=prior_level;
   if p ? 'assignment_level' then
    if nullif(p->>'assignment_level','') is null then next_level=null;
    else
     if (p->>'assignment_level') !~ '^[1-9][0-9]*$' or length(p->>'assignment_level')>10 then raise exception 'Assignment hierarchy level must be a positive whole number, or Not configured' using errcode='22023';end if;
     if (p->>'assignment_level')::bigint>2147483647 then raise exception 'Assignment hierarchy level must be 2147483647 or less' using errcode='22023';end if;
     next_level=(p->>'assignment_level')::integer;
    end if;
   end if;
   if not private.can('permissions.manage') and
    (next_level is distinct from prior_level or (prior_level is not null and prior_position.active is distinct from coalesce((p->>'active')::boolean,true))) then
    raise exception 'Permission management is required to change assignment hierarchy or activate/deactivate a configured position' using errcode='42501';
   end if;
   insert into public.positions(id,name,active,assignment_level) values(rid,trim(p->>'name'),coalesce((p->>'active')::boolean,true),next_level)
    on conflict(id) do update set name=excluded.name,active=excluded.active,assignment_level=excluded.assignment_level;
   if next_level is distinct from prior_level then
    insert into private.audit_log(actor_id,entity,record_id,details) values(who,'assignment_hierarchy',rid::text,jsonb_build_object('previous_level',prior_level,'new_level',next_level));
   end if;
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
  -- Even a non-privileged position can change who may manage this employee.
  -- Compare stored (including dormant) rank, not a browser claim or position name.
  if not private.can('permissions.manage') and
   (select assignment_level from public.positions where id=(select position_id from public.profiles where id=rid)) is distinct from
   (select assignment_level from public.positions where id=nullif(p->>'position_id','')::uuid) then
   raise exception 'Permission management is required for a position change that alters assignment authority' using errcode='42501';
  end if;
  if not private.can('permissions.manage') and
   (select position_id from public.profiles where id=rid) is distinct from nullif(p->>'position_id','')::uuid and
   exists(select 1 from public.positions where assignment_level is not null and id in ((select position_id from public.profiles where id=rid),nullif(p->>'position_id','')::uuid)) and
   coalesce((select active from public.positions where id=(select position_id from public.profiles where id=rid)),false) is distinct from
   coalesce((select active from public.positions where id=nullif(p->>'position_id','')::uuid),false) then
   raise exception 'Permission management is required for a position change that alters assignment authority' using errcode='42501';
  end if;
  if ((p ? 'pin_expiration_enabled' and coalesce((p->>'pin_expiration_enabled')::boolean,false) is distinct from coalesce((select pin_expiration_enabled from public.profiles where id=rid),false))
   or (p ? 'pin_expiration_date' and nullif(p->>'pin_expiration_date','')::date is distinct from (select pin_expiration_date from public.profiles where id=rid)))
   and not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) a where a->>'method'='password') then
   raise exception 'Sign in with your password to change PIN expiration' using errcode='42501';end if;
  insert into public.profiles(id,name,email,position_id,active,external_employee_id) values(rid,trim(p->>'name'),lower(trim(p->>'email')),nullif(p->>'position_id','')::uuid,coalesce((p->>'active')::boolean,true),nullif(p->>'external_employee_id','')) on conflict(id) do update set name=excluded.name,email=excluded.email,position_id=excluded.position_id,active=excluded.active,external_employee_id=excluded.external_employee_id;

  if p ? 'pin_expiration_enabled' then update public.profiles set pin_expiration_enabled=(p->>'pin_expiration_enabled')::boolean where id=rid;end if;
  if p ? 'pin_expiration_date' then update public.profiles set pin_expiration_date=nullif(p->>'pin_expiration_date','')::date where id=rid;end if;
 elsif p_entity='assignments' then
  select employee_id into current_recipient from public.assignments where id=rid for update;
  scope_error=private.assignment_scope_error(null);
  if scope_error is not null then raise exception '%',scope_error using errcode='42501';end if;
  if current_recipient is not null then
   scope_error=private.assignment_scope_error(current_recipient);
   if scope_error is not null then raise exception 'Assignment access has changed. You cannot modify this assignment under the current position hierarchy.' using errcode='42501';end if;
  end if;
  if nullif(p->>'employee_id','') is null then raise exception 'Choose an eligible employee' using errcode='22023';end if;
  scope_error=private.assignment_scope_error((p->>'employee_id')::uuid);
  if scope_error is not null then raise exception '%',scope_error using errcode='42501';end if;
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


-- Offline starts preserve command UUIDs, revision checks, ownership, current access and overlap validation.
-- Only an explicit cached workflow context allows delayed starts, with a 30-day replay window.
alter table public.products add column image_url text;
alter table public.products add constraint product_image_https check(image_url is null or (length(image_url)<=2048 and image_url ~ '^https://[^[:space:]]+$'));

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
  if not (p ? 'offline_context') and at_time<clock_timestamp()-interval '5 minutes' then raise exception 'Reconnect to start a new session';end if;
  if at_time<clock_timestamp()-interval '30 days' then raise exception 'Saved work is older than 30 days. Ask your manager to review it.' using errcode='22023';end if;
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
  if p ? 'offline_context' and p->'offline_context' is distinct from jsonb_build_object('position_id',who.position_id,'category_id',category.id,'requires_design',activity.requires_design,'requires_quantity',activity.requires_quantity,'steps_enabled',use_steps) then raise exception 'Activity settings or position changed while this work was offline. Review the saved work before syncing.' using errcode='40001';end if;
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

-- A sheet credential can only upsert designs; it cannot sign in or access work records.
create table private.design_sheet_connection(
 id boolean primary key default true check(id),
 spreadsheet_id text not null, sheet_id text not null default '',
 owner_id uuid not null references public.profiles,
 token_digest text not null check(token_digest ~ '^[a-f0-9]{64}$'),
 enabled boolean not null default true,
 last_sync timestamptz, result jsonb, updated_at timestamptz not null default now()
);
alter table private.design_sheet_connection enable row level security;
revoke all on private.design_sheet_connection from public,anon,authenticated,service_role;

create function private.design_sheet(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.design_sheet_connection; secret text; who uuid=private.me(); action text=coalesce(p->>'action','status');
begin
 if not private.can('products.manage') then raise exception 'Design management permission is required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(8417201);
 if action='connect' then
  if coalesce(p->>'spreadsheet_id','') !~ '^[a-zA-Z0-9_-]{20,100}$' or coalesce(p->>'sheet_id','') !~ '^[0-9]*$' then raise exception 'Invalid Google Sheet link' using errcode='22023';end if;
  secret=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into private.design_sheet_connection(id,spreadsheet_id,sheet_id,owner_id,token_digest)
    values(true,p->>'spreadsheet_id',coalesce(p->>'sheet_id',''),who,encode(sha256(convert_to(secret,'UTF8')),'hex'))
  on conflict(id) do update set spreadsheet_id=excluded.spreadsheet_id,sheet_id=excluded.sheet_id,
    owner_id=excluded.owner_id,token_digest=excluded.token_digest,enabled=true,last_sync=null,result=null,updated_at=now();
  insert into private.audit_log(actor_id,entity,record_id,details) values(who,'design_sheet','main',jsonb_build_object('action','connected','spreadsheet_id',p->>'spreadsheet_id'));
 elsif action='disconnect' then
  update private.design_sheet_connection set enabled=false,updated_at=now() where id;
  insert into private.audit_log(actor_id,entity,record_id,details) values(who,'design_sheet','main','{"action":"disconnected"}');
 elsif action<>'status' then raise exception 'Invalid sheet action' using errcode='22023';
 end if;
 select * into c from private.design_sheet_connection where id;
 if not found then return null;end if;
 return jsonb_build_object('enabled',c.enabled,'spreadsheet_id',c.spreadsheet_id,'sheet_id',c.sheet_id,
  'last_sync',c.last_sync,'result',c.result) || case when secret is null then '{}'::jsonb else jsonb_build_object('token',secret) end;
end $$;
create function public.design_sheet(p jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.design_sheet(p)$$;
revoke all on function private.design_sheet(jsonb),public.design_sheet(jsonb) from public,anon,authenticated;
grant execute on function private.design_sheet(jsonb),public.design_sheet(jsonb) to authenticated;

create function private.import_sheet_designs(p_digest text,p_spreadsheet_id text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.design_sheet_connection; r jsonb; canonical text; seen text[]='{}'; item_name text; item_sku text; image_value text;
 prior public.products; added int=0; updated int=0; unchanged int=0; skipped int=0; sync_result jsonb;
begin
 perform pg_advisory_xact_lock(8417201);
 select * into c from private.design_sheet_connection where id for update;
 if not found or not c.enabled or c.token_digest is distinct from p_digest or c.spreadsheet_id is distinct from p_spreadsheet_id or
  not private.has_permission(c.owner_id,'products.manage') or not exists(select 1 from public.profiles p join auth.users u on u.id=p.auth_user_id where p.id=c.owner_id and coalesce(u.banned_until,'-infinity'::timestamptz)<=now()) then raise exception 'Sheet connection unavailable' using errcode='42501';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Design rows must be an array' using errcode='22023';end if;
 if jsonb_array_length(p_rows)>5000 or octet_length(p_rows::text)>2000000 then raise exception 'Use at most 5,000 rows and 2 MB per sync' using errcode='22023';end if;
 -- Validate the entire import before touching any design.
 for r in select value from jsonb_array_elements(p_rows) loop
  item_name=btrim(r->>'name');item_sku=btrim(r->>'sku');image_value=nullif(btrim(r->>'image_url'),'');
  if coalesce(item_name,'')='' or coalesce(item_sku,'')='' then skipped=skipped+1;continue;end if;
  if jsonb_typeof(r->'name') is distinct from 'string' or jsonb_typeof(r->'sku') is distinct from 'string' or
   coalesce(length(item_name),0) not between 1 and 180 or coalesce(length(item_sku),0) not between 1 and 100 then
   raise exception 'Row %: provide Name (1–180 characters) and SKU (1–100 characters)',coalesce(r->>'row','?') using errcode='22023';end if;
  if r ? 'image_url' and jsonb_typeof(r->'image_url') not in ('string','null') then raise exception 'Row %: Image URL must be text',coalesce(r->>'row','?') using errcode='22023';end if;
  if image_value is not null and (length(image_value)>2048 or image_value !~ '^https://[^[:space:]]+$') then raise exception 'Row %: Image URL must be blank or an HTTPS link',coalesce(r->>'row','?') using errcode='22023';end if;
  canonical=lower(regexp_replace(item_sku,'\s+','','g'));
  if canonical=any(seen) then raise exception 'Row %: duplicate SKU %. Keep one row per SKU',coalesce(r->>'row','?'),item_sku using errcode='22023';end if;
  seen=array_append(seen,canonical);
 end loop;
 for r in select value from jsonb_array_elements(p_rows) loop
  item_name=btrim(r->>'name');item_sku=btrim(r->>'sku');image_value=nullif(btrim(r->>'image_url'),'');
  if coalesce(item_name,'')='' or coalesce(item_sku,'')='' then continue;end if;
  select * into prior from public.products where lower(regexp_replace(sku,'\s+','','g'))=lower(regexp_replace(item_sku,'\s+','','g')) for update;
  if not found then
   insert into public.products(name,sku,image_url) values(item_name,item_sku,image_value);
   added=added+1;
  elsif prior.name is distinct from item_name or prior.sku is distinct from item_sku or (r ? 'image_url' and prior.image_url is distinct from image_value) then
   update public.products set name=item_name,sku=item_sku,image_url=case when r ? 'image_url' then image_value else prior.image_url end,updated_at=now() where id=prior.id;
   updated=updated+1;
  else unchanged=unchanged+1;
  end if;
 end loop;
 sync_result=jsonb_build_object('added',added,'updated',updated,'unchanged',unchanged,'skipped',skipped);
 update private.design_sheet_connection set last_sync=now(),result=sync_result where id;
 if added+updated>0 then
  insert into private.audit_log(actor_id,entity,record_id,details) values(c.owner_id,'design_sheet_import',c.spreadsheet_id,sync_result);
 end if;
 return sync_result;
end $$;
create function public.import_sheet_designs(p_digest text,p_spreadsheet_id text,p_rows jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.import_sheet_designs(p_digest,p_spreadsheet_id,p_rows)$$;
revoke all on function private.import_sheet_designs(text,text,jsonb),public.import_sheet_designs(text,text,jsonb) from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.import_sheet_designs(text,text,jsonb),public.import_sheet_designs(text,text,jsonb) to service_role;


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
  if p ? 'image_url' then update public.products set image_url=nullif(btrim(p->>'image_url'),'') where id=rid;end if;
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

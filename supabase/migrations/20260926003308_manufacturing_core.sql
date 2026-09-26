-- Dedicated manufacturing database. Never apply to Relay.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create table public.positions (id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 100), active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index positions_name on public.positions(lower(regexp_replace(name,'\s+','','g')));
create table public.profiles (id uuid primary key default gen_random_uuid(), auth_user_id uuid unique references auth.users(id) on delete set null, email text not null, name text not null check(length(trim(name)) between 1 and 100), position_id uuid references public.positions, active boolean not null default true, external_employee_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index profiles_email on public.profiles(lower(trim(email)));
create index profiles_position on public.profiles(position_id);
create table public.permissions (id text primary key, name text not null);
insert into public.permissions values ('*','Full administration'),('employees.manage','Manage employees'),('positions.manage','Manage positions'),('activities.manage','Manage activities'),('products.manage','Manage products'),('assignments.manage','Assign work'),('analytics.view','View analytics'),('kpis.manage','Manage KPI targets'),('settings.manage','Manage settings'),('permissions.manage','Manage permissions');
create table public.roles (id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
insert into public.roles(name) values('Administrator'),('Employee');
create table public.role_permissions(role_id uuid not null references public.roles, permission_id text not null references public.permissions, primary key(role_id,permission_id));
insert into public.role_permissions select id,'*' from public.roles where name='Administrator';
create table public.profile_roles(profile_id uuid not null references public.profiles, role_id uuid not null references public.roles, primary key(profile_id,role_id));
create index profile_roles_role on public.profile_roles(role_id);
create table public.position_roles(position_id uuid not null references public.positions, role_id uuid not null references public.roles, primary key(position_id,role_id));
create index position_roles_role on public.position_roles(role_id);
create table public.activities(id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 100), active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index activities_name on public.activities(lower(regexp_replace(name,'[^[:alnum:]]','','g')));
create table public.activity_positions(activity_id uuid not null references public.activities,position_id uuid not null references public.positions, primary key(activity_id,position_id));
create index activity_positions_position on public.activity_positions(position_id);
create table public.products(id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 180), sku text not null check(length(trim(sku)) between 1 and 100), active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index products_sku on public.products(lower(regexp_replace(sku,'\s+','','g')));
create table public.assignments(id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles,product_id uuid not null references public.products,work_date date not null, target_quantity integer check(target_quantity>=0),status text not null default 'assigned' check(status in ('assigned','in_progress','completed','cancelled')),notes text not null default '' check(length(notes)<=2000), assigned_by uuid not null references public.profiles,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index assignments_employee_date on public.assignments(employee_id,work_date desc);
create index assignments_product on public.assignments(product_id);
create index assignments_author on public.assignments(assigned_by);
create table public.settings(id text primary key default 'main' check(id='main'),employee_kpi_visibility text not null default 'OFF' check(employee_kpi_visibility in ('OFF','TARGET_ONLY','TARGET_AND_ACTUAL')),updated_at timestamptz not null default now(),updated_by uuid references public.profiles);
insert into public.settings(id) values('main');
create table public.kpi_targets(id uuid primary key default gen_random_uuid(),activity_id uuid not null references public.activities,product_id uuid references public.products,target_value numeric not null check(target_value>0 and target_value<1000000000),metric text not null default 'units_per_productive_hour' check(metric='units_per_productive_hour'),active boolean not null default true,effective_from timestamptz not null default now(),valid_until timestamptz,supersedes_id uuid references public.kpi_targets,changed_by uuid not null references public.profiles,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index kpi_lookup on public.kpi_targets(activity_id,product_id,effective_from desc);
create index kpi_changed_by on public.kpi_targets(changed_by);
create index kpi_supersedes on public.kpi_targets(supersedes_id);
create table public.sessions(id uuid primary key,employee_id uuid not null references public.profiles,position_id uuid references public.positions,activity_id uuid not null references public.activities,product_id uuid not null references public.products,assignment_id uuid references public.assignments,employee_name text not null,position_name text not null,activity_name text not null,product_name text not null,sku text not null,started_at timestamptz not null,ended_at timestamptz,status text not null default 'running' check(status in ('running','awaiting_quantity','completed')),quantity integer check(quantity between 0 and 1000000000),revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(ended_at is null or ended_at>=started_at),check((status='running' and ended_at is null and quantity is null) or (status='awaiting_quantity' and ended_at is not null and quantity is null) or (status='completed' and ended_at is not null and quantity is not null)));
create unique index one_active_session on public.sessions(employee_id) where status<>'completed';
create index sessions_employee_date on public.sessions(employee_id,started_at desc);
create index sessions_started on public.sessions(started_at);
create index sessions_activity_product on public.sessions(activity_id,product_id,started_at);
create index sessions_position on public.sessions(position_id);
create index sessions_product on public.sessions(product_id);
create index sessions_assignment on public.sessions(assignment_id);
create table public.segments(id uuid primary key,session_id uuid not null references public.sessions,kind text not null check(kind in ('WORK','WALKING','INTERRUPTION')),started_at timestamptz not null,ended_at timestamptz,reason_id uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(ended_at is null or ended_at>=started_at));
create unique index one_open_segment on public.segments(session_id) where ended_at is null;
create index segments_session on public.segments(session_id,started_at);
create table private.command_receipts(id uuid primary key,employee_id uuid not null references public.profiles,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now());
create index receipts_employee on private.command_receipts(employee_id);
create table private.session_targets(session_id uuid primary key references public.sessions,kpi_id uuid references public.kpi_targets,target_value numeric,created_at timestamptz not null default now());
create table private.audit_log(id uuid primary key default gen_random_uuid(),actor_id uuid references public.profiles,entity text not null,record_id text,details jsonb not null,created_at timestamptz not null default now());
alter table private.command_receipts enable row level security;
alter table private.session_targets enable row level security;
alter table private.audit_log enable row level security;

create function private.me() returns uuid language sql stable security definer set search_path='' as $$ select id from public.profiles where auth_user_id=auth.uid() and active and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false) $$;
create function private.can(p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.roles r on r.active join public.role_permissions rp on rp.role_id=r.id where p.id=private.me() and (rp.permission_id=p_permission or rp.permission_id='*') and (exists(select 1 from public.profile_roles pr where pr.profile_id=p.id and pr.role_id=r.id) or exists(select 1 from public.position_roles pr join public.positions ps on ps.id=pr.position_id and ps.active where pr.position_id=p.position_id and pr.role_id=r.id))) $$;
create function private.my_position() returns uuid language sql stable security definer set search_path='' as $$ select position_id from public.profiles where id=private.me() $$;
create function private.touch() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now();return new;end $$;
do $$ declare t text; begin foreach t in array array['profiles','positions','roles','activities','products','assignments','settings','kpi_targets','sessions','segments'] loop execute format('create trigger touch before update on public.%I for each row execute function private.touch()',t);end loop;end $$;

-- Read access is independently enforced even when clients bypass the UI.
do $$ declare t text; begin foreach t in array array['profiles','positions','permissions','roles','role_permissions','profile_roles','position_roles','activities','activity_positions','products','assignments','settings','kpi_targets','sessions','segments'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon, authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
create policy read_profiles on public.profiles for select to authenticated using(id=private.me() or private.can('employees.manage') or private.can('assignments.manage') or private.can('analytics.view') or private.can('permissions.manage'));
create policy read_positions on public.positions for select to authenticated using(private.me() is not null);
create policy read_permissions on public.permissions for select to authenticated using(private.can('permissions.manage'));
create policy read_roles on public.roles for select to authenticated using(private.can('permissions.manage'));
create policy read_role_permissions on public.role_permissions for select to authenticated using(private.can('permissions.manage'));
create policy read_profile_roles on public.profile_roles for select to authenticated using(private.can('permissions.manage'));
create policy read_position_roles on public.position_roles for select to authenticated using(private.can('permissions.manage'));
create policy read_activities on public.activities for select to authenticated using(private.can('activities.manage') or private.can('analytics.view') or private.can('kpis.manage') or (active and exists(select 1 from public.activity_positions ap where ap.activity_id=id and ap.position_id=private.my_position())));
create policy read_activity_positions on public.activity_positions for select to authenticated using(private.me() is not null);
create policy read_products on public.products for select to authenticated using(private.me() is not null and (active or private.can('products.manage') or private.can('analytics.view') or private.can('assignments.manage') or private.can('kpis.manage')));
create policy read_assignments on public.assignments for select to authenticated using(employee_id=private.me() or private.can('assignments.manage') or private.can('analytics.view'));
create policy read_settings on public.settings for select to authenticated using(private.me() is not null);
create policy read_kpis on public.kpi_targets for select to authenticated using(private.can('kpis.manage') or private.can('analytics.view'));
create policy read_sessions on public.sessions for select to authenticated using(employee_id=private.me() or private.can('analytics.view'));
create policy read_segments on public.segments for select to authenticated using(exists(select 1 from public.sessions s where s.id=session_id));

create function private.app_context() returns jsonb language plpgsql stable security definer set search_path='' as $$ declare p public.profiles; perms jsonb; begin select * into p from public.profiles where id=private.me();if p.id is null then raise exception 'Your employee account is not active. Contact your manager.' using errcode='42501';end if;select coalesce(jsonb_agg(id),'[]') into perms from public.permissions where private.can(id);return jsonb_build_object('profile',to_jsonb(p),'permissions',perms,'visibility',(select employee_kpi_visibility from public.settings where id='main'));end $$;
create function public.app_context() returns jsonb language sql security invoker set search_path='' as $$ select private.app_context() $$;
create function private.session_json(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$ select to_jsonb(s)||jsonb_build_object('segments',coalesce((select jsonb_agg(to_jsonb(g) order by g.started_at,g.created_at) from public.segments g where g.session_id=s.id),'[]')) from public.sessions s where s.id=p_id and (s.employee_id=private.me() or private.can('analytics.view')) $$;
create function private.active_session() returns jsonb language sql stable security definer set search_path='' as $$ select private.session_json(id) from public.sessions where employee_id=private.me() and status<>'completed' $$;
create function public.active_session() returns jsonb language sql security invoker set search_path='' as $$ select private.active_session() $$;

create function private.session_command(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare who public.profiles; s public.sessions; seg public.segments; receipt private.command_receipts; aid uuid; pid uuid; asid uuid; req uuid=(p->>'request_id')::uuid; sid uuid=(p->>'session_id')::uuid; action text=p->>'action'; at_time timestamptz=(p->>'at')::timestamptz; result jsonb; target public.kpi_targets; begin
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
  if asid is not null and not exists(select 1 from public.assignments where id=asid and employee_id=who.id and product_id=pid and status in ('assigned','in_progress')) then raise exception 'Assignment is unavailable' using errcode='42501';end if;
  insert into public.sessions(id,employee_id,position_id,activity_id,product_id,assignment_id,employee_name,position_name,activity_name,product_name,sku,started_at)
   select sid,who.id,who.position_id,aid,pid,asid,who.name,coalesce(pos.name,''),a.name,pr.name,pr.sku,at_time from public.activities a,public.products pr left join public.positions pos on pos.id=who.position_id where a.id=aid and pr.id=pid;
  insert into public.segments(id,session_id,kind,started_at) values(req,sid,'WORK',at_time);
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
  else
   if s.status<>'running' then raise exception 'Session is no longer running';end if;
   select * into seg from public.segments where session_id=sid and ended_at is null for update;
   if seg.id is null or at_time<seg.started_at then raise exception 'Device clock moved backwards. Reconnect before continuing.';end if;
   if action not in ('transition','finish') then raise exception 'Invalid action';end if;
   if action='transition' and (p->>'kind' is null or p->>'kind' not in ('WORK','WALKING','INTERRUPTION') or p->>'kind'=seg.kind) then raise exception 'Invalid timer state';end if;
   update public.segments set ended_at=at_time where id=seg.id;
   if action='transition' then insert into public.segments(id,session_id,kind,started_at) values(req,sid,p->>'kind',at_time);update public.sessions set revision=revision+1 where id=sid;
   else update public.sessions set status='awaiting_quantity',ended_at=at_time,revision=revision+1 where id=sid;end if;
  end if;
 end if;
 result=private.session_json(sid);
 insert into private.command_receipts(id,employee_id,payload,result) values(req,who.id,p,result);
 return result;
end $$;
create function public.session_command(p jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.session_command(p) $$;

create function private.employee_kpi(p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare v text; val numeric; begin
 if not exists(select 1 from public.sessions where id=p_session and employee_id=private.me()) then raise exception 'Unauthorized' using errcode='42501';end if;
 select employee_kpi_visibility into v from public.settings where id='main';if v='OFF' then return jsonb_build_object('visibility',v);end if;
 select target_value into val from private.session_targets where session_id=p_session;return jsonb_build_object('visibility',v,'target',val);
end $$;
create function public.employee_kpi(p_session uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.employee_kpi(p_session) $$;

-- Privileged mutations are explicit allowlisted operations, not client-controlled SQL.
create function private.manage(p_entity text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare who uuid=private.me(); rid uuid=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid()); permission text; existing uuid; result jsonb; old public.kpi_targets; item jsonb; begin
 permission=case p_entity when 'profiles' then 'employees.manage' when 'positions' then 'positions.manage' when 'activities' then 'activities.manage' when 'products' then 'products.manage' when 'assignments' then 'assignments.manage' when 'kpi_targets' then 'kpis.manage' when 'settings' then 'settings.manage' when 'roles' then 'permissions.manage' when 'profile_roles' then 'permissions.manage' when 'position_roles' then 'permissions.manage' end;
 if who is null or permission is null or not private.can(permission) then raise exception 'Permission denied' using errcode='42501';end if;
 -- Serialize administration to protect the last administrator and avoid lost role updates.
 perform pg_advisory_xact_lock(8417201);
 if p_entity in ('positions','activities') then
  if p_entity='positions' then insert into public.positions(id,name,active) values(rid,trim(p->>'name'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,active=excluded.active;
  else insert into public.activities(id,name,active) values(rid,trim(p->>'name'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,active=excluded.active;
   delete from public.activity_positions where activity_id=rid;insert into public.activity_positions select rid,value::uuid from jsonb_array_elements_text(coalesce(p->'position_ids','[]'));
  end if;
 elsif p_entity='products' then insert into public.products(id,name,sku,active) values(rid,trim(p->>'name'),trim(p->>'sku'),coalesce((p->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,sku=excluded.sku,active=excluded.active;
 elsif p_entity='profiles' then
  if trim(p->>'email')!~'^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email';end if;
  if exists(select 1 from public.profiles where id=rid and auth_user_id is not null and lower(email)<>lower(trim(p->>'email'))) then raise exception 'Linked sign-in email cannot be changed here';end if;
  if not private.can('permissions.manage') and (exists(select 1 from public.profile_roles pr join public.role_permissions rp on rp.role_id=pr.role_id where pr.profile_id=rid and rp.permission_id in ('*','permissions.manage')) or exists(select 1 from public.position_roles where position_id=nullif(p->>'position_id','')::uuid) or exists(select 1 from public.profiles pr join public.position_roles r on r.position_id=pr.position_id where pr.id=rid)) then raise exception 'Permission management is required to change a privileged employee or position' using errcode='42501';end if;
  insert into public.profiles(id,name,email,position_id,active,external_employee_id) values(rid,trim(p->>'name'),lower(trim(p->>'email')),nullif(p->>'position_id','')::uuid,coalesce((p->>'active')::boolean,true),nullif(p->>'external_employee_id','')) on conflict(id) do update set name=excluded.name,email=excluded.email,position_id=excluded.position_id,active=excluded.active,external_employee_id=excluded.external_employee_id;
 elsif p_entity='assignments' then
  insert into public.assignments(id,employee_id,product_id,work_date,target_quantity,status,notes,assigned_by) values(rid,(p->>'employee_id')::uuid,(p->>'product_id')::uuid,(p->>'work_date')::date,nullif(p->>'target_quantity','')::integer,coalesce(p->>'status','assigned'),coalesce(p->>'notes',''),who) on conflict(id) do update set employee_id=excluded.employee_id,product_id=excluded.product_id,work_date=excluded.work_date,target_quantity=excluded.target_quantity,status=excluded.status,notes=excluded.notes;
 elsif p_entity='kpi_targets' then
  if p->>'id' is not null then select * into old from public.kpi_targets where id=rid;if old.id is null then raise exception 'KPI version not found';end if;update public.kpi_targets set valid_until=coalesce(nullif(p->>'effective_from','')::timestamptz,now()) where id=rid;rid=gen_random_uuid();end if;
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
create function public.manage(p_entity text,p jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.manage(p_entity,p) $$;

-- No open enrollment: an administrator must first add this exact email.
create function private.link_employee() returns trigger language plpgsql security definer set search_path='' as $$ begin
 update public.profiles set auth_user_id=new.id where lower(email)=lower(new.email) and auth_user_id is null and active;
 if not found then raise exception 'Ask your manager to add this email before creating your account.';end if;return new;
end $$;
create trigger link_employee after insert on auth.users for each row execute function private.link_employee();

create view public.session_metrics with(security_invoker=true) as
 select s.*,coalesce(sum(extract(epoch from(g.ended_at-g.started_at))) filter(where g.kind='WORK'),0)::float8 as work_seconds,coalesce(sum(extract(epoch from(g.ended_at-g.started_at))) filter(where g.kind='WALKING'),0)::float8 as walking_seconds,coalesce(sum(extract(epoch from(g.ended_at-g.started_at))) filter(where g.kind='INTERRUPTION'),0)::float8 as interruption_seconds,extract(epoch from(s.ended_at-s.started_at))::float8 as total_seconds,count(g.id) filter(where g.kind='WALKING')::int as walking_events,count(g.id) filter(where g.kind='INTERRUPTION')::int as interruption_events
 from public.sessions s left join public.segments g on g.session_id=s.id where s.status='completed' group by s.id;
revoke all on public.session_metrics from anon,authenticated;
grant select on public.session_metrics to authenticated;

create function private.analytics_targets(p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin if not private.can('analytics.view') then raise exception 'Permission denied' using errcode='42501';end if;return coalesce((select jsonb_agg(to_jsonb(t)) from private.session_targets t where session_id=any(p_ids)),'[]');end $$;
create function public.analytics_targets(p_ids uuid[]) returns jsonb language sql security invoker set search_path='' as $$ select private.analytics_targets(p_ids) $$;

-- Revoke PostgreSQL's implicit PUBLIC function execution before granting the narrow API.
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function private.me(),private.can(text),private.my_position(),private.app_context(),private.active_session(),private.session_command(jsonb),private.employee_kpi(uuid),private.manage(text,jsonb),private.analytics_targets(uuid[]) to authenticated;
grant execute on function public.app_context(),public.active_session(),public.session_command(jsonb),public.employee_kpi(uuid),public.manage(text,jsonb),public.analytics_targets(uuid[]) to authenticated;

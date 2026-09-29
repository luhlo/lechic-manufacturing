-- LOCAL ONLY. Synthetic identities, roles and work are rolled back; never run against employees.
begin;
create function pg_temp.hid(n integer) returns uuid language sql immutable as $$ select ('80000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.deny(entity text, payload jsonb, expected text default '42501') returns void language plpgsql as $$
begin
 begin perform public.manage(entity,payload);exception when others then
  assert sqlstate=expected, 'Expected '||expected||', got '||sqlstate||': '||sqlerrm;return;
 end;
 raise exception 'FAIL: unauthorized % mutation accepted',entity;
end $$;
create function pg_temp.assignment_payload(employee integer, assignment integer default 100) returns jsonb language sql as $$
 select jsonb_build_object('id',pg_temp.hid(assignment),'employee_id',pg_temp.hid(employee),'product_id',pg_temp.hid(50),'work_date',current_date,'target_quantity',10,'status','assigned','notes','Fixture') $$;
create function pg_temp.position_payload(p_position integer, level jsonb) returns jsonb language sql as $$
 select jsonb_build_object('id',pg_temp.hid(p_position),'name','Hierarchy '||p_position,'active',true,'assignment_level',level) $$;
create function pg_temp.profile_payload(employee integer, p_position integer) returns jsonb language sql as $$
 select jsonb_build_object('id',pg_temp.hid(employee),'name','Worker '||employee,'email','hierarchy-'||employee||'@example.invalid','position_id',pg_temp.hid(p_position),'active',true) $$;
insert into public.positions(id,name,assignment_level,active) values
 (pg_temp.hid(1),'Hierarchy 1',1,true),(pg_temp.hid(2),'Hierarchy 2',2,true),
 (pg_temp.hid(3),'Hierarchy 3',2,true),(pg_temp.hid(4),'Hierarchy 4',3,true),
 (pg_temp.hid(5),'Hierarchy 5',null,true),(pg_temp.hid(6),'Hierarchy 6',99,true),
 (pg_temp.hid(7),'Hierarchy 7',99,true),(pg_temp.hid(8),'Hierarchy 8',null,true),
 (pg_temp.hid(9),'Hierarchy 9',1,false),(pg_temp.hid(10),'Hierarchy 10',1,true),
 (pg_temp.hid(11),'Hierarchy 11',2,true),(pg_temp.hid(12),'Hierarchy 12',3,true);
insert into public.profiles(id,name,email,position_id)
 select pg_temp.hid(n),'Worker '||n,'hierarchy-'||n||'@example.invalid',case when n=13 then null else pg_temp.hid(n) end from generate_series(1,13) n;
insert into auth.users(id,email) select id,email from public.profiles where email like 'hierarchy-%@example.invalid';
insert into public.position_roles select p.id,r.id from public.positions p cross join public.roles r where p.name like 'Hierarchy %' and r.name='Employee';
insert into public.profile_roles select pg_temp.hid(8),id from public.roles where name='Administrator';
insert into public.roles(id,name) values (pg_temp.hid(30),'Hierarchy assigner'),(pg_temp.hid(31),'Hierarchy viewer'),(pg_temp.hid(32),'Hierarchy personnel'),(pg_temp.hid(33),'Hierarchy access');
insert into public.role_permissions values
 (pg_temp.hid(30),'assignments.manage'),(pg_temp.hid(31),'assignments.view'),(pg_temp.hid(31),'analytics.view'),
 (pg_temp.hid(32),'employees.manage'),(pg_temp.hid(32),'positions.manage'),(pg_temp.hid(33),'permissions.manage');
insert into public.position_roles values (pg_temp.hid(1),pg_temp.hid(30)),(pg_temp.hid(2),pg_temp.hid(30)),(pg_temp.hid(7),pg_temp.hid(31));
-- Individual overrides deliberately retain rank checks, even with no/inactive position.
insert into public.profile_roles values (pg_temp.hid(3),pg_temp.hid(30)),(pg_temp.hid(5),pg_temp.hid(30)),(pg_temp.hid(9),pg_temp.hid(30)),(pg_temp.hid(13),pg_temp.hid(30)),(pg_temp.hid(11),pg_temp.hid(32));
insert into public.products(id,name,sku) values(pg_temp.hid(50),'Hierarchy design','HIER-QA'),(pg_temp.hid(51),'Other hierarchy design','HIER-QA-2');
insert into public.activities(id,name) values(pg_temp.hid(52),'Hierarchy activity');
insert into public.activity_positions values(pg_temp.hid(52),pg_temp.hid(10));

select set_config('request.jwt.claim.sub',pg_temp.hid(2)::text,true);
set local role authenticated;
do $$ declare scope jsonb; n integer;begin
 -- A/B/C: downward and equal across different positions; upper/unconfigured/inactive hidden.
 scope=public.assignment_recipients();
 assert (scope->>'can_manage')::boolean;
 assert exists(select 1 from jsonb_array_elements(scope->'recipients') r where r->>'id'=pg_temp.hid(1)::text),'A lower shown';
 assert exists(select 1 from jsonb_array_elements(scope->'recipients') r where r->>'id'=pg_temp.hid(3)::text),'B equal different position shown';
 assert not exists(select 1 from jsonb_array_elements(scope->'recipients') r where r->>'id' in (pg_temp.hid(4)::text,pg_temp.hid(5)::text,pg_temp.hid(9)::text,pg_temp.hid(13)::text)),'C/H only configured active eligible positions';
 assert not ((scope->'recipients'->0) ? 'email') and not ((scope->'recipients'->0) ? 'auth_user_id'),'directory has no private account data';
 perform public.manage('assignments',pg_temp.assignment_payload(1));
 perform public.manage('assignments',pg_temp.assignment_payload(3,101));
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(4,102));
 -- I: browser claims cannot spoof actor, ranks, full admin or target.
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(4,102)||jsonb_build_object('sender_id',pg_temp.hid(8),'sender_level',999,'recipient_level',1,'permissions','["*"]'::jsonb));
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(999,102));
 begin update public.positions set assignment_level=999 where id=pg_temp.hid(2);raise exception 'FAIL direct rank';exception when insufficient_privilege then null;end;
 begin update public.assignments set employee_id=pg_temp.hid(4) where id=pg_temp.hid(100);raise exception 'FAIL direct reassignment';exception when insufficient_privilege then null;end;
 begin insert into public.assignments(id,employee_id,product_id,work_date,assigned_by) values(pg_temp.hid(120),pg_temp.hid(4),pg_temp.hid(50),current_date,pg_temp.hid(8));raise exception 'FAIL direct insert';exception when insufficient_privilege then null;end;
 begin perform private.assignment_scope_error(pg_temp.hid(4));raise exception 'FAIL internal helper exposed';exception when insufficient_privilege then null;end;
 -- K: proposed target must be in scope.
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(4));
 perform public.manage('assignments',pg_temp.assignment_payload(3));
 -- O: individual grant provides no full-admin bypass and no unrelated capabilities.
 perform set_config('request.jwt.claim.sub',pg_temp.hid(3)::text,true);
 assert private.can('assignments.manage') and not private.can('*') and not private.can('analytics.view');
 perform public.manage('assignments',pg_temp.assignment_payload(1,103));
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(4,104));
 -- D: level one to another position at level one.
 perform set_config('request.jwt.claim.sub',pg_temp.hid(1)::text,true);
 perform public.manage('assignments',pg_temp.assignment_payload(10,105));
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(2,106));
 -- E/F: high rank and view-only never grant management.
 perform set_config('request.jwt.claim.sub',pg_temp.hid(6)::text,true);
 assert not (public.assignment_recipients()->>'can_manage')::boolean;
 assert not private.can('analytics.view') and not private.can('employees.manage') and not private.can('permissions.manage');
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(1,106));
 perform set_config('request.jwt.claim.sub',pg_temp.hid(7)::text,true);
 assert private.can('assignments.view') and not (public.assignment_recipients()->>'can_manage')::boolean;
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(1,106));
 -- H: NULL, inactive and missing sender positions deny even individual grants.
 foreach n in array array[5,9,13] loop
  perform set_config('request.jwt.claim.sub',pg_temp.hid(n)::text,true);
  assert not (public.assignment_recipients()->>'can_manage')::boolean;
  assert public.assignment_recipients()->>'reason' like 'Ask your Operations Manager%';
  perform pg_temp.deny('assignments',pg_temp.assignment_payload(1,106));
 end loop;
end $$;
reset role;
-- Full admin needs a usable verified account, not a position named OM.
select set_config('request.jwt.claim.sub',pg_temp.hid(8)::text,true);
set local role authenticated;
do $$ declare scope jsonb; n integer;begin
 scope=public.assignment_recipients();assert jsonb_array_length(scope->'recipients')=13,'G admin bypass including unconfigured setup';
 foreach n in array array[4,5,9,13] loop perform public.manage('assignments',pg_temp.assignment_payload(n,110+n));end loop;
 -- Positive whole levels, explicit NULL, both management capabilities and dedicated audit.
 perform public.manage('positions',pg_temp.position_payload(5,'2'));
 perform public.manage('positions',pg_temp.position_payload(5,'null'));
 perform pg_temp.deny('positions',pg_temp.position_payload(5,'0'),'22023');
 perform pg_temp.deny('positions',pg_temp.position_payload(5,'-1'),'22023');
 perform pg_temp.deny('positions',pg_temp.position_payload(5,'1.5'),'22023');
 perform pg_temp.deny('positions',pg_temp.position_payload(5,'2147483648'),'22023');
 perform pg_temp.deny('positions',pg_temp.position_payload(5,'"abc"'),'22023');
 -- J/K/L: recipient promotion changes both edit/cancel and old side of reassignment.
 perform public.manage('positions',pg_temp.position_payload(3,'3'));
 perform set_config('request.jwt.claim.sub',pg_temp.hid(2)::text,true);
 assert not exists(select 1 from jsonb_array_elements(public.assignment_recipients()->'recipients') r where r->>'id'=pg_temp.hid(3)::text),'stale selector updated';
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(3));
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(3)||'{"status":"cancelled"}'::jsonb);
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(1));
 -- They originally created this assignment, but ownership grants no exception.
 assert (select assigned_by from public.assignments where id=pg_temp.hid(100))=pg_temp.hid(2);
 perform set_config('request.jwt.claim.sub',pg_temp.hid(8)::text,true);
 perform public.manage('positions',pg_temp.position_payload(3,'2'));
 -- An actor demotion also invalidates a cached form.
 perform public.manage('positions',pg_temp.position_payload(2,'1'));
 perform set_config('request.jwt.claim.sub',pg_temp.hid(2)::text,true);
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(3,130));
 perform set_config('request.jwt.claim.sub',pg_temp.hid(8)::text,true);
 perform public.manage('positions',pg_temp.position_payload(2,'2'));
 -- Same token, revoked grant: retry is reauthorized.
 perform public.manage('position_access',jsonb_build_object('id',pg_temp.hid(2),'permission_ids','["my_work.access"]'::jsonb));
 perform set_config('request.jwt.claim.sub',pg_temp.hid(2)::text,true);
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(1,130));
 assert not (public.assignment_recipients()->>'can_manage')::boolean;
 -- N: personnel manager cannot assign a higher/lower rank or create a ranked position.
 perform set_config('request.jwt.claim.sub',pg_temp.hid(11)::text,true);
 perform pg_temp.deny('profiles',pg_temp.profile_payload(11,12));
 perform pg_temp.deny('profiles',pg_temp.profile_payload(12,11));
 perform pg_temp.deny('profiles',pg_temp.profile_payload(14,12));
 perform pg_temp.deny('positions',pg_temp.position_payload(11,'99'));
 perform pg_temp.deny('positions',pg_temp.position_payload(11,'null'));
 perform pg_temp.deny('positions',pg_temp.position_payload(14,'99'));
 perform pg_temp.deny('positions',pg_temp.position_payload(12,'3')||'{"active":false}'::jsonb);
 perform pg_temp.deny('profile_roles',jsonb_build_object('id',pg_temp.hid(11),'role_ids',jsonb_build_array(pg_temp.hid(30))));
 perform pg_temp.deny('position_roles',jsonb_build_object('id',pg_temp.hid(11),'role_ids',jsonb_build_array(pg_temp.hid(30))));
 -- A non-authority name edit still works and omitted level is preserved.
 perform public.manage('positions',jsonb_build_object('id',pg_temp.hid(12),'name','Hierarchy 12 renamed'));
 assert (select assignment_level from public.positions where id=pg_temp.hid(12))=3;
 perform public.manage('positions',jsonb_build_object('id',pg_temp.hid(14),'name','Hierarchy new unconfigured'));
 assert (select assignment_level from public.positions where id=pg_temp.hid(14)) is null;
 -- P: analyst/viewer retains higher-level read access and a full minimal directory.
 perform set_config('request.jwt.claim.sub',pg_temp.hid(7)::text,true);
 assert exists(select 1 from public.assignments where employee_id=pg_temp.hid(4));
 assert exists(select 1 from jsonb_array_elements(public.employee_directory()) r where r->>'id'=pg_temp.hid(4)::text);
 assert public.analytics_baselines(now(),'[]') is not null;
 assert jsonb_array_length(public.assignment_recipients()->'recipients')=0;
end $$;
reset role;
do $$ begin
 assert exists(select 1 from private.audit_log where entity='assignment_hierarchy' and actor_id=pg_temp.hid(8) and record_id=pg_temp.hid(5)::text and details='{"previous_level":null,"new_level":2}'::jsonb and created_at is not null),'trusted audit old/new/actor/position/time';
 assert exists(select 1 from private.audit_log where entity='assignment_hierarchy' and record_id=pg_temp.hid(5)::text and details='{"previous_level":2,"new_level":null}'::jsonb),'audit clearing';
end $$;
-- permissions.manage alone cannot edit levels; both capabilities permit it without granting full admin.
insert into public.profile_roles values(pg_temp.hid(6),pg_temp.hid(33));
select set_config('request.jwt.claim.sub',pg_temp.hid(6)::text,true);
set local role authenticated;
select pg_temp.deny('positions',pg_temp.position_payload(12,'4'));
reset role;
insert into public.profile_roles values(pg_temp.hid(6),pg_temp.hid(32));
set local role authenticated;
select public.manage('positions',pg_temp.position_payload(12,'4'));
do $$ begin assert not private.can('*') and not private.can('assignments.manage'),'rank and access config grant no assignment capability';end $$;
reset role;
-- Revoked/inactive auth cannot use full administration to assign, even with a still-valid old token.
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.hid(8);
select set_config('request.jwt.claim.sub',pg_temp.hid(8)::text,true);
set local role authenticated;
select pg_temp.deny('assignments',pg_temp.assignment_payload(4,140));
reset role;
update auth.users set banned_until=null,email_confirmed_at=null where id=pg_temp.hid(8);
set local role authenticated;
select pg_temp.deny('assignments',pg_temp.assignment_payload(4,140));
reset role;
update auth.users set email_confirmed_at=now() where id=pg_temp.hid(8);
update public.profiles set active=false where id=pg_temp.hid(8);
set local role authenticated;
select pg_temp.deny('assignments',pg_temp.assignment_payload(4,140));
reset role;
update public.profiles set active=true where id=pg_temp.hid(8);
-- M: own work completion survives hierarchy changes, with no assignments.manage.
select set_config('request.jwt.claim.sub',pg_temp.hid(10)::text,true);
set local role authenticated;
do $$ declare req jsonb; s jsonb;begin
 assert not private.can('assignments.manage');
 req=jsonb_build_object('request_id',pg_temp.hid(200),'session_id',pg_temp.hid(210),'action','start','expected_revision',0,'at',now()-interval '2 minutes','activity_id',pg_temp.hid(52),'product_id',pg_temp.hid(50),'assignment_id',pg_temp.hid(105));
 s=public.session_command(req);assert public.session_command(req)=s,'start idempotency';
 perform set_config('request.jwt.claim.sub',pg_temp.hid(8)::text,true);
 -- Started work cannot be reassigned to another otherwise eligible recipient or design.
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(1,105),'P0001');
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(10,105)||jsonb_build_object('product_id',pg_temp.hid(51)),'P0001');
 perform public.manage('positions',pg_temp.position_payload(10,'null'));
 perform set_config('request.jwt.claim.sub',pg_temp.hid(10)::text,true);
 assert exists(select 1 from public.assignments where id=pg_temp.hid(105));
 s=public.session_command(jsonb_build_object('request_id',pg_temp.hid(201),'session_id',pg_temp.hid(210),'action','finish','expected_revision',1,'at',now()-interval '1 minute'));
 req=jsonb_build_object('request_id',pg_temp.hid(202),'session_id',pg_temp.hid(210),'action','complete','expected_revision',2,'at',now(),'quantity',10);
 s=public.session_command(req);assert s->>'status'='completed' and (s->>'quantity')::int=10;
 assert public.session_command(req)=s,'completion idempotency';
 assert (select status from public.assignments where id=pg_temp.hid(105))='completed';
 perform set_config('request.jwt.claim.sub',pg_temp.hid(8)::text,true);
 perform pg_temp.deny('assignments',pg_temp.assignment_payload(1,105),'P0001');
 -- Existing last-administrator protection survives this replacement of manage.
 perform pg_temp.deny('profile_roles',jsonb_build_object('id',pg_temp.hid(8),'role_ids','[]'::jsonb),'P0001');
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.assignment_recipients();raise exception 'FAIL anonymous recipient RPC';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: A-P assignment hierarchy, current authorization, selectors, trusted admin, rank audit, direct DML, both reassignment recipients, personnel safeguards, own completion and separate analytics';
rollback;

-- LOCAL ONLY: synthetic Auth records are rolled back. No production accounts or emails.
begin;
insert into public.positions(id,name) select ('30000000-0000-4000-8000-00000000000'||n)::uuid,'Access '||n from generate_series(1,5) n;
insert into public.profiles(id,email,name,position_id) select id,'access-'||replace(name,' ','')||'@example.invalid',name,id from public.positions where name like 'Access %';
insert into auth.users(id,email) select id,email from public.profiles where name like 'Access %';
insert into public.profile_roles select '30000000-0000-4000-8000-000000000005',id from public.roles where name='Administrator';
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000005',true);
set local role authenticated;
select public.manage('position_access','{"id":"30000000-0000-4000-8000-000000000001","permission_ids":["my_work.access"]}');
select public.manage('position_access','{"id":"30000000-0000-4000-8000-000000000002","permission_ids":["my_work.access","assignments.manage"]}');
select public.manage('position_access','{"id":"30000000-0000-4000-8000-000000000003","permission_ids":["my_work.access","analytics.view"]}');
select public.manage('position_access','{"id":"30000000-0000-4000-8000-000000000004","permission_ids":["assignments.view","analytics.view","kpis.view"]}');
select public.manage('position_access','{"id":"30000000-0000-4000-8000-000000000005","permission_ids":["*"]}');
-- Sole administrator can rely entirely on inherited position access.
select public.manage('profile_roles','{"id":"30000000-0000-4000-8000-000000000005","role_ids":[]}');
reset role;
insert into public.products(id,name,sku) values('30000000-0000-4000-8000-000000000010','Access design','ACCESS');
insert into public.activities(id,name) values('30000000-0000-4000-8000-000000000011','Access activity');
insert into public.activity_positions select '30000000-0000-4000-8000-000000000011',id from public.positions where name like 'Access %';
insert into public.kpi_targets(activity_id,target_value,changed_by) values('30000000-0000-4000-8000-000000000011',20,'30000000-0000-4000-8000-000000000005');
insert into public.assignments(employee_id,product_id,work_date,assigned_by) select id,'30000000-0000-4000-8000-000000000010',current_date,'30000000-0000-4000-8000-000000000005' from public.profiles where name like 'Access %';
set local role authenticated;
do $$ declare n int; c jsonb; begin
 for n in 1..5 loop
  perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-00000000000'||n,true);
  c=public.app_context();
  assert private.can('my_work.access')=(n<>4),'A-E My work';
  assert private.can('assignments.view')=(n in (2,4,5)),'A-E assignments view with manage implication';
  assert private.can('assignments.manage')=(n in (2,5)),'A-E assignments manage';
  assert private.can('analytics.view')=(n in (3,4,5)),'A-E analytics';
  assert private.can('dashboard.view')=(n=5),'dashboard is independent';
  assert private.can('kpis.view')=(n in (4,5)),'A-E KPI view';
  assert private.can('kpis.manage')=(n=5),'A-E KPI manage';
  assert (select count(*) from public.profiles)=(case when n=5 then 5 else 1 end),'profile account fields protected';
  assert (select count(*) from public.assignments)=(case when n=1 then 1 else 5 end),'assignment RLS';
  assert (select count(*) from public.kpi_targets)=(case when n>=3 then 1 else 0 end),'KPI RLS';
  if n<>5 then
   begin perform public.manage('position_access','{"id":"30000000-0000-4000-8000-000000000001","permission_ids":["*"]}');raise exception 'FAIL self elevation';exception when insufficient_privilege then null;end;
   begin perform public.manage('profile_roles',jsonb_build_object('id',private.me(),'role_ids','[]'::jsonb));raise exception 'FAIL employee override';exception when insufficient_privilege then null;end;
   begin update public.profiles set position_id='30000000-0000-4000-8000-000000000005' where id=private.me();raise exception 'FAIL direct position assignment';exception when insufficient_privilege then null;end;
   begin perform public.manage('kpi_targets','{}');raise exception 'FAIL KPI mutation';exception when insufficient_privilege then null;end;
   begin perform public.dashboard_summary(now(),now()+interval '1 hour');raise exception 'FAIL dashboard';exception when insufficient_privilege then null;end;
  end if;
  if n=1 then assert public.employee_directory()='[]'::jsonb,'worker gets no directory';
  elsif n<>5 then assert jsonb_array_length(public.employee_directory())=5 and not (public.employee_directory()->0 ? 'email'),'minimal directory has no account details';end if;
  if n in (1,4) then
   begin perform public.manage('assignments','{}');raise exception 'FAIL view-only write';exception when insufficient_privilege then null;end;
  end if;
  if n=4 then
   begin perform public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',gen_random_uuid(),'action','start','at',now(),'expected_revision',0));raise exception 'FAIL start without My work';exception when insufficient_privilege then null;end;
  end if;
 end loop;
end $$;
reset role;
insert into public.profiles(email,name,position_id) values('pending-access@example.invalid','Pending administrator','30000000-0000-4000-8000-000000000005');
set local role authenticated;
-- Guard full access inherited via position, including role deactivation/replacement, moving and deactivating profiles.
do $$ declare rid uuid; begin
 select role_id into rid from public.position_roles where position_id='30000000-0000-4000-8000-000000000005';
 begin perform public.manage('position_access','{"id":"30000000-0000-4000-8000-000000000005","permission_ids":["my_work.access"]}');raise exception 'FAIL last full grant removed';exception when raise_exception then assert SQLERRM like 'Keep at least one%','last position access guard';end;
 begin perform public.manage('positions','{"id":"30000000-0000-4000-8000-000000000005","name":"Access 5","active":false}');raise exception 'FAIL last position deactivated';exception when raise_exception then assert SQLERRM like 'Keep at least one%','last position active guard';end;
 begin perform public.manage('position_roles','{"id":"30000000-0000-4000-8000-000000000005","role_ids":[]}');raise exception 'FAIL last role link removed';exception when raise_exception then assert SQLERRM like 'Keep at least one%','last role link guard';end;
 begin perform public.manage('profiles','{"id":"30000000-0000-4000-8000-000000000005","name":"Access 5","email":"access-Access5@example.invalid","active":false}');raise exception 'FAIL last employee deactivated';exception when raise_exception then assert SQLERRM like 'Keep at least one%','last employee guard';end;
 begin perform public.manage('profiles','{"id":"30000000-0000-4000-8000-000000000005","name":"Access 5","email":"access-Access5@example.invalid","position_id":"30000000-0000-4000-8000-000000000001"}');raise exception 'FAIL last employee moved';exception when raise_exception then assert SQLERRM like 'Keep at least one%','last employee position guard';end;
 assert private.can('*'),'failed mutations roll back access';
 -- A pending, unlinked OM never satisfies the last usable administrator check.
 select id into rid from public.roles where name='Administrator';
 perform public.manage('position_roles',jsonb_build_object('id','30000000-0000-4000-8000-000000000005','role_ids',jsonb_build_array(rid)));
 begin perform public.manage('roles',jsonb_build_object('id',rid,'name','Administrator','active',false,'permission_ids','["*"]'::jsonb));raise exception 'FAIL last role deactivated';exception when raise_exception then assert SQLERRM like 'Keep at least one%','last reusable role active guard';end;
 begin perform public.manage('roles',jsonb_build_object('id',rid,'name','Administrator','active',true,'permission_ids','[]'::jsonb));raise exception 'FAIL last full capability removed';exception when raise_exception then assert SQLERRM like 'Keep at least one%','last reusable role permission guard';end;
 perform public.manage('position_access','{"id":"30000000-0000-4000-8000-000000000005","permission_ids":["*"]}');
 -- Permission changes take effect on the next request, with no new token.
 perform public.manage('position_access','{"id":"30000000-0000-4000-8000-000000000001","permission_ids":["dashboard.view"]}');
 perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
 assert not private.can('my_work.access') and private.can('dashboard.view'),'live revocation';
 assert public.dashboard_summary(now()-interval '1 hour',now()) ? 'quantity','dashboard summary authorized';
 assert (select count(*) from public.assignments)=0 and (select count(*) from public.kpi_targets)=0,'dashboard does not expose protected tables';
 begin perform public.analytics_baselines(now(),'[]');raise exception 'FAIL dashboard analytics';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000005',true);
 -- A second full-access employee allows the first to be reassigned without lockout.
 perform public.manage('position_access','{"id":"30000000-0000-4000-8000-000000000002","permission_ids":["*"]}');
 perform public.manage('profiles','{"id":"30000000-0000-4000-8000-000000000005","name":"Access 5","email":"access-Access5@example.invalid","position_id":"30000000-0000-4000-8000-000000000001"}');
 assert not private.can('*'),'reassignment allowed when second full admin remains';
end $$;
reset role;
select 'PASS: A-E access, read versus manage, RLS, safe lookup data, direct API denials, My work start gate, live permission changes and inherited last-administrator safeguards';
rollback;

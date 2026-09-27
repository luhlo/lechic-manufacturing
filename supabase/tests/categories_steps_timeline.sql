-- LOCAL ONLY: synthetic users and records, all rolled back. Never execute against production.
begin;
insert into public.positions(id,name) values('80000000-0000-4000-8000-000000000010','Hierarchy QA A'),('80000000-0000-4000-8000-000000000011','Hierarchy QA B');
insert into public.profiles(id,email,name,position_id) select ('80000000-0000-4000-8000-00000000000'||n)::uuid,'hierarchy-'||n||'@example.invalid','Hierarchy '||n,'80000000-0000-4000-8000-000000000010' from generate_series(1,4)n;
insert into auth.users(id,email) select id,email from public.profiles where name like 'Hierarchy %';
insert into public.profile_roles select '80000000-0000-4000-8000-000000000001',id from public.roles where name='Administrator';
insert into public.position_roles select '80000000-0000-4000-8000-000000000010',id from public.roles where name='Employee';
insert into public.roles(id,name) values('80000000-0000-4000-8000-000000000020','Hierarchy activity manager'),('80000000-0000-4000-8000-000000000021','Hierarchy analyst');
insert into public.role_permissions values('80000000-0000-4000-8000-000000000020','activities.manage'),('80000000-0000-4000-8000-000000000021','analytics.view');
insert into public.profile_roles values('80000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000020'),('80000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000021');
insert into public.activity_categories(id,name,requires_design_default,requires_quantity_default,active) values
 ('80000000-0000-4000-8000-000000000030','Hierarchy available',false,false,true),
 ('80000000-0000-4000-8000-000000000031','Hierarchy inaccessible',true,true,true),
 ('80000000-0000-4000-8000-000000000032','Hierarchy empty',false,true,true),
 ('80000000-0000-4000-8000-000000000033','Hierarchy inactive',true,true,false);
insert into public.category_positions values('80000000-0000-4000-8000-000000000032','80000000-0000-4000-8000-000000000010'),('80000000-0000-4000-8000-000000000033','80000000-0000-4000-8000-000000000010');
insert into public.activities(id,name,category_id,requires_design,requires_quantity,use_steps) values
 ('80000000-0000-4000-8000-000000000040','Hierarchy task','80000000-0000-4000-8000-000000000030',false,true,true),
 ('80000000-0000-4000-8000-000000000041','Hidden matching name','80000000-0000-4000-8000-000000000030',false,false,true),
 ('80000000-0000-4000-8000-000000000042','Hierarchy secret','80000000-0000-4000-8000-000000000031',false,false,true),
 ('80000000-0000-4000-8000-000000000043','Hierarchy no steps','80000000-0000-4000-8000-000000000030',false,false,false);
insert into public.activity_positions values
 ('80000000-0000-4000-8000-000000000040','80000000-0000-4000-8000-000000000010'),
 ('80000000-0000-4000-8000-000000000041','80000000-0000-4000-8000-000000000011'),
 ('80000000-0000-4000-8000-000000000042','80000000-0000-4000-8000-000000000011'),
 ('80000000-0000-4000-8000-000000000043','80000000-0000-4000-8000-000000000010');
insert into public.activity_steps(id,activity_id,name,active) values
 ('80000000-0000-4000-8000-000000000050','80000000-0000-4000-8000-000000000040','Recorded step',true),
 ('80000000-0000-4000-8000-000000000051','80000000-0000-4000-8000-000000000041','Secret step',true),
 ('80000000-0000-4000-8000-000000000052','80000000-0000-4000-8000-000000000040','Inactive step',false),
 ('80000000-0000-4000-8000-000000000053','80000000-0000-4000-8000-000000000043','Disabled activity step',true);
insert into public.kpi_targets(activity_id,target_value,effective_from,changed_by) values('80000000-0000-4000-8000-000000000040',99,now()-interval '1 day','80000000-0000-4000-8000-000000000001');
insert into public.products(id,name,sku) values('80000000-0000-4000-8000-000000000080','Hierarchy design','HIERARCHY');
insert into public.assignments(id,employee_id,product_id,work_date,target_quantity,assigned_by) values('80000000-0000-4000-8000-000000000081','80000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000080',current_date,3,'80000000-0000-4000-8000-000000000001');
update public.activities set requires_design=true where id='80000000-0000-4000-8000-000000000040';
update public.settings set employee_kpi_visibility='TARGET_AND_ACTUAL';
create function pg_temp.hierarchy_cmd(action text,sid uuid,rev int,at_time timestamptz,extra jsonb default '{}') returns jsonb language sql as $$
 select public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action',action,'expected_revision',rev,'at',at_time)||extra)
$$;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare v jsonb;begin
 assert not (public.app_context()->'workflow'->>'employee_activity_creation')::boolean and not(public.app_context()->'workflow'->>'activity_steps_enabled')::boolean,'both defaults off';
 assert not exists(select 1 from public.activities where id in('80000000-0000-4000-8000-000000000041','80000000-0000-4000-8000-000000000042')),'category never grants an activity';
 assert not exists(select 1 from public.activity_steps where id in('80000000-0000-4000-8000-000000000051','80000000-0000-4000-8000-000000000052')),'step RLS excludes other activity and inactive steps';
 assert not exists(select 1 from public.activity_categories where id in('80000000-0000-4000-8000-000000000031','80000000-0000-4000-8000-000000000033')),'category access and active checks';
 begin perform public.employee_create_activity('80000000-0000-4000-8000-000000000030','Denied');raise exception 'FAIL creation off';exception when insufficient_privilege then null;end;
 begin perform public.work_timeline('80000000-0000-4000-8000-000000000002',current_date);raise exception 'FAIL own timeline escalation';exception when insufficient_privilege then null;end;
 begin perform public.manage('activity_categories','{"name":"Denied"}');raise exception 'FAIL category escalation';exception when insufficient_privilege then null;end;
 begin perform public.manage('activity_steps','{"name":"Denied"}');raise exception 'FAIL step escalation';exception when insufficient_privilege then null;end;
 begin perform public.manage('activities','{"name":"Denied"}');raise exception 'FAIL activity escalation';exception when insufficient_privilege then null;end;
 begin perform public.manage('workflow_settings','{"employee_activity_creation":true}');raise exception 'FAIL settings escalation';exception when insufficient_privilege then null;end;
 begin update public.activity_categories set active=false;raise exception 'FAIL direct category write';exception when insufficient_privilege then null;end;
 begin update public.activity_steps set active=false;raise exception 'FAIL direct step write';exception when insufficient_privilege then null;end;
end $$;
-- Activity managers may configure hierarchy but cannot change global settings or read timelines.
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000003',true);
select public.manage('activity_categories','{"name":"Manager category","position_ids":[]}');
do $$ begin
 begin perform public.manage('workflow_settings','{"activity_steps_enabled":true}');raise exception 'FAIL manager settings escalation';exception when insufficient_privilege then null;end;
 begin perform public.work_timeline('80000000-0000-4000-8000-000000000002',current_date);raise exception 'FAIL manager timeline escalation';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
select public.manage('workflow_settings','{"employee_activity_creation":true}');
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000002',true);
do $$ declare v jsonb; other jsonb; created_id uuid;begin
 assert not(public.app_context()->'workflow'->>'activity_steps_enabled')::boolean,'independent switch';
 begin perform public.employee_create_activity('80000000-0000-4000-8000-000000000030',E'\t\n');raise exception 'FAIL blank whitespace activity';exception when raise_exception then assert SQLERRM like 'Enter an activity name%';end;
 v=public.employee_create_activity('80000000-0000-4000-8000-000000000030','  New   Detail  ');created_id=(v->>'id')::uuid;
 assert not(v->>'existing')::boolean,'new activity';
 assert (select created_by=private.me() and not requires_design and not requires_quantity from public.activities where activities.id=created_id),'server derived creator/defaults';
 assert (select count(*) from public.activity_positions where activity_id=created_id)=1 and (select position_id from public.activity_positions where activity_id=created_id)='80000000-0000-4000-8000-000000000010','only own position';
 other=public.employee_create_activity('80000000-0000-4000-8000-000000000030',E'\tnew detail\n');assert other->>'id'=v->>'id' and (other->>'existing')::boolean,'trim case whitespace duplicate returns accessible match';
 v=public.employee_create_activity('80000000-0000-4000-8000-000000000030','Hidden matching name');assert v->>'id'<>'80000000-0000-4000-8000-000000000041' and not(v->>'existing')::boolean,'never returns inaccessible match';
 assert not exists(select 1 from public.activities where id='80000000-0000-4000-8000-000000000041'),'matching hidden activity stays hidden';
 v=public.employee_create_activity('80000000-0000-4000-8000-000000000032','Empty category task');
 assert (select not requires_design and requires_quantity from public.activities where activities.id=(v->>'id')::uuid),'explicit empty category defaults';
 begin perform public.employee_create_activity('80000000-0000-4000-8000-000000000031','Denied');raise exception 'FAIL inaccessible category';exception when insufficient_privilege then null;end;
 begin perform public.employee_create_activity('80000000-0000-4000-8000-000000000033','Denied');raise exception 'FAIL inactive category';exception when insufficient_privilege then null;end;
 begin perform pg_temp.hierarchy_cmd('start','80000000-0000-4000-8000-000000000060',0,now()-interval '200 seconds','{"activity_id":"80000000-0000-4000-8000-000000000040","step_id":"80000000-0000-4000-8000-000000000050"}');raise exception 'FAIL global steps off';exception when raise_exception then assert SQLERRM not like 'FAIL%';end;
end $$;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
select public.manage('workflow_settings','{"activity_steps_enabled":true}');
-- Colliding activity manager edits cannot introduce an overlapping-scope duplicate.
do $$ begin
 begin perform public.manage('activities','{"name":"new  detail","category_id":"80000000-0000-4000-8000-000000000030","position_ids":["80000000-0000-4000-8000-000000000010"]}');raise exception 'FAIL manager duplicate';exception when raise_exception then assert SQLERRM like 'An activity with this name%';end;
end $$;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000002',true);
do $$ declare v jsonb; bad text;begin
 v=pg_temp.hierarchy_cmd('start','80000000-0000-4000-8000-000000000062',0,now()-interval '250 seconds','{"activity_id":"80000000-0000-4000-8000-000000000040","product_id":"80000000-0000-4000-8000-000000000080"}');
 assert v->>'step_id' is null and (v->>'steps_enabled')::boolean,'general activity remains optional with both switches on';
 perform pg_temp.hierarchy_cmd('finish','80000000-0000-4000-8000-000000000062',1,now()-interval '245 seconds');
 perform pg_temp.hierarchy_cmd('complete','80000000-0000-4000-8000-000000000062',2,now()-interval '240 seconds','{"quantity":2}');
 foreach bad in array array['80000000-0000-4000-8000-000000000051','80000000-0000-4000-8000-000000000052'] loop
 begin perform pg_temp.hierarchy_cmd('start','80000000-0000-4000-8000-000000000060',0,now()-interval '200 seconds',jsonb_build_object('activity_id','80000000-0000-4000-8000-000000000040','step_id',bad));raise exception 'FAIL wrong/inactive step';exception when raise_exception then assert SQLERRM not like 'FAIL%';end;
 end loop;
 begin perform pg_temp.hierarchy_cmd('start','80000000-0000-4000-8000-000000000060',0,now()-interval '200 seconds','{"activity_id":"80000000-0000-4000-8000-000000000043","step_id":"80000000-0000-4000-8000-000000000053"}');raise exception 'FAIL activity steps off';exception when raise_exception then assert SQLERRM not like 'FAIL%';end;
 v=pg_temp.hierarchy_cmd('start','80000000-0000-4000-8000-000000000060',0,now()-interval '200 seconds','{"activity_id":"80000000-0000-4000-8000-000000000040","step_id":"80000000-0000-4000-8000-000000000050","product_id":"80000000-0000-4000-8000-000000000080","assignment_id":"80000000-0000-4000-8000-000000000081"}');
 assert v->>'category_name'='Hierarchy available' and v->>'step_name'='Recorded step' and (v->>'steps_enabled')::boolean,'start snapshots';
 assert public.employee_kpi('80000000-0000-4000-8000-000000000060')->>'visibility'='OFF','step not compared to whole activity KPI';
 assert public.active_session()->>'step_name'='Recorded step','recovery retains step';
end $$;
-- Rename/move/deactivate while running, disable both features; history and old workflow must survive.
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
select public.manage('workflow_settings','{"employee_activity_creation":false,"activity_steps_enabled":false}');
select public.manage('activity_categories','{"id":"80000000-0000-4000-8000-000000000030","name":"Renamed category","active":false}');
select public.manage('activity_steps','{"id":"80000000-0000-4000-8000-000000000050","activity_id":"80000000-0000-4000-8000-000000000040","name":"Renamed step","active":false}');
select public.manage('activities','{"id":"80000000-0000-4000-8000-000000000040","category_id":"80000000-0000-4000-8000-000000000032","name":"Moved task","use_steps":false,"requires_design":false,"requires_quantity":true,"position_ids":["80000000-0000-4000-8000-000000000010"]}');
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000002',true);
do $$ declare s jsonb; ended text;begin
 s=public.active_session();assert s->>'category_name'='Hierarchy available' and s->>'activity_name'='Hierarchy task' and s->>'step_name'='Recorded step','historical labels never rewritten';
 begin perform public.employee_create_activity('80000000-0000-4000-8000-000000000032','Stale ON');raise exception 'FAIL stale/offline ON';exception when insufficient_privilege then null;end;
 s=pg_temp.hierarchy_cmd('finish','80000000-0000-4000-8000-000000000060',1,now()-interval '180 seconds');ended=s->>'ended_at';
 s=pg_temp.hierarchy_cmd('complete','80000000-0000-4000-8000-000000000060',2,now()-interval '160 seconds','{"quantity":3}');assert s->>'ended_at'=ended,'quantity save never extends finish';
 assert (select completed_quantity from public.assignment_progress(array['80000000-0000-4000-8000-000000000081'::uuid]))=0,'partial step never inflates whole-design progress';
 assert (select status from public.assignments where id='80000000-0000-4000-8000-000000000081')='in_progress','partial step never marks assigned design completed';
 -- General session still starts with steps disabled; it captures whole-activity target.
 s=pg_temp.hierarchy_cmd('start','80000000-0000-4000-8000-000000000061',0,now()-interval '150 seconds','{"activity_id":"80000000-0000-4000-8000-000000000040"}');
 assert s->>'step_id' is null and s->>'category_name'='Hierarchy empty' and not(s->>'steps_enabled')::boolean,'future general workflow';
 assert public.employee_kpi('80000000-0000-4000-8000-000000000061')->>'target'='99','whole activity target retained';
 perform pg_temp.hierarchy_cmd('finish','80000000-0000-4000-8000-000000000061',1,now()-interval '140 seconds');
 perform pg_temp.hierarchy_cmd('complete','80000000-0000-4000-8000-000000000061',2,now()-interval '130 seconds','{"quantity":2}');
end $$;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000004',true);
do $$ declare v jsonb;begin
 v=public.work_timeline('80000000-0000-4000-8000-000000000002',(now() at time zone 'America/Chicago')::date);
 assert v->>'timezone'='America/Chicago' and v->>'as_of' is not null,'timeline explicit timezone/asof';
 assert not exists(select 1 from jsonb_array_elements(v->'sessions') s where s->>'employee_id'<>'80000000-0000-4000-8000-000000000002'),'employee isolation';
 v=public.analytics_baselines(now(),'[{"activity_id":"80000000-0000-4000-8000-000000000040","product_id":"80000000-0000-4000-8000-000000000080","step_id":"80000000-0000-4000-8000-000000000050"},{"activity_id":"80000000-0000-4000-8000-000000000040","product_id":null,"step_id":null}]');
 assert jsonb_array_length(v)=2 and not exists(select 1 from jsonb_array_elements(v) x where x->>'samples'<>'1'),'separate step and general baselines';
 begin perform public.manage('activity_categories','{"name":"Denied analyst"}');raise exception 'FAIL analyst mutation';exception when insufficient_privilege then null;end;
 v=public.work_timeline('80000000-0000-4000-8000-000000000002','2026-03-08');assert (v->>'day_end')::timestamptz-(v->>'day_start')::timestamptz=interval '23 hours','spring DST';
 v=public.work_timeline('80000000-0000-4000-8000-000000000002','2026-11-01');assert (v->>'day_end')::timestamptz-(v->>'day_start')::timestamptz=interval '25 hours','fall DST';
end $$;
reset role;
-- Timeline must include previous-day overlap, a separate category, and unfinished work without an invented end.
insert into public.sessions(id,employee_id,activity_id,employee_name,position_name,activity_name,product_name,sku,started_at,ended_at,status,quantity,requires_design,requires_quantity) values
 ('80000000-0000-4000-8000-000000000070','80000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000043','Hierarchy 2','','Old general','','','2026-09-20 23:50-05','2026-09-21 00:10-05','completed',null,false,false),
 ('80000000-0000-4000-8000-000000000071','80000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000040','Hierarchy 2','','Other recorded work','','','2026-09-21 00:20-05','2026-09-21 00:30-05','completed',null,false,false),
 ('80000000-0000-4000-8000-000000000072','80000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000040','Hierarchy 2','','Running','','','2026-09-21 01:00-05',null,'running',null,false,false),
 ('80000000-0000-4000-8000-000000000073','80000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000040','Hierarchy 3','','Other employee','','','2026-09-21 01:00-05','2026-09-21 01:10-05','completed',null,false,false);
insert into public.segments(id,session_id,kind,started_at,ended_at,ordinal) select gen_random_uuid(),id,'WORK',started_at,ended_at,1 from public.sessions where id in('80000000-0000-4000-8000-000000000070','80000000-0000-4000-8000-000000000071','80000000-0000-4000-8000-000000000072','80000000-0000-4000-8000-000000000073');
set local role authenticated;
do $$ declare v jsonb;begin
 v=public.work_timeline('80000000-0000-4000-8000-000000000002','2026-09-21');
 assert jsonb_array_length(v->'sessions')=3,'full chronology with overlap and all activities';
 assert v->'sessions'->0->>'category_id' is null,'legacy not inferred';
 assert v->'sessions'->2->>'ended_at' is null,'active end not invented';
end $$;
reset role;
-- OFF removes creation permission but keeps created rows and links.
do $$ begin
 assert exists(select 1 from public.activities where name='New Detail' and created_by='80000000-0000-4000-8000-000000000002'),'created activity persisted';
 assert (select count(*) from public.activity_steps where id='80000000-0000-4000-8000-000000000050')=1,'deactivated step retained';
end $$;
set local role anon;
do $$ begin
 begin perform public.employee_create_activity('80000000-0000-4000-8000-000000000030','Denied');raise exception 'FAIL anon create';exception when insufficient_privilege then null;end;
 begin perform public.work_timeline('80000000-0000-4000-8000-000000000002',current_date);raise exception 'FAIL anon timeline';exception when insufficient_privilege then null;end;
 begin perform * from public.activity_steps;raise exception 'FAIL anon steps';exception when insufficient_privilege then null;end;
end $$;
reset role;
set constraints all immediate;
select 'PASS: scoped categories and creation, management separation, RLS, steps, snapshot recovery, OFF preservation, matching KPI scopes, full timeline, legacy, midnight and DST';
rollback;

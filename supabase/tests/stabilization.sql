begin;
-- Synthetic fixtures exist only inside this transaction, and are rolled back.
insert into public.positions(id,name) values('10000000-0000-4000-8000-000000000010','QA position'),('10000000-0000-4000-8000-000000000011','QA unrelated');
insert into public.profiles(id,email,name,position_id) values('10000000-0000-4000-8000-000000000001','manufacturing-qa-admin@example.invalid','QA Admin','10000000-0000-4000-8000-000000000010'),('10000000-0000-4000-8000-000000000002','manufacturing-qa-worker@example.invalid','QA Worker','10000000-0000-4000-8000-000000000010'),('10000000-0000-4000-8000-000000000003','manufacturing-qa-other@example.invalid','QA Other','10000000-0000-4000-8000-000000000011');
insert into auth.users(id,email) values('10000000-0000-4000-8000-000000000001','manufacturing-qa-admin@example.invalid'),('10000000-0000-4000-8000-000000000002','manufacturing-qa-worker@example.invalid'),('10000000-0000-4000-8000-000000000003','manufacturing-qa-other@example.invalid');
insert into public.profile_roles select '10000000-0000-4000-8000-000000000001',id from public.roles where name='Administrator';
insert into public.position_roles select p.id,r.id from public.positions p cross join public.roles r where p.name like 'QA %' and r.name='Employee';
insert into public.activities(id,name) values('10000000-0000-4000-8000-000000000020','QA prep'),('10000000-0000-4000-8000-000000000021','QA forbidden');
insert into public.activity_positions values('10000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000010'),('10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000011');
insert into public.products(id,name,sku) values('10000000-0000-4000-8000-000000000030','QA design','QA-001'),('10000000-0000-4000-8000-000000000031','QA other design','QA-002');
insert into public.assignments(id,employee_id,product_id,work_date,target_quantity,assigned_by) values('10000000-0000-4000-8000-000000000040','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000030',current_date,30,'10000000-0000-4000-8000-000000000001');
insert into public.kpi_targets(id,activity_id,product_id,target_value,effective_from,changed_by) values('10000000-0000-4000-8000-000000000060','10000000-0000-4000-8000-000000000020',null,18,now()-interval '1 day','10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000030',22,now()-interval '1 day','10000000-0000-4000-8000-000000000001');

-- Restricted capabilities are tested against the same RPC used by the app.
insert into public.roles(id,name) values('10000000-0000-4000-8000-000000000050','QA limited manager'),('10000000-0000-4000-8000-000000000051','QA assigner'),('10000000-0000-4000-8000-000000000052','QA analyst'),('10000000-0000-4000-8000-000000000053','QA KPI manager');
insert into public.role_permissions values('10000000-0000-4000-8000-000000000050','positions.manage'),('10000000-0000-4000-8000-000000000050','employees.manage'),('10000000-0000-4000-8000-000000000051','assignments.manage'),('10000000-0000-4000-8000-000000000052','analytics.view'),('10000000-0000-4000-8000-000000000053','kpis.manage');
insert into public.profile_roles values('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000050'),('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000052');
insert into public.position_roles select '10000000-0000-4000-8000-000000000010',id from public.roles where name='Administrator';
update public.positions set active=false where id='10000000-0000-4000-8000-000000000010';
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
 assert not private.can('*'),'inactive position role cannot grant admin';
 begin perform public.manage('positions','{"id":"10000000-0000-4000-8000-000000000010","name":"QA position","active":true}');raise exception 'FAIL privilege escalation by position activation';exception when insufficient_privilege then null;end;
 begin perform public.manage('profiles','{"id":"10000000-0000-4000-8000-000000000003","name":"QA Other","email":"manufacturing-qa-other@example.invalid","active":true}');raise exception 'FAIL privileged profile mutation';exception when insufficient_privilege then null;end;
 begin perform public.analytics_baselines(now(),'[]');raise exception 'FAIL unauthorized analytics';exception when insufficient_privilege then null;end;
end $$;
reset role;
delete from public.position_roles where position_id='10000000-0000-4000-8000-000000000010';
update public.positions set active=true where id='10000000-0000-4000-8000-000000000010';
insert into public.position_roles select '10000000-0000-4000-8000-000000000010',id from public.roles where name='Employee';
delete from public.profile_roles where profile_id='10000000-0000-4000-8000-000000000002';
insert into public.profile_roles values('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000051');
set local role authenticated;
do $$ begin
 assert private.can('assignments.manage') and not private.can('employees.manage'),'assigner is not employee manager';
 perform public.manage('assignments','{"id":"10000000-0000-4000-8000-000000000040","employee_id":"10000000-0000-4000-8000-000000000002","product_id":"10000000-0000-4000-8000-000000000030","work_date":"2026-09-25","target_quantity":12}');
 begin perform public.manage('profiles','{"name":"Bad","email":"bad@example.invalid"}');raise exception 'FAIL assignment role employee escalation';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Real command lifecycle and repeated requests for every state.
set local role authenticated;
do $$ declare s jsonb;req jsonb;sid uuid=gen_random_uuid();base timestamptz=now()-interval '4 minutes';i int=0;kind text;begin
 req=jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','start','expected_revision',0,'at',base,'activity_id','10000000-0000-4000-8000-000000000020','product_id','10000000-0000-4000-8000-000000000030','assignment_id','10000000-0000-4000-8000-000000000040');
 s=public.session_command(req);assert public.session_command(req)=s,'start retry';
 foreach kind in array array['WALKING','WORK','INTERRUPTION','WORK'] loop
  i=i+1;req=jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','transition','expected_revision',i,'at',base+i*interval '30 seconds','kind',kind);
  s=public.session_command(req);assert public.session_command(req)=s,'transition retry';
  assert (select count(*) from public.segments where session_id=sid and ended_at is null)=1,'only one open segment';
 end loop;
 req=jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','finish','expected_revision',5,'at',now()-interval '1 minute');s=public.session_command(req);assert public.session_command(req)=s,'finish retry';
 req=jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','complete','expected_revision',6,'at',now(),'quantity',12);s=public.session_command(req);assert public.session_command(req)=s,'quantity retry';
 assert (select status from public.assignments where id='10000000-0000-4000-8000-000000000040')='completed','assignment target reached';
 begin perform public.manage('assignments','{"id":"10000000-0000-4000-8000-000000000040","employee_id":"10000000-0000-4000-8000-000000000003","product_id":"10000000-0000-4000-8000-000000000030","work_date":"2026-09-25"}');raise exception 'FAIL assignment history reassigned';exception when raise_exception then if SQLERRM like 'FAIL%' then raise;end if;end;
end $$;
reset role;
set constraints all immediate;
-- Constraints protect even future privileged code from gaps and duplicate open segments.
do $$ declare sid uuid;begin
 select id into sid from public.sessions where employee_id='10000000-0000-4000-8000-000000000002' and quantity=12 limit 1;
 begin update public.segments set started_at=started_at+interval '1 second' where session_id=sid and ordinal=2;raise exception 'FAIL segment gap';exception when check_violation then null;end;
 begin insert into public.segments(id,session_id,kind,started_at,ordinal) values(gen_random_uuid(),sid,'WORK',now(),6);raise exception 'FAIL completed session open segment';exception when check_violation then null;end;
end $$;
set constraints all deferred;
-- Optional quantity completes on a saved session, including zero; cancelled assignments refuse starts.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare a jsonb;sid uuid=gen_random_uuid();req jsonb;begin
 a=public.manage('assignments',jsonb_build_object('employee_id','10000000-0000-4000-8000-000000000002','product_id','10000000-0000-4000-8000-000000000031','work_date',current_date));
 req=jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','start','expected_revision',0,'at',now(),'activity_id','10000000-0000-4000-8000-000000000020','product_id','10000000-0000-4000-8000-000000000031','assignment_id',a->>'id');
 perform public.session_command(req);
 perform public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','finish','expected_revision',1,'at',now()));
 perform public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','complete','expected_revision',2,'at',now(),'quantity',0));
 assert (select status from public.assignments where id=(a->>'id')::uuid)='completed','null target assignment completes';
 assert (select work_seconds from public.session_metrics where id=sid)=0,'zero-duration completion remains valid';
 a=public.manage('assignments',jsonb_build_object('employee_id','10000000-0000-4000-8000-000000000002','product_id','10000000-0000-4000-8000-000000000031','work_date',current_date,'status','cancelled'));
 begin perform public.session_command(req||jsonb_build_object('request_id',gen_random_uuid(),'session_id',gen_random_uuid(),'assignment_id',a->>'id'));raise exception 'FAIL cancelled assignment accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
set constraints all immediate;
-- Historical labels remain immutable after all configuration names change.
update public.profiles set name='Renamed employee',active=false where id='10000000-0000-4000-8000-000000000002';
update public.positions set name='Renamed position',active=false where id='10000000-0000-4000-8000-000000000010';
update public.activities set name='Renamed activity',active=false where id='10000000-0000-4000-8000-000000000020';
update public.products set name='Renamed design',sku='RENAMED',active=false where id='10000000-0000-4000-8000-000000000030';
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ declare m record;b jsonb;begin
 select * into m from public.session_metrics where quantity=12 limit 1;
 assert m.employee_name='QA Worker' and m.position_name='QA position' and m.activity_name='QA prep' and m.product_name='QA design' and m.sku='QA-001','historical snapshots';
 assert m.work_seconds+m.walking_seconds+m.interruption_seconds=m.total_seconds,'duration conservation';
 b=public.analytics_baselines(now(),jsonb_build_array(jsonb_build_object('activity_id',m.activity_id,'product_id',m.product_id)));
 assert (b->0->>'samples')::int=1 and (b->0->>'rate')::float8=m.quantity*3600.0/m.work_seconds,'server weighted baseline';
 begin perform public.manage('kpi_targets','{}');raise exception 'FAIL analyst KPI mutation';exception when insufficient_privilege then null;end;
end $$;
reset role;
delete from public.profile_roles where profile_id='10000000-0000-4000-8000-000000000003';
insert into public.profile_roles values('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000053');
set local role authenticated;
do $$ declare data jsonb;begin
 assert private.can('kpis.manage') and not private.can('analytics.view'),'KPI manager is not analyst';
 assert (select count(*) from public.sessions)=0,'KPI manager cannot read manufacturing history';
 data=jsonb_build_object('id','10000000-0000-4000-8000-000000000060','activity_id','10000000-0000-4000-8000-000000000020','target_value',32,'effective_from',now());
 perform public.manage('kpi_targets',data);
 begin perform public.manage('kpi_targets',data);raise exception 'FAIL retired version edited';exception when raise_exception then if SQLERRM like 'FAIL%' then raise;end if;end;
 begin perform public.manage('positions','{"name":"Bad"}');raise exception 'FAIL KPI manager position edit';exception when insufficient_privilege then null;end;
end $$;
reset role;
set constraints all immediate;
select 'PASS: restricted capabilities, escalation rejection, every-command idempotency, assignment completion and identity freeze, segment integrity, immutable snapshots, baseline aggregation, KPI version guards' as result;
rollback;

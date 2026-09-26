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


insert into public.activities(id,name,requires_design,requires_quantity)
select ('20000000-0000-4000-8000-00000000000'||n)::uuid,'Requirements '||n,n in (1,2),n in (1,3) from generate_series(1,4)n;
insert into public.activity_positions select id,'10000000-0000-4000-8000-000000000010'::uuid from public.activities where name like 'Requirements %';
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare n int; aid uuid; sid uuid; pid uuid; t timestamptz=now()-interval '2 minutes'; result jsonb; req jsonb; result2 jsonb; begin
 for n in 1..4 loop
  aid=('20000000-0000-4000-8000-00000000000'||n)::uuid;sid=gen_random_uuid();pid=case when n in(1,2) then '10000000-0000-4000-8000-000000000030'::uuid else null end;
  req=jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','start','at',t,'expected_revision',0,'activity_id',aid,'product_id',pid);
  result=public.session_command(req);
  assert (result->>'requires_design')::boolean=(n in(1,2));
  assert (result->>'requires_quantity')::boolean=(n in(1,3));
  assert (result->>'product_id')::uuid is not distinct from pid;
  assert public.session_command(req)=result,'start replay is idempotent';
  -- All combinations retain distinct walking/interruption segments and single-tap resume.
  result=public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','transition','at',t+interval '1 second','expected_revision',1,'kind','WALKING'));
  result=public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','transition','at',t+interval '2 seconds','expected_revision',2,'kind','WORK'));
  result=public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','transition','at',t+interval '3 seconds','expected_revision',3,'kind','INTERRUPTION'));
  result=public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','transition','at',t+interval '4 seconds','expected_revision',4,'kind','WORK'));
  req=jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','finish','at',t+interval '5 seconds','expected_revision',5);
  result=public.session_command(req); assert public.session_command(req)=result,'finish replay is idempotent';
  if n in(1,3) then
   assert result->>'status'='awaiting_quantity';
   result=public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','complete','at',t+interval '6 seconds','expected_revision',6,'quantity',0));
   assert result->>'quantity'='0','actual zero is preserved';
  else
   assert result->>'quantity' is null,'not applicable is NULL';
   assert public.employee_kpi(sid)->>'visibility'='OFF','no rates for time-only sessions';
  end if;
  assert result->>'status'='completed';
  assert jsonb_array_length(result->'segments')=5;
  t=t+interval '10 seconds';
 end loop;
 -- Employee cannot change activity requirements.
 begin perform public.manage('activities',jsonb_build_object('id',aid,'name','Escalation','requires_design',true));raise exception 'FAIL management access';exception when insufficient_privilege then null;end;
 -- Required designs and unwanted designs are validated at the database boundary.
 begin perform public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',gen_random_uuid(),'action','start','at',t,'expected_revision',0,'activity_id','20000000-0000-4000-8000-000000000001'));raise exception 'FAIL missing design';exception when raise_exception then assert sqlerrm='Choose an active design';end;
 begin perform public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',gen_random_uuid(),'action','start','at',t,'expected_revision',0,'activity_id',aid,'product_id','10000000-0000-4000-8000-000000000030'));raise exception 'FAIL fake design';exception when raise_exception then assert sqlerrm='This activity does not use a design';end;
end $$;
reset role;
-- Start a session, then reconfigure its activity. The snapshot, not the catalog, governs Finish.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.session_command(jsonb_build_object('request_id','30000000-0000-4000-8000-000000000001','session_id','30000000-0000-4000-8000-000000000002','action','start','at',now()-interval '20 seconds','expected_revision',0,'activity_id','20000000-0000-4000-8000-000000000004'));
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.manage('activities','{"id":"20000000-0000-4000-8000-000000000004","name":"Requirements 4","requires_design":true,"requires_quantity":true,"position_ids":["10000000-0000-4000-8000-000000000010"]}');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ declare s jsonb;begin
 s=public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id','30000000-0000-4000-8000-000000000002','action','finish','at',now()-interval '10 seconds','expected_revision',1));
 assert s->>'status'='completed' and s->>'quantity' is null,'active snapshot retained';
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ declare x jsonb;begin
 x=public.analytics_baselines(now(),'[{"activity_id":"20000000-0000-4000-8000-000000000004","product_id":null}]');
 assert x='[]'::jsonb,'time-only work excluded from rate baselines';
 x=public.analytics_baselines(now(),'[{"activity_id":"20000000-0000-4000-8000-000000000003","product_id":null}]');
 assert jsonb_array_length(x)=1 and (x->0->>'rate')::float=0,'designless actual zero contributes to a rate';
end $$;
-- Management creates safe defaults and old clients cannot reset omitted flags.
do $$ declare created jsonb; aid uuid;begin
 created=public.manage('activities','{"name":"Configured requirements","position_ids":["10000000-0000-4000-8000-000000000010"]}');
 aid=(created->>'id')::uuid;
 assert (select requires_design and requires_quantity from public.activities where id=aid),'new activity preserves existing default';
 perform public.manage('activities',jsonb_build_object('id',aid,'name','Configured requirements','requires_design',false,'requires_quantity',false));
 perform public.manage('activities',jsonb_build_object('id',aid,'name','Renamed configured requirements'));
 assert (select not requires_design and not requires_quantity from public.activities where id=aid),'omitted flags preserve configuration';
end $$;
reset role;
set constraints all immediate;
select 'PASS: My Work combinations, segments, NULL vs zero, snapshots, authorization, replay and analytics';
rollback;

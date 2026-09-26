-- LOCAL ONLY. Synthetic users and all work are rolled back; no emails or production writes.
begin;
insert into public.positions(id,name) values('70000000-0000-4000-8000-000000000010','Workflow QA');
insert into public.profiles(id,email,name,position_id) select ('70000000-0000-4000-8000-00000000000'||n)::uuid,'workflow-'||n||'@example.invalid','Workflow '||n,'70000000-0000-4000-8000-000000000010' from generate_series(1,3) n;
insert into auth.users(id,email) select id,email from public.profiles where name like 'Workflow %';
insert into public.profile_roles select '70000000-0000-4000-8000-000000000001',id from public.roles where name='Administrator';
insert into public.position_roles select '70000000-0000-4000-8000-000000000010',id from public.roles where name='Employee';
insert into public.activities(id,name,requires_design,requires_quantity) select ('70000000-0000-4000-8000-00000000002'||n)::uuid,'Workflow '||n,n<=2,n in(1,3) from generate_series(1,4) n;
insert into public.activity_positions select id,'70000000-0000-4000-8000-000000000010' from public.activities where name like 'Workflow %';
insert into public.products(id,name,sku) values('70000000-0000-4000-8000-000000000030','Workflow design','WORKFLOW');
insert into public.assignments(id,employee_id,product_id,work_date,target_quantity,assigned_by) values
 ('70000000-0000-4000-8000-000000000041','70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000030',current_date,30,'70000000-0000-4000-8000-000000000001'),
 ('70000000-0000-4000-8000-000000000042','70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000030',current_date,null,'70000000-0000-4000-8000-000000000001'),
 ('70000000-0000-4000-8000-000000000043','70000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000030',current_date,50,'70000000-0000-4000-8000-000000000001');
insert into public.kpi_targets(activity_id,target_value,effective_from,changed_by) select id,20,now()-interval '1 day','70000000-0000-4000-8000-000000000001' from public.activities where name like 'Workflow %';
update public.settings set employee_kpi_visibility='TARGET_AND_ACTUAL';
create function pg_temp.work_cmd(action text,sid uuid,rev int,at_time timestamptz,extra jsonb default '{}') returns jsonb language sql as $$
 select public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action',action,'expected_revision',rev,'at',at_time)||extra)
$$;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare n int; sid uuid; a uuid; s jsonb; r jsonb; base timestamptz=now()-interval '240 seconds'; extra jsonb; invalid jsonb;begin
 begin perform public.manage('activities','{"name":"Unauthorized","requires_quantity":false}');raise exception 'FAIL workflow escalation';exception when insufficient_privilege then null;end;
 begin update public.activities set requires_quantity=false;raise exception 'FAIL direct workflow write';exception when insufficient_privilege then null;end;
 for n in 1..4 loop
  sid=('70000000-0000-4000-8000-00000000007'||n)::uuid;a=('70000000-0000-4000-8000-00000000002'||n)::uuid;
  extra=jsonb_build_object('activity_id',a,'product_id',case when n<=2 then '70000000-0000-4000-8000-000000000030' end,'assignment_id',case when n<=2 then '70000000-0000-4000-8000-000000000041' end);
  if n<=2 then
   begin perform pg_temp.work_cmd('start',sid,0,base,extra||'{"product_id":null}');raise exception 'FAIL missing design';exception when raise_exception then assert SQLERRM='Choose an active design before starting';end;
  else
   begin perform pg_temp.work_cmd('start',sid,0,base,extra||'{"product_id":"70000000-0000-4000-8000-000000000030"}');raise exception 'FAIL fake design';exception when raise_exception then assert SQLERRM like 'This activity does not use a design%';end;
  end if;
  s=pg_temp.work_cmd('start',sid,0,base,extra);
  assert (s->>'requires_design')::boolean=(n<=2),'snapshot design';assert (s->>'requires_quantity')::boolean=(n in(1,3)),'snapshot quantity';
  assert (s->>'product_id' is null)=(n>2),'no fake product';
  assert public.active_session()->>'id'=sid::text,'recovered running session';
  assert (public.employee_kpi(sid)->>'visibility'='OFF')=(n in(2,4)),'no output KPI for quantity-free work';
  s=pg_temp.work_cmd('transition',sid,1,base+interval '5 seconds','{"kind":"WALKING"}');
  s=pg_temp.work_cmd('transition',sid,2,base+interval '8 seconds','{"kind":"WORK"}');
  s=pg_temp.work_cmd('transition',sid,3,base+interval '12 seconds','{"kind":"INTERRUPTION"}');
  assert public.active_session()->'segments'->3->>'kind'='INTERRUPTION','recover exact interruption state';
  s=pg_temp.work_cmd('transition',sid,4,base+interval '15 seconds','{"kind":"WORK"}');
  r=jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','finish','expected_revision',5,'at',base+interval '20 seconds');
  s=public.session_command(r);assert public.session_command(r)=s,'finish retries idempotently';
  assert not exists(select 1 from public.segments where session_id=sid and ended_at is null),'finish immediately stops timer';
  if n in(1,3) then
   assert s->>'status'='awaiting_quantity','quantity required';assert public.active_session()->>'status'='awaiting_quantity','recover stopped quantity entry';
   foreach invalid in array array['null'::jsonb,'-1'::jsonb,'1.5'::jsonb,'1000000001'::jsonb,'10000000000000000000'::jsonb] loop
    begin perform pg_temp.work_cmd('complete',sid,6,base+interval '30 seconds',jsonb_build_object('quantity',invalid));raise exception 'FAIL invalid quantity accepted';exception when raise_exception then assert SQLERRM not like 'FAIL%';end;
   end loop;
   s=pg_temp.work_cmd('complete',sid,6,base+interval '30 seconds',jsonb_build_object('quantity',case when n=1 then 24 else 0 end));
   assert (s->>'quantity')::int=case when n=1 then 24 else 0 end,'zero is a real quantity';
  else
   assert s->>'status'='completed' and s->>'quantity' is null,'finish without fake quantity';
   begin perform pg_temp.work_cmd('complete',sid,6,base+interval '30 seconds','{"quantity":0}');raise exception 'FAIL unnecessary completion';exception when raise_exception then assert SQLERRM='Finish the session before saving quantity';end;
  end if;
  assert public.active_session() is null,'no active session after completion';
  base=base+interval '40 seconds';
 end loop;
 assert (select completed_quantity from public.assignment_progress(array['70000000-0000-4000-8000-000000000041'::uuid]))=24,'assignment progress ignores quantity-free work';
 assert (select status from public.assignments where id='70000000-0000-4000-8000-000000000041')='in_progress','partial target is not complete';
 assert (select count(*) from public.assignment_progress(array['70000000-0000-4000-8000-000000000043'::uuid]))=0,'progress cannot reveal other employee';
 assert (select sum(total_seconds) from public.session_metrics)=80,'all four workflows included in time metrics';
end $$;
reset role;
-- Start a quantity workflow, change the activity through the management RPC, then finish the original snapshot.
set local role authenticated;
select pg_temp.work_cmd('start','70000000-0000-4000-8000-000000000075',0,now()-interval '65 seconds','{"activity_id":"70000000-0000-4000-8000-000000000021","product_id":"70000000-0000-4000-8000-000000000030","assignment_id":"70000000-0000-4000-8000-000000000041"}');
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select public.manage('activities','{"id":"70000000-0000-4000-8000-000000000021","name":"Workflow 1 changed","requires_design":false,"requires_quantity":false,"position_ids":["70000000-0000-4000-8000-000000000010"]}');
-- Old clients omit flags: they must not reset them.
select public.manage('activities','{"id":"70000000-0000-4000-8000-000000000021","name":"Workflow 1 changed","position_ids":["70000000-0000-4000-8000-000000000010"]}');
do $$ begin assert not (select requires_design or requires_quantity from public.activities where id='70000000-0000-4000-8000-000000000021'),'omitted flags preserved';end $$;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
do $$ declare s jsonb; sid uuid='70000000-0000-4000-8000-000000000075';begin
 s=public.active_session();assert (s->>'requires_design')::boolean and (s->>'requires_quantity')::boolean,'existing workflow snapshot survives edit';
 s=pg_temp.work_cmd('finish',sid,1,now()-interval '60 seconds');assert s->>'status'='awaiting_quantity','original quantity rule applies';
 s=pg_temp.work_cmd('complete',sid,2,now()-interval '59 seconds','{"quantity":6}');
 assert (select completed_quantity from public.assignment_progress(array['70000000-0000-4000-8000-000000000041'::uuid]))=30,'progress accumulates sessions';
 assert (select status from public.assignments where id='70000000-0000-4000-8000-000000000041')='completed','target completion';
 -- Newly started work uses updated rules.
 s=pg_temp.work_cmd('start','70000000-0000-4000-8000-000000000076',0,now()-interval '50 seconds','{"activity_id":"70000000-0000-4000-8000-000000000021","product_id":null}');
 assert not (s->>'requires_design')::boolean and not (s->>'requires_quantity')::boolean,'new workflow uses updated flags';
 s=pg_temp.work_cmd('finish','70000000-0000-4000-8000-000000000076',1,now()-interval '40 seconds');
 -- No numeric target: a design-only assignment can complete cleanly.
 s=pg_temp.work_cmd('start','70000000-0000-4000-8000-000000000077',0,now()-interval '30 seconds','{"activity_id":"70000000-0000-4000-8000-000000000022","product_id":"70000000-0000-4000-8000-000000000030","assignment_id":"70000000-0000-4000-8000-000000000042"}');
 s=pg_temp.work_cmd('finish','70000000-0000-4000-8000-000000000077',1,now()-interval '20 seconds');
 assert (select status from public.assignments where id='70000000-0000-4000-8000-000000000042')='completed','design-only assignment without quantity target';
end $$;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
do $$ declare v jsonb;begin
 v=public.analytics_baselines(now(),'[{"activity_id":"70000000-0000-4000-8000-000000000023","product_id":null}]');
 assert v->0->>'samples'='1' and (v->0->>'rate')::numeric=0,'no-design quantity baseline supports null product and zero units';
 v=public.analytics_baselines(now(),'[{"activity_id":"70000000-0000-4000-8000-000000000022","product_id":"70000000-0000-4000-8000-000000000030"}]');
 assert v='[]'::jsonb,'quantity not applicable excluded from baseline';
 assert (select count(*) from public.assignment_progress(array['70000000-0000-4000-8000-000000000041'::uuid]))=0,'progress endpoint remains self-only even for management';
end $$;
reset role;
set local role anon;
do $$ begin begin perform * from public.assignment_progress('{}');raise exception 'FAIL anonymous progress';exception when insufficient_privilege then null;end;end $$;
reset role;
set constraints all immediate;
select 'PASS: four workflows, snapshots, assignments, null quantity, no fake design, KPI suppression, exact state recovery, bounds, idempotency, RLS and no-design analytics';
rollback;

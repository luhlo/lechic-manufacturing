-- Synthetic local tests, rolled back. Never run these against production.
begin;
insert into public.positions(id,name) values('a0000000-0000-4000-8000-000000000010','Offline QA');
insert into public.profiles(id,email,name,position_id) select ('a0000000-0000-4000-8000-00000000000'||n)::uuid,'offline-'||n||'@example.invalid','Offline '||n,'a0000000-0000-4000-8000-000000000010' from generate_series(1,2) n;
insert into auth.users(id,email) select id,email from public.profiles where name like 'Offline %';
insert into public.profile_roles select 'a0000000-0000-4000-8000-000000000001',id from public.roles where name='Administrator';
insert into public.position_roles select 'a0000000-0000-4000-8000-000000000010',id from public.roles where name='Employee';
insert into public.activities(id,name,requires_design,requires_quantity) values('a0000000-0000-4000-8000-000000000020','Offline task',false,false);
insert into public.activity_positions values('a0000000-0000-4000-8000-000000000020','a0000000-0000-4000-8000-000000000010');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare cmd jsonb; ctx jsonb; sid uuid; s jsonb; n int;begin
 begin perform public.design_sheet();raise exception 'FAIL employee sheet access';exception when insufficient_privilege then null;end;
 begin perform public.import_sheet_designs(repeat('a',64),'sheet','[]');raise exception 'FAIL direct import';exception when insufficient_privilege then null;end;
 select jsonb_build_object('position_id','a0000000-0000-4000-8000-000000000010','category_id',category_id,'requires_design',false,'requires_quantity',false,'steps_enabled',false) into ctx from public.activities where id='a0000000-0000-4000-8000-000000000020';
 for n in 1..2 loop
  sid=gen_random_uuid();
  cmd=jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','start','expected_revision',0,'at',now()-interval '2 days'+n*interval '1 hour','activity_id','a0000000-0000-4000-8000-000000000020');
  begin perform public.session_command(cmd);raise exception 'FAIL legacy delayed start';exception when raise_exception then assert SQLERRM='Reconnect to start a new session';end;
  begin perform public.session_command(cmd||jsonb_build_object('offline_context',ctx||'{"requires_quantity":true}'));raise exception 'FAIL changed workflow';exception when serialization_failure then null;end;
  cmd=cmd||jsonb_build_object('offline_context',ctx);
  s=public.session_command(cmd);assert s=public.session_command(cmd),'idempotent delayed start';
  s=public.session_command(jsonb_build_object('request_id',gen_random_uuid(),'session_id',sid,'action','finish','expected_revision',1,'at',now()-interval '2 days'+n*interval '1 hour'+interval '10 minutes'));
  assert s->>'status'='completed' and s->>'quantity' is null,'time-only offline replay';
 end loop;
 cmd=jsonb_set(cmd,'{request_id}',to_jsonb(gen_random_uuid()));cmd=jsonb_set(cmd,'{session_id}',to_jsonb(gen_random_uuid()));
 begin perform public.session_command(cmd);raise exception 'FAIL overlapping work';exception when invalid_parameter_value then null;end;
 cmd=jsonb_set(cmd,'{at}',to_jsonb(now()-interval '31 days'));
 begin perform public.session_command(cmd);raise exception 'FAIL excessive clock age';exception when invalid_parameter_value then null;end;
 cmd=jsonb_set(cmd,'{at}',to_jsonb(now()+interval '5 minutes'));
 begin perform public.session_command(cmd);raise exception 'FAIL future work';exception when invalid_parameter_value then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.design_sheet('{"action":"connect","spreadsheet_id":"sheet_12345678901234567890","sheet_id":"5"}');
do $$ begin
 assert not (public.design_sheet() ? 'token'),'status never returns credential';
 begin select token_digest from private.design_sheet_connection;raise exception 'FAIL digest readable';exception when insufficient_privilege then null;end;
end $$;
reset role;
update private.design_sheet_connection set token_digest=repeat('a',64);
insert into public.products(id,name,sku,active,image_url) values('a0000000-0000-4000-8000-000000000030','Keep history','OLD',false,'https://example.invalid/a.png');
set local role service_role;
do $$ declare r jsonb;begin
 begin perform public.import_sheet_designs(repeat('b',64),'sheet_12345678901234567890','[]');raise exception 'FAIL invalid secret';exception when insufficient_privilege then null;end;
 begin perform public.import_sheet_designs(repeat('a',64),'wrong-sheet','[]');raise exception 'FAIL wrong sheet';exception when insufficient_privilege then null;end;
 r=public.import_sheet_designs(repeat('a',64),'sheet_12345678901234567890','[{"name":"Updated","sku":"old","image_url":""},{"name":"New","sku":"001"},{"name":"Waiting","sku":""}]');
 assert r='{"added":1,"updated":1,"unchanged":0,"skipped":1}'::jsonb,'upsert and incomplete row counts';
 r=public.import_sheet_designs(repeat('a',64),'sheet_12345678901234567890','[{"name":"Updated","sku":"old","image_url":""},{"name":"New","sku":"001"}]');
 assert r->>'unchanged'='2','repeated sync is idempotent';
 begin perform public.import_sheet_designs(repeat('a',64),'sheet_12345678901234567890','[{"name":"Must not persist","sku":"atomic"},{"name":"Duplicate","sku":"a t o m i c"}]');raise exception 'FAIL duplicate SKU';exception when invalid_parameter_value then null;end;
 begin perform public.import_sheet_designs(repeat('a',64),'sheet_12345678901234567890','[{"name":"Must not persist","sku":"invalid","image_url":"http://example.com/i"}]');raise exception 'FAIL insecure URL';exception when invalid_parameter_value then null;end;
end $$;
reset role;
do $$ begin
 assert exists(select 1 from public.products where id='a0000000-0000-4000-8000-000000000030' and not active and image_url is null and name='Updated'),'identity, inactive state and blank image preserved';
 assert not exists(select 1 from public.products where sku in('atomic','invalid')),'whole batch rollback';
end $$;
update public.products set image_url='https://example.invalid/current.png' where sku='001';
set local role service_role;
select public.import_sheet_designs(repeat('a',64),'sheet_12345678901234567890','[{"name":"New","sku":"001"}]');
reset role;
do $$ begin
 assert (select image_url from public.products where sku='001')='https://example.invalid/current.png','omitted column preserves image';
 assert exists(select 1 from public.products where sku='old'),'removed row never deletes design';
end $$;
update auth.users set banned_until=now()+interval '1 day' where id='a0000000-0000-4000-8000-000000000001';
set local role service_role;
do $$ begin
 begin perform public.import_sheet_designs(repeat('a',64),'sheet_12345678901234567890','[]');raise exception 'FAIL banned owner';exception when insufficient_privilege then null;end;
end $$;
reset role;
update auth.users set banned_until=null where id='a0000000-0000-4000-8000-000000000001';
delete from public.profile_roles where profile_id='a0000000-0000-4000-8000-000000000001';
set local role service_role;
do $$ begin
 begin perform public.import_sheet_designs(repeat('a',64),'sheet_12345678901234567890','[]');raise exception 'FAIL revoked owner access';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into public.profile_roles select 'a0000000-0000-4000-8000-000000000001',id from public.roles where name='Administrator';
set local role authenticated;
select public.design_sheet('{"action":"connect","spreadsheet_id":"sheet_12345678901234567890"}');
reset role;
set local role service_role;
do $$ begin
 begin perform public.import_sheet_designs(repeat('a',64),'sheet_12345678901234567890','[]');raise exception 'FAIL rotated token';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select public.design_sheet('{"action":"disconnect"}');
reset role;
update private.design_sheet_connection set token_digest=repeat('a',64);
set local role service_role;
do $$ begin
 begin perform public.import_sheet_designs(repeat('a',64),'sheet_12345678901234567890','[]');raise exception 'FAIL disabled connector';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.design_sheet();raise exception 'FAIL anon setup';exception when insufficient_privilege then null;end;
 begin perform public.import_sheet_designs(repeat('a',64),'sheet_12345678901234567890','[]');raise exception 'FAIL anon import';exception when insufficient_privilege then null;end;
end $$;
select 'PASS: offline replay and private design sync';
rollback;

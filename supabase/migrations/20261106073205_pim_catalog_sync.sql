-- Scheduled one-way earring catalog sync. Work history/IDs and local active overrides are retained.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.products
 add column pim_product_id uuid,
 add column pim_variant_id uuid unique,
 add column pim_available boolean not null default true,
 add column pim_image_key text,
 add column pim_image_expires_at timestamptz;
alter table public.products drop constraint products_name_check;
alter table public.products add constraint products_name_check check(length(trim(name)) between 1 and 403);
alter table public.products drop constraint product_image_https;
alter table public.products add constraint product_image_https check(image_url is null or (length(image_url)<=8192 and image_url ~ '^https://[^[:space:]]+$'));
alter table public.products add constraint pim_identity_pair check((pim_product_id is null)=(pim_variant_id is null));

create table private.pim_connection (
 id boolean primary key default true check(id), enabled boolean not null default false,
 sync_token_digest text check(sync_token_digest ~ '^[a-f0-9]{64}$'),
 source_secret_id uuid, sync_secret_id uuid,
 lease uuid, lease_until timestamptz, last_attempt timestamptz,
 last_sync timestamptz, source_snapshot_at timestamptz, result jsonb, last_error text
);
alter table private.pim_connection enable row level security;
revoke all on private.pim_connection from public,anon,authenticated,service_role;
insert into private.pim_connection(id) values(true);

create function private.pim_sync_begin(p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.pim_connection; new_lease uuid=gen_random_uuid(); source_token text;
begin
 select * into c from private.pim_connection where id for update;
 if c.sync_token_digest is null or c.sync_token_digest is distinct from p_digest then raise exception 'Sync access denied' using errcode='42501';end if;
 if not c.enabled or c.lease_until>clock_timestamp() or c.last_attempt>clock_timestamp()-interval '10 seconds' then return null;end if;
 select decrypted_secret into source_token from vault.decrypted_secrets where id=c.source_secret_id;
 if source_token is null then raise exception 'Source connection missing';end if;
 update private.pim_connection set lease=new_lease,lease_until=clock_timestamp()+interval '5 minutes',last_attempt=clock_timestamp() where id;
 return jsonb_build_object('lease',new_lease,'source_token',source_token);
end $$;
create function public.pim_sync_begin(p_digest text) returns jsonb language sql security invoker set search_path='' as $$select private.pim_sync_begin(p_digest)$$;

create function private.pim_sync_finish(p_lease uuid,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.pim_connection; r jsonb; prior public.products; source_time timestamptz;
 seen_ids uuid[]='{}'; seen_skus text[]='{}'; sid uuid; pid uuid; canonical text;
 added int=0; updated int=0; unchanged int=0; matched int=0; missing int=0; img text; image_expiry timestamptz; sync_result jsonb;
begin
 perform pg_advisory_xact_lock(8417201);
 select * into c from private.pim_connection where id for update;
 if not c.enabled or c.lease is distinct from p_lease or c.lease_until<clock_timestamp() or p_lease is null then raise exception 'Sync lease expired' using errcode='42501';end if;
 if (p_snapshot->>'schema_version') is distinct from '1' or p_snapshot->>'source_project' is distinct from 'caikfzxvlyzmqvgpvgye'
  or p_snapshot->'complete' is distinct from 'true'::jsonb or jsonb_typeof(p_snapshot->'rows') is distinct from 'array'
  or jsonb_array_length(p_snapshot->'rows')>5000 or octet_length(p_snapshot::text)>4000000 then raise exception 'Invalid complete catalog' using errcode='22023';end if;
 source_time=(p_snapshot->>'snapshot_at')::timestamptz;
 if source_time is null or source_time>clock_timestamp()+interval '5 minutes' or source_time<clock_timestamp()-interval '10 minutes'
  or source_time<=c.source_snapshot_at then raise exception 'Stale catalog snapshot' using errcode='40001';end if;
 if jsonb_array_length(p_snapshot->'rows')=0 and exists(select 1 from public.products where pim_variant_id is not null) then raise exception 'Unexpected empty catalog' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(p_snapshot->'rows') loop
  sid=(r->>'variant_id')::uuid;pid=(r->>'product_id')::uuid;
  if sid is null or pid is null or jsonb_typeof(r->'name') is distinct from 'string' or length(btrim(r->>'name')) not between 1 and 403
   or jsonb_typeof(r->'sku') is distinct from 'string' or (r->>'sku') !~ '^E-[A-Z]{2}-[A-Z]{2}-[0-9]{4}$'
   or jsonb_typeof(r->'available') is distinct from 'boolean' then raise exception 'Invalid earring variant' using errcode='22023';end if;
  canonical=lower(regexp_replace(r->>'sku','\s+','','g'));
  if sid=any(seen_ids) or canonical=any(seen_skus) then raise exception 'Duplicate source identity or SKU' using errcode='22023';end if;
  seen_ids=array_append(seen_ids,sid);seen_skus=array_append(seen_skus,canonical);
  if not(r?'image_url') or jsonb_typeof(r->'image_url') not in ('string','null') or
   (nullif(r->>'image_url','') is not null and (length(r->>'image_url')>8192 or (r->>'image_url') !~ '^https://[^[:space:]]+$')) then raise exception 'Invalid image URL' using errcode='22023';end if;
 end loop;
 for r in select value from jsonb_array_elements(p_snapshot->'rows') loop
  sid=(r->>'variant_id')::uuid;pid=(r->>'product_id')::uuid;
  select * into prior from public.products where pim_variant_id=sid for update;
  if not found then
   select * into prior from public.products where lower(regexp_replace(sku,'\s+','','g'))=lower(regexp_replace(r->>'sku','\s+','','g')) for update;
   if found then
    if prior.pim_variant_id is not null then raise exception 'SKU is linked to a different variant' using errcode='23505';end if;
    matched=matched+1;
   end if;
  elsif prior.pim_product_id is distinct from pid or prior.sku is distinct from r->>'sku' then raise exception 'Permanent source identity changed' using errcode='22023';
  end if;
  img=nullif(r->>'image_url','');image_expiry=(r->>'image_expires_at')::timestamptz;
  -- Keep an unexpired signed URL stable for browser/offline caches.
  if prior.id is not null and prior.pim_image_key is not distinct from r->>'image_key'
   and prior.pim_image_expires_at>clock_timestamp()+interval '6 hours' and img is not null then
   img=prior.image_url;image_expiry=prior.pim_image_expires_at;
  end if;
  if prior.id is null then
   insert into public.products(name,sku,image_url,pim_product_id,pim_variant_id,pim_available,pim_image_key,pim_image_expires_at)
    values(r->>'name',r->>'sku',img,pid,sid,(r->>'available')::boolean,r->>'image_key',image_expiry);
   added=added+1;
  elsif prior.name is distinct from r->>'name' or prior.sku is distinct from r->>'sku' or prior.image_url is distinct from img
   or prior.pim_variant_id is distinct from sid or prior.pim_available is distinct from (r->>'available')::boolean
   or prior.pim_image_key is distinct from r->>'image_key' or prior.pim_image_expires_at is distinct from image_expiry then
   update public.products set name=r->>'name',sku=r->>'sku',image_url=img,pim_product_id=pid,pim_variant_id=sid,
    pim_available=(r->>'available')::boolean,pim_image_key=r->>'image_key',pim_image_expires_at=image_expiry,updated_at=now() where id=prior.id;
   updated=updated+1;
  else unchanged=unchanged+1;
  end if;
 end loop;
 update public.products set pim_available=false,updated_at=now() where pim_variant_id is not null and pim_available and not(pim_variant_id=any(seen_ids));
 get diagnostics missing=row_count;
 sync_result=jsonb_build_object('added',added,'updated',updated,'unchanged',unchanged,'matched',matched,'unavailable',missing,'total',cardinality(seen_ids));
 update private.pim_connection set lease=null,lease_until=null,last_sync=clock_timestamp(),source_snapshot_at=source_time,result=sync_result,last_error=null where id;
 -- Switch sources only after an entirely successful, atomic import.
 update private.design_sheet_connection set enabled=false,updated_at=now() where id and enabled;
 if added+updated+missing>0 then insert into private.audit_log(entity,record_id,details) values('pim_catalog','caikfzxvlyzmqvgpvgye',sync_result);end if;
 return sync_result;
end $$;
create function public.pim_sync_finish(p_lease uuid,p_snapshot jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.pim_sync_finish(p_lease,p_snapshot)$$;

create function private.pim_sync_fail(p_lease uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.pim_connection set lease=null,lease_until=null,last_error='The SKU database could not be refreshed. Saved products are still available; the next automatic refresh will retry.' where id and lease=p_lease;
end $$;
create function public.pim_sync_fail(p_lease uuid) returns void language sql security invoker set search_path='' as $$select private.pim_sync_fail(p_lease)$$;

revoke all on function private.pim_sync_begin(text),public.pim_sync_begin(text),private.pim_sync_finish(uuid,jsonb),public.pim_sync_finish(uuid,jsonb),private.pim_sync_fail(uuid),public.pim_sync_fail(uuid) from public,anon,authenticated,service_role;
grant execute on function private.pim_sync_begin(text),public.pim_sync_begin(text),private.pim_sync_finish(uuid,jsonb),public.pim_sync_finish(uuid,jsonb),private.pim_sync_fail(uuid),public.pim_sync_fail(uuid) to service_role;

create function private.queue_pim_sync() returns bigint language plpgsql security definer set search_path='' as $$
declare c private.pim_connection; secret text; request_id bigint;
begin
 select * into c from private.pim_connection where id for update;
 if not c.enabled or c.sync_secret_id is null or c.lease_until>clock_timestamp() or c.last_attempt>clock_timestamp()-interval '10 seconds' then return null;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where id=c.sync_secret_id;
 if secret is null then raise exception 'Product connection is not configured';end if;
 select net.http_post(url:='https://bbbgrxvidrlmrrezfmil.supabase.co/functions/v1/manufacturing-pim-sync',
  headers:=jsonb_build_object('Content-Type','application/json','x-sync-key',secret),body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end $$;
revoke all on function private.queue_pim_sync() from public,anon,authenticated,service_role;

create function private.pim_catalog(p_action text default 'status') returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.pim_connection; request_id bigint;
begin
 if not private.can('products.manage') then raise exception 'Design management permission is required' using errcode='42501';end if;
 if p_action='refresh' then request_id=private.queue_pim_sync();
 elsif p_action<>'status' then raise exception 'Invalid catalog action' using errcode='22023';end if;
 select * into c from private.pim_connection where id;
 return jsonb_build_object('enabled',c.enabled,'last_sync',c.last_sync,'last_attempt',c.last_attempt,'result',c.result,'last_error',c.last_error,
  'syncing',coalesce(c.lease_until>clock_timestamp(),false),'requested',request_id is not null,'interval_minutes',5);
end $$;
create function public.pim_catalog(p_action text default 'status') returns jsonb language sql security invoker set search_path='' as $$select private.pim_catalog(p_action)$$;
revoke all on function public.pim_catalog(text),private.pim_catalog(text) from public,anon,authenticated,service_role;
grant execute on function public.pim_catalog(text),private.pim_catalog(text) to authenticated;

-- Names/SKUs/photos belong to PIM; local availability remains editable.
create function private.protect_pim_product() returns trigger language plpgsql set search_path='' as $$
begin
 if old.pim_variant_id is not null and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='authenticated' and
  (new.name is distinct from old.name or new.sku is distinct from old.sku or new.image_url is distinct from old.image_url
   or new.pim_variant_id is distinct from old.pim_variant_id or new.pim_product_id is distinct from old.pim_product_id or new.pim_available is distinct from old.pim_available) then
  raise exception 'Edit product details in 020 SKU database, then refresh products' using errcode='42501';end if;
 return new;
end $$;
revoke all on function private.protect_pim_product() from public,anon,authenticated,service_role;
create trigger protect_pim_product before update on public.products for each row execute function private.protect_pim_product();

create function private.guard_pim_selection() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.product_id is not distinct from old.product_id then return new;end if;
 if new.product_id is not null and exists(select 1 from public.products where id=new.product_id and not pim_available) then
  raise exception 'This product is unavailable in the SKU database' using errcode='22023';end if;
 return new;
end $$;
revoke all on function private.guard_pim_selection() from public,anon,authenticated,service_role;
create trigger pim_session_selection before insert or update of product_id on public.sessions for each row execute function private.guard_pim_selection();
create trigger pim_assignment_selection before insert or update of product_id on public.assignments for each row execute function private.guard_pim_selection();

alter function private.design_sheet(jsonb) rename to design_sheet_before_pim;
revoke all on function private.design_sheet_before_pim(jsonb) from public,anon,authenticated,service_role;
create function private.design_sheet(p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if coalesce(p->>'action','status')='connect' and exists(select 1 from private.pim_connection where id and enabled) then
  raise exception 'Products are connected to 020 SKU database' using errcode='22023';end if;
 return private.design_sheet_before_pim(p);
end $$;
revoke all on function private.design_sheet(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.design_sheet(jsonb) to authenticated;
select cron.schedule('manufacturing-pim-catalog','*/5 * * * *','select private.queue_pim_sync()');

create function private.pim_product_availability(p_id uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(8417201);
 if not private.can('products.manage') then raise exception 'Design management permission is required' using errcode='42501';end if;
 if p_active is null then raise exception 'Choose availability' using errcode='22023';end if;
 update public.products set active=p_active,updated_at=now() where id=p_id and pim_variant_id is not null;
 if not found then raise exception 'Linked product not found' using errcode='22023';end if;
 insert into private.audit_log(actor_id,entity,record_id,details) values(private.me(),'pim_availability',p_id::text,jsonb_build_object('active',p_active));
end $$;
create function public.pim_product_availability(p_id uuid,p_active boolean) returns void language sql security invoker set search_path='' as $$select private.pim_product_availability(p_id,p_active)$$;
revoke all on function private.pim_product_availability(uuid,boolean),public.pim_product_availability(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.pim_product_availability(uuid,boolean),public.pim_product_availability(uuid,boolean) to authenticated;

-- Dedicated, revocable reader for Manufacturing. No PIM content is mutated.
create table private.manufacturing_catalog_access (
 id boolean primary key default true check(id),
 token_digest text not null check(token_digest ~ '^[a-f0-9]{64}$'),
 enabled boolean not null default true,
 last_read_at timestamptz
);
alter table private.manufacturing_catalog_access enable row level security;
revoke all on private.manufacturing_catalog_access from public,anon,authenticated,service_role;

create function private.manufacturing_catalog_snapshot(p_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; access private.manufacturing_catalog_access;
begin
 select * into access from private.manufacturing_catalog_access where id for update;
 if not found or not access.enabled or access.token_digest is distinct from p_digest then
  raise exception 'Catalog access denied' using errcode='42501';
 end if;
 if access.last_read_at > clock_timestamp()-interval '5 seconds' then
  raise exception 'Try again shortly' using errcode='53300';
 end if;
 if (select count(*) from public.variants v join public.products p on p.id=v.product_id where p.product_type_code='E')>5000 then
  raise exception 'Catalog exceeds the supported sync size' using errcode='54000';
 end if;
 -- One SQL snapshot includes every assigned earring SKU, including inactive rows.
 -- A variant's own saved cover precedes a product cover, then approved listings.
 select jsonb_build_object('schema_version',1,'source_project','caikfzxvlyzmqvgpvgye',
  'snapshot_at',clock_timestamp(),'complete',true,'rows',coalesce(jsonb_agg(x.item order by x.variant_id),'[]'::jsonb)) into result
 from (
  select v.id as variant_id,jsonb_build_object(
   'product_id',p.id,'variant_id',v.id,'sku',v.sku,
   'name',p.name || case when btrim(v.name)='' or lower(btrim(v.name)) in ('default','default title','standard',lower(btrim(p.name))) then '' else ' · '||v.name end,
   'available',p.status='active' and v.status='active',
   'photo',photo.data
  ) as item
  from public.products p join public.variants v on v.product_id=p.id
  left join lateral (
   select candidate.data from (
    select 0 as priority,case when a.variant_id=v.id then 0 else 1 end as specificity,
     array_position(array['white_background','product_photo','worn','lifestyle','transparent_background'],a.category) as category,
     a.created_at as created,a.id::text as identity,
     case when a.storage_path is not null then jsonb_build_object('kind','storage','bucket','studio-assets','path',a.storage_path,'source_id',a.id)
      else jsonb_build_object('kind','external','url',a.external_url,'source_id',a.id) end as data
    from public.product_assets a where a.product_id=p.id and (a.variant_id is null or a.variant_id=v.id) and not a.archived
     and a.category in ('white_background','product_photo','worn','lifestyle','transparent_background')
     and (a.storage_path is not null or nullif(a.external_url,'') is not null)
    union all
    select 1,0,i.position,i.created_at,i.id::text,jsonb_build_object('kind','storage','bucket','product-images','path',i.storage_path,'source_id',i.id)
    from public.product_images i where i.product_id=p.id
    union all
    select 2,case when l.variant_id=v.id then 0 else 1 end,ph.ordinality::int,l.created_at,l.id::text,
      jsonb_build_object('kind','external','url',ph.value#>>'{}','source_id',l.id)
    from public.marketplace_listings l cross join lateral jsonb_array_elements(l.photos) with ordinality ph(value,ordinality)
    where l.product_id=p.id and (l.variant_id is null or l.variant_id=v.id) and jsonb_typeof(ph.value)='string' and (ph.value#>>'{}') like 'https://%'
   ) candidate order by priority,specificity,category,created desc,identity limit 1
  ) photo on true
  where p.product_type_code='E'
 ) x;
 update private.manufacturing_catalog_access set last_read_at=clock_timestamp() where id;
 return result;
end $$;
create function public.manufacturing_catalog_snapshot(p_digest text) returns jsonb
language sql security invoker set search_path='' as $$select private.manufacturing_catalog_snapshot(p_digest)$$;
revoke all on function public.manufacturing_catalog_snapshot(text),private.manufacturing_catalog_snapshot(text) from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function public.manufacturing_catalog_snapshot(text),private.manufacturing_catalog_snapshot(text) to service_role;

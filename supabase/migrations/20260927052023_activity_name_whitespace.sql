-- Normalize all whitespace before trimming, including direct RPC input with tabs/newlines.
-- Reindex because the immutable index expression now has stricter normalization.
create or replace function private.activity_name_key(value text) returns text language sql immutable set search_path='' as $$
 select lower(btrim(regexp_replace(value,'\s+',' ','g')))
$$;
reindex index public.activities_scoped_name;

create or replace function private.employee_create_activity(p_category uuid,p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
 declare who public.profiles; category public.activity_categories; existing public.activities; new_id uuid; begin
 -- Shares management's lock so toggles, names and position grants are checked atomically.
 perform pg_advisory_xact_lock(8417201);
 select * into who from public.profiles where id=private.me();
 if who.id is null or not private.can('my_work.access') or not exists(select 1 from public.positions where id=who.position_id and active) then raise exception 'My Work access and an active position are required.' using errcode='42501';end if;
 if not (select employee_activity_creation from public.settings where id='main') then raise exception 'Employee activity creation is currently off. Choose an existing activity.' using errcode='42501';end if;
 if not private.category_available(p_category) then raise exception 'This category is unavailable for your position.' using errcode='42501';end if;
 if p_name is null or length(btrim(regexp_replace(p_name,'\s+',' ','g'))) not between 1 and 100 then raise exception 'Enter an activity name between 1 and 100 characters.';end if;
 select * into category from public.activity_categories where id=p_category and active;
 select a.* into existing from public.activities a join public.activity_positions ap on ap.activity_id=a.id
 where a.category_id=p_category and ap.position_id=who.position_id and private.activity_name_key(a.name)=private.activity_name_key(p_name) order by a.active desc,a.created_at,a.id limit 1;
 if existing.id is not null then
  if not existing.active then raise exception 'This activity name is unavailable in this category. Ask a manager.';end if;
  return jsonb_build_object('id',existing.id,'existing',true);
 end if;
 insert into public.activities(name,category_id,requires_design,requires_quantity,created_by)
 values(btrim(regexp_replace(p_name,'\s+',' ','g')),p_category,category.requires_design_default,category.requires_quantity_default,who.id) returning id into new_id;
 insert into public.activity_positions values(new_id,who.position_id);
 insert into private.audit_log(actor_id,entity,record_id,details) values(who.id,'employee_activity',new_id::text,jsonb_build_object('category_id',p_category,'position_id',who.position_id,'name',btrim(regexp_replace(p_name,'\s+',' ','g'))));
 return jsonb_build_object('id',new_id,'existing',false);
end $$;

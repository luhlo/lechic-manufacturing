-- Trusted SQL only, after ALL migrations, ONLY in a new manufacturing project.
-- Reserves the requested owner and OM position; creates no Auth account/password/email.
-- Not a public RPC or an application endpoint. Do not rerun to promote unrelated users.
begin;
insert into public.profiles(name,email)
values ('Le Chic Miami','lechicmiami@gmail.com')
on conflict (lower(trim(email))) do nothing;
do $$ declare pos uuid; admin_role uuid; begin
 select id into pos from public.positions where lower(trim(name))='om';
 if pos is null then insert into public.positions(name) values('OM') returning id into pos;end if;
 select r.id into admin_role from public.roles r join public.role_permissions rp on rp.role_id=r.id where r.active and rp.permission_id='*' order by (r.name='Administrator') desc,r.id limit 1;
 if admin_role is null then raise exception 'Apply the manufacturing schema before bootstrap';end if;
 insert into public.position_roles values(pos,admin_role) on conflict do nothing;
 update public.profiles set position_id=pos where lower(trim(email))='lechicmiami@gmail.com' and position_id is null;
 insert into public.profile_roles select id,admin_role from public.profiles where lower(trim(email))='lechicmiami@gmail.com' on conflict do nothing;
end $$;
commit;

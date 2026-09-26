-- Run once, after the migration, ONLY on the new manufacturing project.
-- This reserves the supplied email. It does not set a password or send email.
begin;
insert into public.profiles(name,email)
values ('Le Chic Miami','lechicmiami@gmail.com')
on conflict (lower(trim(email))) do nothing;
insert into public.profile_roles(profile_id,role_id)
select p.id,r.id from public.profiles p cross join public.roles r
where lower(p.email)='lechicmiami@gmail.com' and r.name='Administrator'
on conflict do nothing;
commit;

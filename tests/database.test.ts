import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { test, expect } from "vitest";
test("PostgreSQL integration: migration, permissions, RLS, sessions, quantity, KPI visibility and history", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),banned_until timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;grant usage on schema auth to anon,authenticated;grant execute on all functions in schema auth to anon,authenticated;`,
  );
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (file.includes("position_access_and_pin_expiration")) {
      await db.exec(`insert into public.positions(name) values('OM');
          insert into public.profiles(id,email,name) values('50000000-0000-4000-8000-000000000001','lechicmiami@gmail.com','Migration owner');
          insert into auth.users(id,email) values('50000000-0000-4000-8000-000000000001','lechicmiami@gmail.com');
          insert into public.profile_roles select '50000000-0000-4000-8000-000000000001',id from public.roles where name='Administrator';
          insert into private.login_pins(profile_id,auth_user_id,digest,updated_at) values('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',repeat('f',64),'2020-01-01');`);
    }
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
    if (file.includes("position_access_and_pin_expiration")) {
      const migration =
        await db.query(`select not p.pin_expiration_enabled as disabled, lp.updated_at='2020-01-01'::timestamptz as timestamp_preserved, lp.digest=repeat('f',64) as digest_preserved,
          ps.name='OM' as om_assigned, private.has_permission(p.id,'*') as full_access, (select count(*) from public.positions where name='OM')=1 as no_duplicate
          from public.profiles p join private.login_pins lp on lp.profile_id=p.id join public.positions ps on ps.id=p.position_id where p.email='lechicmiami@gmail.com'`);
      expect(migration.rows).toEqual([
        {
          disabled: true,
          timestamp_preserved: true,
          digest_preserved: true,
          om_assigned: true,
          full_access: true,
          no_duplicate: true,
        },
      ]);
      await db.exec(`delete from private.login_pins; delete from public.profile_roles where profile_id='50000000-0000-4000-8000-000000000001';
          delete from auth.users where id='50000000-0000-4000-8000-000000000001'; delete from public.profiles where id='50000000-0000-4000-8000-000000000001';
          delete from public.position_roles where position_id in(select id from public.positions where name='OM'); delete from public.positions where name='OM';`);
    }
  }
  const result = await db.exec(
    readFileSync("supabase/tests/security_and_sessions.sql", "utf8"),
  );
  expect(JSON.stringify(result)).toContain("PASS:");
  const stabilization = await db.exec(
    readFileSync("supabase/tests/stabilization.sql", "utf8"),
  );
  expect(JSON.stringify(stabilization)).toContain("PASS:");
  const login = await db.exec(
    readFileSync("supabase/tests/login_security.sql", "utf8"),
  );
  expect(JSON.stringify(login)).toContain("PASS:");
  const access = await db.exec(
    readFileSync("supabase/tests/position_access.sql", "utf8"),
  );
  expect(JSON.stringify(access)).toContain("PASS:");
  const expiry = await db.exec(
    readFileSync("supabase/tests/pin_expiration.sql", "utf8"),
  );
  expect(JSON.stringify(expiry)).toContain("PASS:");
  await db.close();
});

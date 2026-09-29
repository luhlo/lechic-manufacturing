import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { test, expect } from "vitest";
test("PostgreSQL integration: migration, permissions, RLS, sessions, quantity, KPI visibility and history", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),banned_until timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;grant usage on schema auth to anon,authenticated;grant execute on all functions in schema auth to anon,authenticated;`,
  );
  let legacySession: unknown;
  let legacyActivity: unknown;
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
    if (file.includes("employee_workflow_options")) {
      await db.exec(`begin;
        insert into public.activities(id,name) values('60000000-0000-4000-8000-000000000001','Legacy activity');
        insert into public.products(id,name,sku) values('60000000-0000-4000-8000-000000000001','Legacy design','LEGACY');
        insert into public.profiles(id,email,name) values('60000000-0000-4000-8000-000000000001','legacy@example.invalid','Legacy worker');
        insert into public.sessions(id,employee_id,activity_id,product_id,employee_name,position_name,activity_name,product_name,sku,started_at,ended_at,status,quantity,revision)
          values('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','Legacy worker','','Legacy activity','Legacy design','LEGACY',now()-interval '60 seconds',now(),'completed',17,3);
        insert into public.segments(id,session_id,kind,started_at,ended_at,ordinal)
          values('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','WORK',now()-interval '60 seconds',now(),1);
        commit;`);
      legacySession = (
        await db.query(
          `select to_jsonb(s) as data from public.sessions s where id='60000000-0000-4000-8000-000000000001'`,
        )
      ).rows;
      legacyActivity = (
        await db.query(
          `select to_jsonb(a) as data from public.activities a where id='60000000-0000-4000-8000-000000000001'`,
        )
      ).rows;
    }
    if (file.includes("categories_steps_timeline")) {
      legacySession = (
        await db.query(
          `select to_jsonb(s) as data from public.sessions s where id='60000000-0000-4000-8000-000000000001'`,
        )
      ).rows;
      legacyActivity = (
        await db.query(
          `select to_jsonb(a) as data from public.activities a where id='60000000-0000-4000-8000-000000000001'`,
        )
      ).rows;
    }
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
    if (file.includes("categories_steps_timeline")) {
      expect(
        (
          await db.query(
            `select to_jsonb(s)-'category_id'-'category_name'-'step_id'-'step_name'-'steps_enabled' as data from public.sessions s where id='60000000-0000-4000-8000-000000000001'`,
          )
        ).rows,
      ).toEqual(legacySession);
      expect(
        (
          await db.query(
            `select to_jsonb(a)-'category_id'-'use_steps'-'created_by' as data from public.activities a where id='60000000-0000-4000-8000-000000000001'`,
          )
        ).rows,
      ).toEqual(legacyActivity);
      expect(
        (
          await db.query(
            `select category_id is null and category_name is null and step_id is null and step_name is null and not steps_enabled as honest_legacy from public.sessions where id='60000000-0000-4000-8000-000000000001'`,
          )
        ).rows,
      ).toEqual([{ honest_legacy: true }]);
      expect(
        (
          await db.query(
            `select c.is_fallback and c.name='Uncategorized activities' and not a.use_steps as migrated from public.activities a join public.activity_categories c on c.id=a.category_id where a.id='60000000-0000-4000-8000-000000000001'`,
          )
        ).rows,
      ).toEqual([{ migrated: true }]);
      await db.exec(`begin;
        delete from public.segments where session_id='60000000-0000-4000-8000-000000000001';
        delete from public.sessions where id='60000000-0000-4000-8000-000000000001';
        delete from public.profiles where id='60000000-0000-4000-8000-000000000001';
        delete from public.products where id='60000000-0000-4000-8000-000000000001';
        delete from public.activities where id='60000000-0000-4000-8000-000000000001';
        commit;`);
    }
    if (file.includes("employee_workflow_options")) {
      expect(
        (
          await db.query(
            `select to_jsonb(s)-'requires_design'-'requires_quantity' as data from public.sessions s where id='60000000-0000-4000-8000-000000000001'`,
          )
        ).rows,
      ).toEqual(legacySession);
      expect(
        (
          await db.query(
            `select to_jsonb(a)-'requires_design'-'requires_quantity' as data from public.activities a where id='60000000-0000-4000-8000-000000000001'`,
          )
        ).rows,
      ).toEqual(legacyActivity);
      expect(
        (
          await db.query(
            `select requires_design,requires_quantity from public.sessions where id='60000000-0000-4000-8000-000000000001'`,
          )
        ).rows,
      ).toEqual([{ requires_design: true, requires_quantity: true }]);
    }
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
  const fixedDate = await db.exec(
    readFileSync("supabase/tests/pin_expiration_date.sql", "utf8"),
  );
  expect(JSON.stringify(fixedDate)).toContain("PASS:");
  const workflow = await db.exec(
    readFileSync("supabase/tests/employee_workflow.sql", "utf8"),
  );
  expect(JSON.stringify(workflow)).toContain("PASS:");
  const hierarchy = await db.exec(
    readFileSync("supabase/tests/categories_steps_timeline.sql", "utf8"),
  );
  expect(JSON.stringify(hierarchy)).toContain("PASS:");
  const assignmentHierarchy = await db.exec(
    readFileSync("supabase/tests/assignment_hierarchy.sql", "utf8"),
  );
  expect(JSON.stringify(assignmentHierarchy)).toContain("PASS: A-P");
  await db.close();
});

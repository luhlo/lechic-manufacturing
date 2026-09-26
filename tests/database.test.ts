import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { test, expect } from "vitest";
test("PostgreSQL integration: migration, permissions, RLS, sessions, quantity, KPI visibility and history", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;grant usage on schema auth to anon,authenticated;grant execute on all functions in schema auth to anon,authenticated;`,
  );
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
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
  await db.close();
});

import { describe, expect, it } from "vitest";
import { publicConfiguration } from "../build/public-env";
import { pageFromPath, pathForPage, appHome, landingPage } from "../lib/manufacturing/routes";
import { deploymentBase } from "../build/base-path.mjs";
const url = "https://bbbgrxvidrlmrrezfmil.supabase.co";
const env = { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_public_only" };
const jwt = (role: string, ref = "bbbgrxvidrlmrrezfmil") =>
  "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({role, ref})).toString("base64url") + ".test";

describe("deployment configuration boundary", () => {
  it("fails missing production configuration but allows an unconfigured local development server", () => {
    expect(() => publicConfiguration({})).toThrow("Set NEXT_PUBLIC");
    expect(publicConfiguration({}, false)).toEqual({url: "", key: ""});
  });
  it("exposes only explicitly selected public credentials", () => {
    expect(publicConfiguration({...env, SUPABASE_SERVICE_ROLE_KEY: "private-canary", DATABASE_URL: "private-canary"}))
      .toEqual({url, key: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY});
  });
  it("rejects secret, service-role, malformed and placeholder keys", () => {
    for (const key of ["sb_secret_do_not_publish", jwt("service_role"), "eyJbroken", "sb_publishable_REPLACE_ME", "password"])
      expect(() => publicConfiguration({...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key})).toThrow("forbidden");
  });
  it("accepts this project's legacy anon key and rejects an unrelated project's", () => {
    expect(publicConfiguration({...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:jwt("anon")})).toHaveProperty("url", url);
    expect(() => publicConfiguration({...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:jwt("anon", "other")})).toThrow();
  });
  it("prevents accidental deployment against another backend", () => {
    expect(() => publicConfiguration({...env, NEXT_PUBLIC_SUPABASE_URL:"https://other.supabase.co"})).toThrow("existing Le Chic");
  });
});

describe("existing screen URLs", () => {
  it.each([
    ["/admin", "dashboard"], ["/admin/employees", "profiles"],
    ["/admin/activities", "activities"], ["/admin/assignments", "assignments"],
    ["/admin/kpis", "kpi_targets"], ["/analytics", "analytics"], ["/work", "work"],
  ])("restores %s on direct load or history navigation", (path, page) => {
    expect(pageFromPath(path)).toBe(page);
    expect(pageFromPath(path + "/")).toBe(page);
    expect(pathForPage(page)).toBe(path);
  });
  it("leaves root and login to the existing post-auth landing logic", () => {
    expect(pageFromPath("/")).toBeUndefined();
    expect(pageFromPath("/login")).toBeUndefined();
    expect(pageFromPath("/admin/not-a-screen")).toBeUndefined();
  });
});


describe("GitHub Pages project paths", () => {
  const base = "/lechic-manufacturing/";
  it("keeps navigation and sign-in callbacks inside the repository", () => {
    expect(pathForPage("profiles", base)).toBe(base + "admin/employees");
    expect(pageFromPath(base + "admin/employees/", base)).toBe("profiles");
    expect(pageFromPath("/relay/admin/employees", base)).toBeUndefined();
    expect(appHome("https://luhlo.github.io", base)).toBe("https://luhlo.github.io/lechic-manufacturing/");
  });
  it("normalizes the repository base and rejects traversal and external URLs", () => {
    expect(deploymentBase("/lechic-manufacturing")).toBe(base);
    expect(deploymentBase("/")).toBe("/");
    for (const invalid of ["../", "/../", "https://elsewhere/", "//elsewhere/", "/repo/?redirect=elsewhere"])
      expect(() => deploymentBase(invalid)).toThrow();
  });
});


describe("employee landing and session recovery", () => {
  it("lands My Work-only PIN sign-ins directly in work", () => {
    expect(landingPage(["my_work.access"],"dashboard",null,true)).toBe("work");
  });
  it("preserves management navigation and protected URL handling", () => {
    expect(landingPage(["*"],"profiles",null,true)).toBe("profiles");
    expect(landingPage(["my_work.access"],"profiles",null)).toBe("profiles");
  });
  it.each(["running", "awaiting_quantity"] as const)("prioritizes recovered %s work without granting permission", status => {
    const recovered = {status} as import("../lib/manufacturing/types").Session;
    expect(landingPage(["*"],"dashboard",recovered)).toBe("work");
    expect(landingPage(["analytics.view"],"analytics",recovered)).toBe("analytics");
  });
});

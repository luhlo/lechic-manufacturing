import { test, expect } from "vitest";
import {
  allowed,
  canViewPage,
  canManagePage,
  firstPage,
  pagePermissions,
} from "../lib/manufacturing/types";
import { pageFromPath } from "../lib/manufacturing/routes";
const cases = [
  { name: "A: work only", permissions: ["my_work.access"], pages: ["work"] },
  {
    name: "B: work and assignment manager",
    permissions: ["my_work.access", "assignments.manage"],
    pages: ["work", "assignments"],
  },
  {
    name: "C: work and analytics",
    permissions: ["my_work.access", "analytics.view"],
    pages: ["work", "analytics"],
  },
  {
    name: "D: assignments, analytics and KPI view without work",
    permissions: ["assignments.view", "analytics.view", "kpis.view"],
    pages: ["assignments", "kpi_targets", "analytics"],
  },
  { name: "E: OM", permissions: ["*"], pages: Object.keys(pagePermissions) },
];
for (const c of cases)
  test(c.name, () => {
    expect(
      Object.keys(pagePermissions).filter((p) => canViewPage(c.permissions, p)),
    ).toEqual(c.pages);
    expect(firstPage(c.permissions)).toBe(c.pages[0]);
    for (const p of ["dashboard", "analytics", "profiles", "settings"])
      expect(canViewPage(c.permissions, p)).toBe(c.pages.includes(p));
  });
test("view permissions never imply manage; management includes only its own view", () => {
  for (const [page, permission] of Object.entries(pagePermissions).filter(
    ([, p]) => p.endsWith(".view"),
  )) {
    expect(canManagePage([permission], page)).toBe(false);
  }
  expect(allowed(["assignments.manage"], "assignments.view")).toBe(true);
  expect(allowed(["assignments.manage"], "employees.view")).toBe(false);
  expect(allowed(["analytics.view"], "dashboard.view")).toBe(false);
  expect(firstPage([])).toBeUndefined();
  expect(canViewPage(["*"], "unknown")).toBe(false);
});
test("short protected URL aliases resolve to gated pages", () => {
  expect(pageFromPath("/employees", "/")).toBe("profiles");
  expect(pageFromPath("/settings", "/")).toBe("settings");
  expect(pageFromPath("/admin", "/")).toBe("dashboard");
  expect(pageFromPath("/analytics", "/")).toBe("analytics");
});

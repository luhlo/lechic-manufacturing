import { expect, test } from "vitest";
import { emptyCatalog } from "../lib/manufacturing/api";
import { relevantActivities } from "../lib/manufacturing/domain";
import {
  availableCategories,
  availableSteps,
  continuationStep,
  categoryStorageKey,
  readCategory,
  rememberCategory,
  validRememberedCategory,
} from "../lib/manufacturing/workflow";
import type { Session } from "../lib/manufacturing/types";
function fixture() {
  const c = emptyCatalog();
  c.activity_categories = [
    {
      id: "a",
      name: "Available",
      active: true,
      sort_order: 2,
      requires_design_default: true,
      requires_quantity_default: true,
    },
    {
      id: "b",
      name: "Other position",
      active: true,
      sort_order: 0,
      requires_design_default: true,
      requires_quantity_default: true,
    },
    {
      id: "c",
      name: "Empty",
      active: true,
      sort_order: 1,
      requires_design_default: false,
      requires_quantity_default: false,
    },
    {
      id: "d",
      name: "Inactive",
      active: false,
      sort_order: 0,
      requires_design_default: true,
      requires_quantity_default: true,
    },
  ];
  c.activities = [
    { id: "one", name: "Own", category_id: "a", active: true, use_steps: true },
    { id: "two", name: "Other", category_id: "b", active: true },
    {
      id: "three",
      name: "Inactive category work",
      category_id: "d",
      active: true,
    },
  ];
  c.activity_positions = [
    { activity_id: "one", position_id: "p" },
    { activity_id: "two", position_id: "other" },
    { activity_id: "three", position_id: "p" },
  ];
  c.category_positions = [{ category_id: "c", position_id: "p" }];
  c.activity_steps = [
    {
      id: "front",
      name: "Front",
      activity_id: "one",
      sort_order: 2,
      active: true,
    },
    {
      id: "back",
      name: "Back",
      activity_id: "one",
      sort_order: 1,
      active: true,
    },
    {
      id: "hidden",
      name: "Hidden",
      activity_id: "two",
      sort_order: 0,
      active: true,
    },
    {
      id: "off",
      name: "Off",
      activity_id: "one",
      sort_order: 0,
      active: false,
    },
  ];
  return c;
}
test("category choices preserve position activity scope and require active categories", () => {
  const c = fixture(),
    acts = relevantActivities(c.activities, c.activity_positions, "p");
  expect(availableCategories(c, acts, "p", false).map((c) => c.id)).toEqual([
    "a",
  ]);
  expect(availableCategories(c, acts, "p", true).map((c) => c.id)).toEqual([
    "c",
    "a",
  ]);
  expect(availableCategories(c, [], null, true)).toEqual([]);
  // Adding an explicit category link cannot add another position's activities.
  c.category_positions!.push({ category_id: "b", position_id: "p" });
  expect(
    relevantActivities(c.activities, c.activity_positions, "p").map(
      (a) => a.id,
    ),
  ).not.toContain("two");
});
test("remembered category is employee specific, revalidated, and change-category clears only that employee", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  rememberCategory("Alice", "a", storage);
  rememberCategory("Bob", "b", storage);
  expect(readCategory("Alice", storage)).toBe("a");
  expect(readCategory("Bob", storage)).toBe("b");
  expect(categoryStorageKey("Alice")).not.toBe(categoryStorageKey("Bob"));
  const c = fixture();
  const accessible = availableCategories(c, [c.activities[0]], "p", false);
  expect(validRememberedCategory("a", accessible)).toBe("a");
  expect(validRememberedCategory("b", accessible)).toBe("");
  expect(validRememberedCategory("d", accessible)).toBe("");
  rememberCategory("Alice", "", storage);
  expect(readCategory("Alice", storage)).toBe("");
  expect(readCategory("Bob", storage)).toBe("b");
});
test("unavailable preference storage never blocks work", () => {
  const fail = () => {
    throw Error("storage unavailable");
  };
  expect(readCategory("a", { getItem: fail })).toBe("");
  expect(() =>
    rememberCategory("a", "c", { setItem: fail, removeItem: fail }),
  ).not.toThrow();
});
test("step level requires both switches and active activity-owned steps", () => {
  const c = fixture();
  expect(availableSteps(c, c.activities[0], false)).toEqual([]);
  expect(
    availableSteps(c, { ...c.activities[0], use_steps: false }, true),
  ).toEqual([]);
  expect(availableSteps(c, c.activities[0], true).map((s) => s.id)).toEqual([
    "back",
    "front",
  ]);
  expect(
    availableSteps({ ...c, activity_steps: [] }, c.activities[0], true),
  ).toEqual([]);
});
test("same-activity continuation retains only an applicable step; general stays general", () => {
  const c = fixture(),
    steps = availableSteps(c, c.activities[0], true);
  expect(continuationStep({ step_id: "front" } as Session, steps)).toEqual({
    stepId: "front",
    chosen: true,
  });
  expect(continuationStep({ step_id: "off" } as Session, steps)).toEqual({
    stepId: null,
    chosen: false,
  });
  expect(continuationStep({ step_id: "front" } as Session, [])).toEqual({
    stepId: null,
    chosen: true,
  });
  expect(continuationStep({ step_id: null } as Session, steps)).toEqual({
    stepId: null,
    chosen: true,
  });
});

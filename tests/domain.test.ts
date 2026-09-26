import { test, expect } from "vitest";
import {
  applyCommand,
  chooseKpi,
  clockText,
  currentAssignments,
  rate,
  relevantActivities,
  searchProducts,
  totals,
  weightedBaseline,
} from "../lib/manufacturing/domain";
import type { Session, Product } from "../lib/manufacturing/types";
const start = "2026-09-25T12:00:00Z";
const session: Session = {
  id: "s",
  employee_id: "e",
  position_id: "pos",
  activity_id: "a",
  product_id: "p",
  assignment_id: null,
  employee_name: "A",
  position_name: "P",
  activity_name: "Prep",
  product_name: "Thing",
  sku: "P-001",
  started_at: start,
  ended_at: null,
  status: "running",
  quantity: null,
  revision: 1,
  segments: [
    {
      id: "g",
      session_id: "s",
      kind: "WORK",
      started_at: start,
      ended_at: null,
    },
  ],
};
const at = (sec: number) =>
  new Date(Date.parse(start) + sec * 1000).toISOString();
test("timestamp elapsed survives a long suspended display", () =>
  expect(totals(session.segments, Date.parse(at(7200))).work).toBe(7200));
test("work, walking, interruption, finish and quantity entry use separate exact segments", () => {
  let s = session;
  const actions = [
    ["transition", 60, "WALKING"],
    ["transition", 90, "WORK"],
    ["transition", 150, "INTERRUPTION"],
    ["transition", 180, "WORK"],
    ["finish", 240, null],
  ] as const;
  for (const [action, t, kind] of actions)
    s = applyCommand(s, {
      request_id: crypto.randomUUID(),
      session_id: "s",
      action,
      at: at(t),
      expected_revision: s.revision,
      ...(kind ? { kind } : {}),
    });
  s = applyCommand(s, {
    request_id: "q",
    session_id: "s",
    action: "complete",
    at: at(800),
    expected_revision: s.revision,
    quantity: 12,
  });
  expect(totals(s.segments)).toEqual({
    work: 180,
    walking: 30,
    interruption: 30,
    total: 240,
    walkingEvents: 1,
    interruptionEvents: 1,
  });
  expect(rate(12, 180)).toBe(240);
  expect(rate(12, 240)).toBe(180);
  expect(s.status).toBe("completed");
});
test("stale revisions and backwards clocks are rejected", () => {
  expect(() =>
    applyCommand(session, {
      session_id: "s",
      request_id: "x",
      action: "finish",
      at: at(5),
      expected_revision: 0,
    }),
  ).toThrow();
  expect(() =>
    applyCommand(session, {
      session_id: "s",
      request_id: "x",
      action: "finish",
      at: at(-5),
      expected_revision: 1,
    }),
  ).toThrow();
});
test("quantity must be whole, nonnegative and bounded", () => {
  const s = applyCommand(session, {
    session_id: "s",
    request_id: "f",
    action: "finish",
    at: at(20),
    expected_revision: 1,
  });
  for (const quantity of [-1, 1.5, NaN, 1000000001])
    expect(() =>
      applyCommand(s, {
        session_id: "s",
        request_id: "q",
        action: "complete",
        at: at(22),
        expected_revision: 2,
        quantity,
      }),
    ).toThrow();
  expect(
    applyCommand(s, {
      session_id: "s",
      request_id: "q",
      action: "complete",
      at: at(22),
      expected_revision: 2,
      quantity: 0,
    }).quantity,
  ).toBe(0);
});
test("zero time never creates infinite production rates", () =>
  expect(rate(10, 0)).toBeNull());
test("activity position filtering excludes inactive and unrelated activities", () =>
  expect(
    relevantActivities(
      [
        { id: "a", name: "a", active: true },
        { id: "b", name: "b", active: true },
        { id: "c", name: "c", active: false },
      ],
      [
        { activity_id: "a", position_id: "x" },
        { activity_id: "c", position_id: "x" },
      ],
      "x",
    ).map((a) => a.id),
  ).toEqual(["a"]));
test("current assignments come before catalog browsing and exclude future, completed and other employee work", () => {
  const common = {
    employee_id: "e",
    product_id: "p",
    work_date: "2026-09-25",
    target_quantity: null,
    status: "assigned",
    notes: "",
  };
  expect(
    currentAssignments(
      [
        { ...common, id: "a" },
        { ...common, id: "b", status: "completed" },
        { ...common, id: "c", work_date: "2026-09-26" },
        { ...common, id: "d", employee_id: "other" },
      ],
      "e",
      "2026-09-25",
    ).map((a) => a.id),
  ).toEqual(["a"]);
});
test("design search is forgiving by name and SKU", () => {
  const ps: Product[] = [
    { id: "p", name: "Café Blossom", sku: "LC-023", active: true },
    { id: "z", name: "Hidden", sku: "LC-024", active: false },
  ];
  expect(searchProducts(ps, "CAFE").length).toBe(1);
  expect(searchProducts(ps, "lc023").length).toBe(1);
  expect(searchProducts(ps, "blossom 023").length).toBe(1);
  expect(searchProducts(ps, "hidden").length).toBe(0);
});
test("KPI specific target wins, activity falls back, missing target stays empty", () => {
  const targets = [
    {
      activity_id: "a",
      product_id: null,
      target_value: 18,
      active: true,
      effective_from: at(-100),
    },
    {
      activity_id: "a",
      product_id: "p",
      target_value: 22,
      active: true,
      effective_from: at(-50),
    },
    {
      activity_id: "a",
      product_id: "p",
      target_value: 30,
      active: true,
      effective_from: at(500),
    },
  ];
  expect(chooseKpi(targets, "a", "p", start)?.target_value).toBe(22);
  expect(chooseKpi(targets, "a", "q", start)?.target_value).toBe(18);
  expect(chooseKpi(targets, "z", "p", start)).toBeNull();
});
test("baseline excludes current period and uses weighted productive time", () => {
  const a = {
    ...session,
    status: "completed" as const,
    quantity: 10,
    segments: [{ ...session.segments[0], ended_at: at(3600) }],
  };
  const b = {
    ...a,
    id: "b",
    quantity: 20,
    segments: [{ ...session.segments[0], ended_at: at(7200) }],
  };
  expect(weightedBaseline([a, b], at(100), "a", "p")).toEqual({
    rate: 10,
    samples: 2,
  });
  expect(weightedBaseline([a, b], start, "a", "p").samples).toBe(0);
});
test("format handles zero and multi-day durations", () => {
  expect(clockText(0)).toBe("00:00:00");
  expect(clockText(90061)).toBe("25:01:01");
});

test("the specified 70-minute session has exactly 61 productive, 4 walking and 5 interrupted minutes", () => {
  let s = session;
  for (const [minute, kind] of [
    [20, "WALKING"],
    [24, "WORK"],
    [50, "INTERRUPTION"],
    [55, "WORK"],
  ] as const) {
    s = applyCommand(s, {
      request_id: crypto.randomUUID(),
      session_id: s.id,
      action: "transition",
      at: at(minute * 60),
      expected_revision: s.revision,
      kind,
    });
    expect(s.segments.filter((g) => !g.ended_at)).toHaveLength(1);
  }
  s = applyCommand(s, {
    request_id: crypto.randomUUID(),
    session_id: s.id,
    action: "finish",
    at: at(70 * 60),
    expected_revision: s.revision,
  });
  expect(totals(s.segments)).toMatchObject({
    work: 61 * 60,
    walking: 4 * 60,
    interruption: 5 * 60,
    total: 70 * 60,
  });
  expect(s.segments.filter((g) => !g.ended_at)).toHaveLength(0);
});
test("KPI effective dates are compared as instants across timezones", () => {
  const k = {
    activity_id: "a",
    product_id: null,
    target_value: 9,
    active: true,
    effective_from: "2026-09-25T08:00:00-04:00",
    valid_until: "2026-09-25T09:00:00-04:00",
  };
  expect(chooseKpi([k], "a", "p", "2026-09-25T12:30:00Z")?.target_value).toBe(
    9,
  );
  expect(chooseKpi([k], "a", "p", "2026-09-25T11:00:00Z")).toBeNull();
});
test("old assignments do not clutter today's list", () => {
  expect(
    currentAssignments(
      [
        {
          id: "x",
          employee_id: "e",
          product_id: "p",
          work_date: "2026-09-24",
          status: "in_progress",
          target_quantity: 40,
          notes: "",
        },
      ],
      "e",
      "2026-09-25",
    ),
  ).toEqual([]);
});


test("no-quantity finish keeps quantity inapplicable while legacy sessions still request it", () => {
  const finish = {session_id: "s", request_id: "f", action: "finish" as const, at: at(60), expected_revision: 1};
  const completed = applyCommand({...session, product_id: null, requires_design: false, requires_quantity: false}, finish);
  expect(completed.status).toBe("completed");
  expect(completed.quantity).toBeNull();
  expect(rate(completed.quantity,60)).toBeNull();
  expect(applyCommand(session,finish).status).toBe("awaiting_quantity");
  const measured = {...completed, requires_quantity: true, quantity: 0};
  expect(weightedBaseline([completed,measured],at(100),"a",null)).toEqual({rate:0,samples:1});
});

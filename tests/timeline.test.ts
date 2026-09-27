import { expect, test } from "vitest";
import {
  dailyTimeline,
  type TimelineReply,
} from "../lib/manufacturing/timeline";
import { reportingDayBounds } from "../lib/manufacturing/reporting-time";
import type { Session } from "../lib/manufacturing/types";
const at = (time: string) => `2026-09-26T${time}:00-05:00`;
function session(
  id: string,
  start: string,
  end: string | null,
  employee = "employee",
): Session {
  return {
    id,
    employee_id: employee,
    position_id: null,
    activity_id: id,
    activity_name: id,
    employee_name: employee,
    position_name: "",
    product_id: null,
    product_name: "",
    sku: "",
    assignment_id: null,
    started_at: start,
    ended_at: end,
    status: end ? "completed" : "running",
    quantity: null,
    revision: 1,
    segments: [
      { id, session_id: id, kind: "WORK", started_at: start, ended_at: end },
    ],
  };
}
function data(
  sessions: Session[],
  day = "2026-09-26",
  asOf = at("18:00"),
): TimelineReply {
  const bounds = reportingDayBounds(day);
  return {
    employee_id: "employee",
    day,
    timezone: "America/Chicago",
    day_start: bounds.start,
    day_end: bounds.end,
    as_of: asOf,
    sessions,
  };
}
test("known 2:00-2:45 and 3:00-3:30 sessions yield only one bounded 15-minute gap", () => {
  const t = dailyTimeline(
    data([
      session("a", at("14:00"), at("14:45")),
      session("b", at("15:00"), at("15:30")),
    ]),
  );
  expect(t.gapSeconds).toBe(900);
  expect(t.gaps).toHaveLength(1);
  expect(t.recordedSeconds).toBe(4500);
  expect(t.totals?.WORK).toBe(4500);
});
test("shared boundaries and walking/interruption do not create gaps", () => {
  const a = session("a", at("14:00"), at("15:00"));
  a.segments = [
    { ...a.segments[0], ended_at: at("14:25") },
    {
      ...a.segments[0],
      id: "walk",
      kind: "WALKING",
      started_at: at("14:25"),
      ended_at: at("14:30"),
    },
    {
      ...a.segments[0],
      id: "interrupt",
      kind: "INTERRUPTION",
      started_at: at("14:30"),
      ended_at: at("15:00"),
    },
  ];
  const t = dailyTimeline(data([a, session("b", at("15:00"), at("15:30"))]));
  expect(t.gaps).toEqual([]);
  expect(t.totals).toEqual({ WORK: 3300, WALKING: 300, INTERRUPTION: 1800 });
});
test("awaiting quantity ends at Finish, never at later quantity save", () => {
  const a = session("a", at("14:00"), at("14:45"));
  a.status = "awaiting_quantity";
  expect(
    dailyTimeline(data([a, session("b", at("15:00"), at("15:30"))])).gapSeconds,
  ).toBe(900);
  a.status = "completed";
  a.quantity = 24;
  a.updated_at = at("14:59");
  expect(
    dailyTimeline(data([a, session("b", at("15:00"), at("15:30"))])).gapSeconds,
  ).toBe(900);
});
test("employee chronology includes all activities and delayed work recomputes gaps", () => {
  const a = session("a", at("14:00"), at("14:45")),
    b = session("b", at("15:00"), at("15:30"));
  expect(
    dailyTimeline(
      data([a, b, session("other", at("14:45"), at("15:00"), "other")]),
    ).gapSeconds,
  ).toBe(900);
  const c = session("different activity", at("14:45"), at("15:00"));
  c.category_name = "Another category";
  expect(dailyTimeline(data([a, b, c])).gapSeconds).toBe(0);
});
test("overlaps are flagged and union coverage never double-counts or creates overlapping gaps", () => {
  const t = dailyTimeline(
    data([
      session("a", at("14:00"), at("15:00")),
      session("b", at("14:30"), at("15:30")),
      session("c", at("16:00"), at("16:30")),
    ]),
  );
  expect(t.issues.join()).toMatch(/Overlapping/);
  expect(t.recordedSeconds).toBe(7200);
  expect(t.gapSeconds).toBe(1800);
  expect(t.totals).toBeNull();
});
test("contradictory segments suppress unreliable totals and gaps", () => {
  const a = session("a", at("14:00"), at("15:00"));
  a.segments[0].ended_at = at("14:30");
  const t = dailyTimeline(data([a, session("b", at("16:00"), at("16:30"))]));
  expect(t.issues.length).toBeGreaterThan(0);
  expect(t.gapSeconds).toBeNull();
  expect(t.totals).toBeNull();
});
test("active work has no fabricated end, and no tail or arrival gap", () => {
  const active = session("active", at("15:00"), null);
  const t = dailyTimeline(data([active], "2026-09-26", at("15:22")));
  expect(t.rows[0].session.ended_at).toBeNull();
  expect(t.recordedSeconds).toBe(1320);
  expect(t.gaps).toEqual([]);
});
test("midnight-spanning sessions clip to the day and do not create overnight or edge gaps", () => {
  const t = dailyTimeline(
    data(
      [
        session("a", "2026-09-25T23:30:00-05:00", at("00:30")),
        session("b", at("23:30"), "2026-09-27T00:30:00-05:00"),
      ],
      "2026-09-26",
      "2026-09-28T12:00:00Z",
    ),
  );
  expect(t.rows.map((r) => r.seconds)).toEqual([1800, 1800]);
  expect(t.rows.every((r) => r.clipped)).toBe(true);
  expect(t.gaps).toHaveLength(1);
  const previous = session(
    "previous",
    "2026-09-25T22:00:00-05:00",
    "2026-09-25T23:00:00-05:00",
  );
  expect(
    dailyTimeline(data([previous, session("today", at("09:00"), at("10:00"))]))
      .gaps,
  ).toEqual([]);
});
test("DST day duration uses absolute instants and preserves historical labels", () => {
  const bounds = reportingDayBounds("2026-11-01");
  const s = session("a", bounds.start, bounds.end);
  s.category_name = "Recorded category";
  s.step_name = "Recorded step";
  const t = dailyTimeline(data([s], "2026-11-01", "2026-11-03T12:00:00Z"));
  expect(t.recordedSeconds).toBe(25 * 3600);
  expect(t.rows[0].session.category_name).toBe("Recorded category");
});

test("invalid timestamps stay visible as records needing review and suppress invented gaps", () => {
  const broken = session("broken", at("15:00"), at("14:00"));
  const t = dailyTimeline(
    data([broken, session("valid", at("16:00"), at("17:00"))]),
  );
  expect(t.rejected.map((s) => s.id)).toEqual(["broken"]);
  expect(t.gaps).toEqual([]);
  expect(t.recordedSeconds).toBeNull();
  expect(t.issues.join()).toMatch(/invalid start\/end/);
});
test("implausible device clock discrepancies and status/end contradictions are flagged", () => {
  const future = session("future", at("18:10"), at("18:20"));
  expect(dailyTimeline(data([future])).issues.join()).toMatch(
    /ahead of the refresh/,
  );
  const stopped = session("stopped", at("14:00"), at("15:00"));
  stopped.status = "running";
  expect(dailyTimeline(data([stopped])).issues.join()).toMatch(
    /status and end timestamp disagree/,
  );
});

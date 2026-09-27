import { expect, test } from "vitest";
import {
  reportingDate,
  reportingDayBounds,
  reportingClock,
  addReportingDays,
} from "../lib/manufacturing/reporting-time";
test("manufacturing date is Chicago rather than browser/Miami/UTC date", () => {
  expect(reportingDate("2026-09-27T04:30:00Z")).toBe("2026-09-26");
  expect(reportingDayBounds("2026-09-26")).toEqual({
    start: "2026-09-26T05:00:00.000Z",
    end: "2026-09-27T05:00:00.000Z",
  });
  expect(reportingClock("2026-09-26T19:10:00Z")).toBe("2:10 PM CDT");
});
test("reporting-day boundaries honor both DST transitions", () => {
  const spring = reportingDayBounds("2026-03-08"),
    fall = reportingDayBounds("2026-11-01");
  expect((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000).toBe(
    23,
  );
  expect((Date.parse(fall.end) - Date.parse(fall.start)) / 3600000).toBe(25);
  expect(reportingClock("2026-11-01T06:30:00Z")).toBe("1:30 AM CDT");
  expect(reportingClock("2026-11-01T07:30:00Z")).toBe("1:30 AM CST");
});
test("calendar arithmetic and invalid reporting dates", () => {
  expect(addReportingDays("2026-03-01", -1)).toBe("2026-02-28");
  for (const day of ["2026-02-30", "bad", ""])
    expect(() => reportingDayBounds(day)).toThrow();
});

test("Chicago wall-time input is independent of device timezone and rejects DST ambiguity", async () => {
  const { reportingDateTime, reportingInstant } =
    await import("../lib/manufacturing/reporting-time");
  expect(reportingDateTime("2026-09-26T19:10:00Z")).toBe("2026-09-26T14:10");
  expect(reportingInstant("2026-09-26T14:10")).toBe("2026-09-26T19:10:00.000Z");
  expect(() => reportingInstant("2026-03-08T02:30")).toThrow(/does not exist/);
  expect(() => reportingInstant("2026-11-01T01:30")).toThrow(/twice/);
  expect(() => reportingInstant("2026-02-31T14:10")).toThrow();
});

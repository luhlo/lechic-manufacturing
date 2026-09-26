import { expect, test } from "vitest";
import { pinExpired, studioDate } from "../lib/manufacturing/pin-policy";
test("OFF means no expiration, even with an old PIN and past saved date", () => {
  expect(pinExpired(false, "2020-01-01", "2019-01-01", Date.now())).toBe(false);
});
test("custom date ignores PIN age and includes the entire selected Miami day", () => {
  expect(
    pinExpired(
      true,
      "2026-09-26",
      "2020-01-01",
      Date.parse("2026-09-27T03:59:59.999Z"),
    ),
  ).toBe(false);
  expect(
    pinExpired(
      true,
      "2026-09-26",
      "2020-01-01",
      Date.parse("2026-09-27T04:00:00Z"),
    ),
  ).toBe(true);
});
test("Miami daylight saving boundaries use the correct calendar day", () => {
  expect(studioDate(Date.parse("2026-03-09T03:59:59Z"))).toBe("2026-03-08");
  expect(studioDate(Date.parse("2026-03-09T04:00:00Z"))).toBe("2026-03-09");
  expect(
    pinExpired(
      true,
      "2026-11-01",
      "2026-01-01",
      Date.parse("2026-11-02T04:59:59Z"),
    ),
  ).toBe(false);
  expect(
    pinExpired(
      true,
      "2026-11-01",
      "2026-01-01",
      Date.parse("2026-11-02T05:00:00Z"),
    ),
  ).toBe(true);
});
test("existing rolling policy remains based on the genuine PIN change timestamp", () => {
  const changed = "2026-01-01T12:00:00Z",
    boundary = Date.parse(changed) + 90 * 86400000;
  expect(pinExpired(true, null, changed, boundary - 1)).toBe(false);
  expect(pinExpired(true, null, changed, boundary)).toBe(true);
  expect(pinExpired(true, null, null, boundary)).toBe(false);
});

// Manufacturing dates are business dates. PIN expiry deliberately uses its separate policy timezone.
export const reportingTimeZone = "America/Chicago";
const parts = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: reportingTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce(
      (a, p) => ({ ...a, [p.type]: p.value }),
      {} as Record<string, string>,
    );
export function reportingDate(date: Date | string | number = new Date()) {
  const p = parts(new Date(date));
  return `${p.year}-${p.month}-${p.day}`;
}
export function addReportingDays(day: string, count: number) {
  const date = new Date(`${day}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    throw Error("Choose a valid reporting date.");
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function midnight(day: string) {
  addReportingDays(day, 0); // Validate before interpreting it as a wall-clock date.
  const wall = Date.parse(`${day}T00:00:00Z`);
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(instant));
    const shown = Date.parse(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    );
    instant += wall - shown;
  }
  return new Date(instant).toISOString();
}
export function reportingDayBounds(day: string) {
  return { start: midnight(day), end: midnight(addReportingDays(day, 1)) };
}
export function reportingClock(
  instant: string | number | Date,
  includeDate = false,
) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "Invalid timestamp";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: reportingTimeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(includeDate
      ? ({ year: "numeric", month: "short", day: "numeric" } as const)
      : {}),
  }).format(date);
}
export function reportingDateLabel(instant: string | number | Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: reportingTimeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(instant));
}
export function reportingDateTime(
  instant: Date | string | number = new Date(),
) {
  const p = parts(new Date(instant));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// datetime-local is a wall time, never a device-zone instant. Reject the repeated
// DST hour and nonexistent spring-forward hour instead of guessing an offset.
export function reportingInstant(wallTime: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wallTime))
    throw Error("Choose a valid America/Chicago date and time.");
  const wall = Date.parse(wallTime + ":00Z");
  if (!Number.isFinite(wall))
    throw Error("Choose a valid America/Chicago date and time.");
  const offsets = new Set<number>();
  for (const delta of [-36, 0, 36]) {
    const instant = wall + delta * 3600000;
    const p = parts(new Date(instant));
    offsets.add(
      Date.parse(
        `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
      ) - instant,
    );
  }
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => reportingDateTime(instant) === wallTime);
  if (candidates.length !== 1)
    throw Error(
      candidates.length
        ? "This time occurs twice during daylight saving. Choose a time outside the repeated hour."
        : "This America/Chicago time does not exist. Choose another time.",
    );
  return new Date(candidates[0]).toISOString();
}

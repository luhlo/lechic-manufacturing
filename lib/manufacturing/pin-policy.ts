export const pinTimeZone = "America/New_York";
export function studioDate(now: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: pinTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function pinExpired(
  enabled: boolean,
  date: string | null,
  changedAt: string | null,
  now: number,
): boolean {
  if (!enabled) return false;
  if (date) return studioDate(now) > date;
  return !!changedAt && Date.parse(changedAt) + 90 * 86400000 <= now;
}

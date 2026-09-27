import type { SegmentKind, Session } from "./types";
export interface TimelineReply {
  employee_id: string;
  day: string;
  timezone: string;
  day_start: string;
  day_end: string;
  as_of: string;
  sessions: Session[];
}
export interface TimelineSession {
  session: Session;
  start: number;
  end: number;
  seconds: number;
  clipped: boolean;
  segments: {
    kind: SegmentKind;
    start: number;
    end: number;
    seconds: number;
    open: boolean;
  }[];
}
export interface TimelineGap {
  start: number;
  end: number;
  seconds: number;
}
export function dailyTimeline(data: TimelineReply) {
  const dayStart = Date.parse(data.day_start),
    dayEnd = Date.parse(data.day_end),
    asOf = Date.parse(data.as_of);
  if (![dayStart, dayEnd, asOf].every(Number.isFinite) || dayEnd <= dayStart)
    throw Error("The timeline returned invalid reporting boundaries.");
  const issues: string[] = [],
    rows: TimelineSession[] = [],
    rejected: Session[] = [];
  let invalid = false;
  for (const s of data.sessions.filter(
    (s) => s.employee_id === data.employee_id,
  )) {
    const start = Date.parse(s.started_at),
      end = s.ended_at ? Date.parse(s.ended_at) : asOf;
    const problem = (text: string) => {
      issues.push(`${s.activity_name}: ${text}`);
      invalid = true;
    };
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      problem("invalid start/end timestamps.");
      rejected.push(s);
      continue;
    }
    if ((s.status === "running") !== (s.ended_at === null))
      problem("status and end timestamp disagree.");
    if (start > asOf + 60_000 || (s.ended_at && end > asOf + 60_000))
      problem(
        "recorded time is ahead of the refresh time; check the device clock.",
      );
    if (start >= dayEnd || (end <= dayStart && start < dayStart)) continue;
    const a = Math.max(start, dayStart),
      b = Math.min(end, dayEnd);
    const segments: TimelineSession["segments"] = [];
    let boundary = start,
      open = 0;
    for (const [index, g] of s.segments.entries()) {
      const gs = Date.parse(g.started_at),
        ge = g.ended_at ? Date.parse(g.ended_at) : asOf;
      if (
        !Number.isFinite(gs) ||
        !Number.isFinite(ge) ||
        ge < gs ||
        gs !== boundary ||
        (g.ended_at === null && index !== s.segments.length - 1)
      )
        problem("segment times are inconsistent or not contiguous.");
      if (!["WORK", "WALKING", "INTERRUPTION"].includes(g.kind))
        problem("a segment has an unknown state.");
      if (!g.ended_at) open++;
      boundary = ge;
      const clippedStart = Math.max(gs, dayStart),
        clippedEnd = Math.min(ge, dayEnd);
      if (
        Number.isFinite(clippedStart) &&
        Number.isFinite(clippedEnd) &&
        clippedEnd >= clippedStart &&
        ge >= dayStart &&
        gs < dayEnd
      )
        segments.push({
          kind: g.kind,
          start: clippedStart,
          end: clippedEnd,
          seconds: (clippedEnd - clippedStart) / 1000,
          open: g.ended_at === null,
        });
    }
    if (
      !s.segments.length ||
      boundary !== end ||
      open !== (s.status === "running" ? 1 : 0)
    )
      problem("session and segment boundaries disagree.");
    rows.push({
      session: s,
      start: a,
      end: b,
      seconds: (b - a) / 1000,
      clipped: a !== start || b !== end,
      segments,
    });
  }
  rows.sort(
    (a, b) => a.start - b.start || a.session.id.localeCompare(b.session.id),
  );
  const coverage: { start: number; end: number }[] = [];
  let overlapping = false;
  for (const row of rows) {
    const previous = coverage.at(-1);
    if (previous && row.start < previous.end && row.end > row.start) {
      issues.push(
        `Overlapping recorded sessions near ${row.session.activity_name}. Review the records; overlapping time is counted once in coverage.`,
      );
      overlapping = true;
    }
    if (previous && row.start <= previous.end)
      previous.end = Math.max(previous.end, row.end);
    else coverage.push({ start: row.start, end: row.end });
  }
  const gaps: TimelineGap[] = [];
  if (!invalid)
    for (let i = 1; i < coverage.length; i++)
      gaps.push({
        start: coverage[i - 1].end,
        end: coverage[i].start,
        seconds: (coverage[i].start - coverage[i - 1].end) / 1000,
      });
  const totals =
    !invalid && !overlapping
      ? rows
          .flatMap((r) => r.segments)
          .reduce((a, g) => ({ ...a, [g.kind]: a[g.kind] + g.seconds }), {
            WORK: 0,
            WALKING: 0,
            INTERRUPTION: 0,
          })
      : null;
  return {
    rows,
    rejected,
    gaps,
    issues: [...new Set(issues)],
    totals,
    recordedSeconds: invalid
      ? null
      : coverage.reduce((n, r) => n + (r.end - r.start) / 1000, 0),
    gapSeconds: invalid ? null : gaps.reduce((n, g) => n + g.seconds, 0),
    breakdownAvailable: !invalid && !overlapping,
  };
}

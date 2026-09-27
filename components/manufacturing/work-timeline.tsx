"use client";
import { useEffect, useState } from "react";
import { type Api, message } from "@/lib/manufacturing/api";
import type { CachedState } from "@/lib/manufacturing/types";
import { clockText } from "@/lib/manufacturing/domain";
import {
  reportingClock,
  reportingDate,
  reportingTimeZone,
} from "@/lib/manufacturing/reporting-time";
import {
  dailyTimeline,
  type TimelineReply,
} from "@/lib/manufacturing/timeline";
import { recordedContext } from "@/lib/manufacturing/workflow";
import { DataTable, Metric, Pick } from "./primitives";
const length = (seconds: number | null | undefined) =>
  seconds == null ? "Review records" : clockText(seconds);
const stateName = (kind: string) =>
  kind === "WORK" ? "Working" : kind === "WALKING" ? "Walking" : "Interruption";
export function WorkTimeline({ api, state }: { api: Api; state: CachedState }) {
  const [employee, setEmployee] = useState(""),
    [day, setDay] = useState(reportingDate()),
    [revision, setRevision] = useState(0);
  const [loadedData, setData] = useState<TimelineReply | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [group, setGroup] = useState("category");
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(async () => {
      if (!live) return;
      setData(null);
      setError("");
      if (!employee || !day) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const reply = await api.rpc<TimelineReply>("work_timeline", {
          p_employee: employee,
          p_day: day,
        });
        dailyTimeline(reply); // Reject malformed data before rendering it as a report.
        if (live) setData(reply);
      } catch (e) {
        if (live) setError(message(e));
      } finally {
        if (live) setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [api, employee, day, revision, state.lastSync]);
  const data =
    loadedData?.employee_id === employee && loadedData.day === day
      ? loadedData
      : null;
  const timeline = data ? dailyTimeline(data) : null;
  const entries = timeline
    ? [
        ...timeline.rows.map((row) => ({
          kind: "session" as const,
          start: row.start,
          row,
        })),
        ...timeline.gaps.map((gap) => ({
          kind: "gap" as const,
          start: gap.start,
          gap,
        })),
      ].sort((a, b) => a.start - b.start || (a.kind === "gap" ? -1 : 1))
    : [];
  const groups = new Map<
    string,
    {
      label: string;
      work: number;
      walking: number;
      interruption: number;
      seconds: number;
    }
  >();
  if (timeline?.breakdownAvailable)
    for (const row of timeline.rows) {
      const s = row.session;
      // Both identity and recorded labels retain the meaning of renamed/moved configuration.
      const labels = [
        s.category_name || "Legacy / uncategorized",
        ...(group !== "category" ? [s.activity_name] : []),
        ...(group === "step" ? [s.step_name || "General activity"] : []),
      ];
      const key = JSON.stringify([
        s.category_id,
        group !== "category" ? s.activity_id : null,
        group === "step" ? s.step_id : null,
        labels,
      ]);
      const entry = groups.get(key) ?? {
        label: labels.join(" · "),
        work: 0,
        walking: 0,
        interruption: 0,
        seconds: 0,
      };
      for (const segment of row.segments)
        entry[
          segment.kind === "WORK"
            ? "work"
            : segment.kind === "WALKING"
              ? "walking"
              : "interruption"
        ] += segment.seconds;
      entry.seconds += row.seconds;
      groups.set(key, entry);
    }
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MANUFACTURING / ANALYTICS</p>
          <h1>Work timeline</h1>
          <p className="muted">{reportingTimeZone} · San Antonio</p>
        </div>
      </div>
      <div className="timeline-filters">
        <Pick
          label="Employee"
          value={employee}
          onChange={setEmployee}
          options={state.catalog.profiles.map((p) => ({
            value: p.id,
            label: p.name,
          }))}
          empty="Choose an employee"
        />
        <label className="field">
          Date
          <input
            aria-label="Timeline date"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <button
          className="button secondary"
          disabled={loading || !employee || !day}
          onClick={() => setRevision((v) => v + 1)}
        >
          Refresh timeline
        </button>
      </div>
      <p className="muted timeline-disclosure">
        Based on synced records
        {data ? ` · As of ${reportingClock(data.as_of, true)}` : ""}. Another
        phone’s unsynced work may change this timeline after it reconnects.
        Refresh to recompute.
      </p>
      {!!state.queue.length && (
        <p className="notice">
          This device has pending work. Sync it before treating these records as
          complete.
        </p>
      )}
      {!employee && (
        <p className="empty">Choose an employee to view their recorded day.</p>
      )}
      {loading && <p role="status">Loading recorded work…</p>}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {timeline && (
        <>
          {!!timeline.issues.length && (
            <div role="alert" className="notice error">
              <strong>Records need review.</strong>
              <ul>
                {timeline.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <p>
                State totals and breakdowns are withheld when timestamps
                conflict. Invalid boundaries also withhold gaps.
              </p>
            </div>
          )}
          {timeline.rejected.map((s) => (
            <div key={s.id} className="notice error">
              <strong>{recordedContext(s)}</strong>
              <p>Unable to place this session in chronological order.</p>
              <p>
                Recorded start: {s.started_at}
                <br />
                Recorded end: {s.ended_at || "None"}
                <br />
                Status: {s.status}
              </p>
            </div>
          ))}
          <div className="timeline-metrics">
            <Metric
              label="Recorded work"
              value={length(timeline.totals?.WORK)}
            />
            <Metric
              label="Recorded walking"
              value={length(timeline.totals?.WALKING)}
            />
            <Metric
              label="Recorded interruption"
              value={length(timeline.totals?.INTERRUPTION)}
            />
            <Metric
              label="Total recorded session time"
              value={length(timeline.recordedSeconds)}
              note={
                timeline.issues.length
                  ? "Overlapping coverage counted once, where valid"
                  : "Work + walking + interruption"
              }
            />
            <Metric
              label="Unrecorded time"
              value={length(timeline.gapSeconds)}
              note="Bounded gaps between recorded sessions"
            />
          </div>
          <div
            className="timeline-list"
            aria-label="Chronological recorded work"
          >
            {entries.map((entry) =>
              entry.kind === "gap" ? (
                <div className="timeline-gap" key={`gap-${entry.start}`}>
                  <strong>Unrecorded time</strong>
                  <span>
                    {reportingClock(entry.gap.start, true)} →{" "}
                    {reportingClock(entry.gap.end, true)}
                  </span>
                  <b>{length(entry.gap.seconds)}</b>
                </div>
              ) : (
                <details
                  className="timeline-session"
                  key={entry.row.session.id}
                >
                  <summary>
                    <div>
                      <strong>{recordedContext(entry.row.session)}</strong>
                      {entry.row.session.product_name && (
                        <span>
                          {entry.row.session.product_name} ·{" "}
                          {entry.row.session.sku}
                        </span>
                      )}
                      <span>
                        {reportingClock(entry.row.start, true)} →{" "}
                        {entry.row.session.ended_at
                          ? reportingClock(entry.row.end, true)
                          : `In progress · as of ${reportingClock(data!.as_of, true)}`}
                      </span>
                    </div>
                    <div>
                      <strong>{length(entry.row.seconds)}</strong>
                      <span>
                        {entry.row.session.status.replaceAll("_", " ")}
                      </span>
                      <small>View segments</small>
                    </div>
                  </summary>
                  <div className="timeline-detail">
                    <p>
                      Started:{" "}
                      {reportingClock(entry.row.session.started_at, true)}
                      <br />
                      Ended:{" "}
                      {entry.row.session.ended_at
                        ? reportingClock(entry.row.session.ended_at, true)
                        : "In progress"}
                    </p>
                    {entry.row.clipped && (
                      <p className="notice">
                        This session crosses a reporting-day boundary. The
                        timeline and duration include only its overlap with{" "}
                        {day}.
                      </p>
                    )}
                    <ul className="timeline-segments">
                      {entry.row.segments.map((segment, i) => (
                        <li key={i}>
                          <strong>{stateName(segment.kind)}</strong>
                          <span>
                            {reportingClock(segment.start, true)} →{" "}
                            {segment.open
                              ? `In progress (shown through ${reportingClock(segment.end, true)})`
                              : reportingClock(segment.end, true)}
                          </span>
                          <b>{length(segment.seconds)}</b>
                        </li>
                      ))}
                    </ul>
                    <p>
                      Recorded units processed:{" "}
                      <strong>
                        {entry.row.session.quantity ??
                          (entry.row.session.requires_quantity === false
                            ? "Not applicable"
                            : "Not entered")}
                      </strong>
                      {entry.row.clipped && entry.row.session.quantity !== null
                        ? " (whole session; not allocated across days)"
                        : ""}
                    </p>
                  </div>
                </details>
              ),
            )}
            {!entries.length && (
              <p className="empty">
                No recorded sessions overlap this day. Shift status is unknown.
              </p>
            )}
          </div>
          {timeline.breakdownAvailable && entries.length > 0 && (
            <div className="panel timeline-breakdown">
              <h2>Recorded time breakdown</h2>
              <Pick
                label="Group time by"
                value={group}
                onChange={setGroup}
                options={[
                  { value: "category", label: "Category" },
                  { value: "activity", label: "Activity" },
                  { value: "step", label: "Step" },
                ]}
              />
              <DataTable
                headers={[
                  "Recorded context",
                  "Work",
                  "Walking",
                  "Interruption",
                  "Recorded total",
                ]}
                rows={[...groups.values()].map((g) => [
                  g.label,
                  length(g.work),
                  length(g.walking),
                  length(g.interruption),
                  length(g.seconds),
                ])}
              />
            </div>
          )}
        </>
      )}
      <p className="analytics-note">
        The full employee chronology stays visible. Unrecorded time says nothing
        about its cause, attendance or pay. There are no assumed gaps before the
        first session or after the last, and no scheduled shift or lunch
        assumptions. Gaps are separate from production rates. Quantities may
        refer to the same pieces processed at different stages.
      </p>
    </section>
  );
}

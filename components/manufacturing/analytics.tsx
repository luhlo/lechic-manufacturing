"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ArrowRight, Clock, Footprints } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { message, type Api } from "@/lib/manufacturing/api";
import type { CachedState, Session } from "@/lib/manufacturing/types";
import {
  clockText,
  localDate,
  normalize,
  productionMetrics,
  rate,
  totals,
} from "@/lib/manufacturing/domain";
import {
  reportingClock,
  reportingDayBounds,
  addReportingDays,
  reportingDateLabel,
} from "@/lib/manufacturing/reporting-time";
import { recordedContext } from "@/lib/manufacturing/workflow";
import { WorkTimeline } from "./work-timeline";
import { DataTable, Metric, Pick } from "./primitives";
const num = (v: number | null) =>
  v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
const duration = (v: number) => `${num(v / 60)} min`;
type AnalyticsProps = {
  api: Api;
  state: CachedState;
  dashboard: boolean;
  onNavigate: (v: string) => void;
};
export function Analytics(props: AnalyticsProps) {
  const [view, setView] = useState("production");
  return (
    <>
      {!props.dashboard && (
        <div className="analytics-view-switch">
          <Tabs value={view} onValueChange={setView}>
            <TabsList>
              <TabsTrigger value="production">Production</TabsTrigger>
              <TabsTrigger value="timeline">Work timeline</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}
      {!props.dashboard && view === "timeline" ? (
        <WorkTimeline api={props.api} state={props.state} />
      ) : (
        <ProductionAnalytics {...props} />
      )}
    </>
  );
}
function ProductionAnalytics({
  api,
  state,
  dashboard,
  onNavigate,
}: {
  api: Api;
  state: CachedState;
  dashboard: boolean;
  onNavigate: (v: string) => void;
}) {
  const [from, setFrom] = useState(() => {
      return addReportingDays(localDate(), dashboard ? 0 : -6);
    }),
    [to, setTo] = useState(localDate()),
    [employee, setEmployee] = useState(""),
    [position, setPosition] = useState(""),
    [activity, setActivity] = useState(""),
    [product, setProduct] = useState(""),
    [sku, setSku] = useState(""),
    [group, setGroup] = useState("employee"),
    [detail, setDetail] = useState<Session | null>(null),
    [targets, setTargets] = useState<Record<string, number | null>>({});
  const [sessions, setSessions] = useState<Session[]>([]);
  const [baselines, setBaselines] = useState<
    Record<string, { rate: number | null; samples: number }>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const c = state.catalog;
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      setError("");
      setLoading(true);
      setSessions([]);
      setBaselines({});
      setTargets({});
      try {
        if (!from || !to || from > to)
          throw Error("Choose a valid start and end date.");
        const end = reportingDayBounds(to).end;
        const before = reportingDayBounds(from).start;
        const filter = {
          from: before,
          to: end,
          employee,
          position,
          activity,
          product,
          sku,
        };
        const [completed, active] = await Promise.all([
          api.sessions(filter),
          dashboard
            ? api.sessions({ ...filter, active: true })
            : Promise.resolve([]),
        ]);
        const entries: Record<string, number | null> = {};
        const baselineEntries: Record<
          string,
          { rate: number | null; samples: number }
        > = {};
        const pairs = [
          ...new Map(
            completed
              .filter((s) => s.quantity !== null)
              .map((s) => [
                s.activity_id +
                  ":" +
                  s.product_id +
                  ":" +
                  (s.step_id ?? "general"),
                {
                  activity_id: s.activity_id,
                  product_id: s.product_id,
                  step_id: s.step_id ?? null,
                },
              ]),
          ).values(),
        ];
        for (let i = 0; i < completed.length; i += 500) {
          const rows = await api.rpc<
            { session_id: string; target_value: number | null }[]
          >("analytics_targets", {
            p_ids: completed.slice(i, i + 500).map((s) => s.id),
          });
          rows.forEach((r) => (entries[r.session_id] = r.target_value));
        }
        for (let i = 0; i < pairs.length; i += 500) {
          const rows = await api.rpc<
            {
              activity_id: string;
              product_id: string | null;
              step_id: string | null;
              rate: number | null;
              samples: number;
            }[]
          >("analytics_baselines", {
            p_before: before,
            p_pairs: pairs.slice(i, i + 500),
          });
          rows.forEach(
            (r) =>
              (baselineEntries[
                r.activity_id +
                  ":" +
                  r.product_id +
                  ":" +
                  (r.step_id ?? "general")
              ] = r),
          );
        }
        if (live) {
          setSessions([...completed, ...active]);
          setTargets(entries);
          setBaselines(baselineEntries);
        }
      } catch (e) {
        if (live) setError(message(e));
      } finally {
        if (live) setLoading(false);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    api,
    from,
    to,
    employee,
    position,
    activity,
    product,
    sku,
    dashboard,
    state.lastSync,
  ]);
  const filtered = useMemo(
    () =>
      sessions.filter(
        (s) =>
          s.status === "completed" &&
          localDate(new Date(s.started_at)) >= from &&
          localDate(new Date(s.started_at)) <= (to || "9999-12-31") &&
          (!employee || s.employee_id === employee) &&
          (!position || s.position_id === position) &&
          (!activity || s.activity_id === activity) &&
          (!product || s.product_id === product) &&
          normalize(s.sku).includes(normalize(sku)),
      ),
    [sessions, from, to, employee, position, activity, product, sku],
  );
  const sum = productionMetrics(filtered);
  const groups = new Map<string, { label: string; sessions: Session[] }>();
  for (const s of filtered) {
    const label =
      group === "employee"
        ? s.employee_name
        : group === "position"
          ? s.position_name
          : group === "category"
            ? s.category_name || "Legacy / uncategorized"
            : group === "activity"
              ? [
                  s.category_name || "Legacy / uncategorized",
                  s.activity_name,
                ].join(" · ")
              : group === "step"
                ? recordedContext(s) +
                  (s.step_name ? "" : " · General activity")
                : s.product_name || "No design";
    const identity =
      group === "employee"
        ? s.employee_id
        : group === "position"
          ? s.position_id
          : group === "category"
            ? s.category_id
            : group === "activity"
              ? [s.category_id, s.activity_id]
              : group === "step"
                ? [s.category_id, s.activity_id, s.step_id]
                : s.product_id;
    const key = JSON.stringify([identity, label]);
    const entry = groups.get(key) ?? { label, sessions: [] };
    entry.sessions.push(s);
    groups.set(key, entry);
  }
  const grouped = [...groups.values()].map((g) => ({
    label: g.label,
    ...productionMetrics(g.sessions),
  }));
  const active = sessions.filter((s) => s.status !== "completed");
  const options = (rows: { id: string; name?: string }[]) =>
    rows.map((r) => ({ value: r.id, label: r.name ?? r.id }));
  const segmented = (
    <div
      className="time-bar"
      role="img"
      aria-label={`Work ${duration(sum.work)}, walking ${duration(sum.walking)}, interruption ${duration(sum.interruption)}`}
    >
      <i
        className="work-bar"
        style={{ width: `${sum.total ? (100 * sum.work) / sum.total : 0}%` }}
      />
      <i
        className="walk-bar"
        style={{ width: `${sum.total ? (100 * sum.walking) / sum.total : 0}%` }}
      />
      <i
        className="interrupt-bar"
        style={{
          width: `${sum.total ? (100 * sum.interruption) / sum.total : 0}%`,
        }}
      />
    </div>
  );
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LE CHIC MIAMI / MANUFACTURING</p>
          <h1>
            {dashboard ? "The studio, at a glance." : "Manufacturing analytics"}
          </h1>
          <p className="muted">
            {dashboard
              ? reportingDateLabel(new Date())
              : "Understand productive time, movement, and interruptions."}
          </p>
        </div>
        {dashboard ? (
          <button
            className="button secondary"
            onClick={() => onNavigate("analytics")}
          >
            Explore analytics <ArrowUpRight size={18} />
          </button>
        ) : (
          <span className="status-pill">
            {filtered.length} completed sessions
          </span>
        )}
      </div>
      <div className="analytics-filters">
        <label className="field">
          From
          <input
            aria-label="From date"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="field">
          Through
          <input
            aria-label="Through date"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {!dashboard && (
          <>
            <Pick
              label="Employee"
              value={employee}
              onChange={setEmployee}
              options={options(c.profiles)}
              empty="All employees"
            />
            <Pick
              label="Position"
              value={position}
              onChange={setPosition}
              options={options(c.positions)}
              empty="All positions"
            />
            <Pick
              label="Activity"
              value={activity}
              onChange={setActivity}
              options={options(c.activities)}
              empty="All activities"
            />
            <Pick
              label="Design"
              value={product}
              onChange={setProduct}
              options={options(c.products)}
              empty="All designs"
            />
            <label className="field">
              SKU
              <input
                placeholder="Filter by SKU"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      {from > to && (
        <p className="notice error">
          The start date must be before the end date.
        </p>
      )}
      {loading && <p role="status">Loading manufacturing records…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="metrics-row primary-metrics">
        <Metric
          label="Recorded units processed"
          value={num(sum.quantity)}
          note={`${filtered.length} completed sessions`}
        />
        <Metric
          label="Recorded work"
          value={duration(sum.work)}
          note={`${sum.total ? num((sum.work / sum.total) * 100) : "0"}% of elapsed time`}
        />
        <Metric
          label="Units / recorded work hour"
          value={num(rate(sum.quantity, sum.rateWork))}
          note="Working time from quantity-based sessions"
        />
        <Metric
          label="Units / recorded session hour"
          value={num(rate(sum.quantity, sum.rateTotal))}
          note="Quantity-based sessions, including pauses"
        />
      </div>
      <div className="overview-grid">
        <div className="panel time-panel">
          <div className="panel-heading">
            <h2>Where time goes</h2>
            <Clock size={20} />
          </div>
          <div className="total-time">
            <strong>{clockText(sum.total)}</strong>
            <span>TOTAL ELAPSED</span>
          </div>
          {segmented}
          <div className="time-legend">
            <div>
              <i className="work-bar" />
              <span>Productive work</span>
              <strong>{duration(sum.work)}</strong>
            </div>
            <div>
              <i className="walk-bar" />
              <span>Walking</span>
              <strong>{duration(sum.walking)}</strong>
            </div>
            <div>
              <i className="interrupt-bar" />
              <span>Interruption</span>
              <strong>{duration(sum.interruption)}</strong>
            </div>
          </div>
        </div>
        <div className="panel walking-panel">
          <div className="panel-heading">
            <h2>Movement & interruptions</h2>
            <Footprints size={20} />
          </div>
          <div className="mini-metrics">
            <Metric label="Walking events" value={sum.events} />
            <Metric
              label="Average walk"
              value={duration(sum.events ? sum.walking / sum.events : 0)}
            />
            <Metric
              label="Time walking"
              value={`${num(sum.total ? (sum.walking / sum.total) * 100 : 0)}%`}
            />
            <Metric label="Interruptions" value={sum.interruptions} />
          </div>
          <p className="process-note">
            Lower overall throughput can reveal a layout or process problem.
            Compare it with productive performance.
          </p>
        </div>
      </div>
      {dashboard && (
        <div className="panel active-panel">
          <div className="panel-heading">
            <h2>
              On the floor <span className="count">{active.length}</span>
            </h2>
            <span className="muted tiny">Updates every 30 seconds</span>
          </div>
          <div className="active-grid">
            {active.map((s) => {
              const kind =
                s.segments.find((g) => !g.ended_at)?.kind ?? "QUANTITY";
              return (
                <button
                  key={s.id}
                  className="active-card"
                  onClick={() => setDetail(s)}
                >
                  <span className="avatar">{s.employee_name.slice(0, 1)}</span>
                  <div>
                    <strong>{s.employee_name}</strong>
                    <p>
                      {[s.activity_name, s.product_name]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <small>{s.sku}</small>
                  </div>
                  <span className={"state-chip " + kind.toLowerCase()}>
                    {kind === "WORK"
                      ? "Working"
                      : kind === "WALKING"
                        ? "Walking"
                        : kind === "INTERRUPTION"
                          ? "Interruption"
                          : "Entering quantity"}
                  </span>
                </button>
              );
            })}
            {!active.length && (
              <div className="empty">No active sessions right now.</div>
            )}
          </div>
        </div>
      )}
      <div className="panel breakdown-panel">
        <div className="panel-heading">
          <h2>Production breakdown</h2>
          <span className="muted tiny">Weighted rates</span>
        </div>
        <Tabs value={group} onValueChange={setGroup}>
          <TabsList className="breakdown-tabs">
            {[
              "employee",
              "position",
              "category",
              "activity",
              "step",
              "product",
            ].map((v) => (
              <TabsTrigger key={v} value={v}>
                By {v === "product" ? "design" : v}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <DataTable
          headers={[
            "Name",
            "Units",
            "Productive",
            "Walking",
            "Interruptions",
            "Walk events",
            "Avg walk",
            "Walking %",
            "Units / work hr",
            "Units / session hr",
          ]}
          rows={grouped.map((g) => [
            <strong key="name">{g.label}</strong>,
            g.quantity ?? "Not applicable",
            duration(g.work),
            duration(g.walking),
            duration(g.interruption),
            g.events,
            duration(g.events ? g.walking / g.events : 0),
            `${num(g.total ? (g.walking / g.total) * 100 : 0)}%`,
            num(rate(g.quantity, g.rateWork)),
            num(rate(g.quantity, g.rateTotal)),
          ])}
        />
      </div>
      {!dashboard && (
        <div className="panel">
          <div className="panel-heading">
            <h2>Session comparisons</h2>
          </div>
          <p className="muted comparison-note">
            Baseline uses earlier completed sessions for the same activity and
            design and step, before {from}. Target is the KPI captured when the
            session started. Step work is not compared with whole-activity
            targets. All three rates use recorded work hours.
          </p>
          <DataTable
            headers={[
              "Employee / design",
              "Activity",
              "Units",
              "Baseline",
              "Target at start",
              "Actual",
              "",
            ]}
            rows={filtered.map((s) => {
              const t = totals(s.segments);
              const baseline = baselines[
                s.activity_id +
                  ":" +
                  s.product_id +
                  ":" +
                  (s.step_id ?? "general")
              ] ?? { rate: null, samples: 0 };
              return [
                <div key="name">
                  <strong>{s.employee_name}</strong>
                  <small className="table-small">
                    {[s.product_name, s.sku].filter(Boolean).join(" · ") ||
                      "No design"}
                  </small>
                </div>,
                recordedContext(s),
                s.quantity ?? "Not applicable",
                num(s.quantity === null ? null : baseline.rate),
                num(
                  s.quantity === null || s.step_id
                    ? null
                    : (targets[s.id] ?? null),
                ),
                num(rate(s.quantity, t.work)),
                <button
                  key="action"
                  className="edit-button"
                  onClick={() => setDetail(s)}
                >
                  Details <ArrowRight size={15} />
                </button>,
              ];
            })}
          />
        </div>
      )}
      <p className="analytics-note">
        Completed sessions are included by their start date in America/Chicago.
        Entire sessions are counted, including sessions that cross midnight.
        Active sessions are excluded from these totals. Time without quantity is
        included in time totals and excluded from production rates. Gaps are
        never included in rate denominators. Recorded units processed may
        represent the same pieces across different activities or steps; they are
        not unique finished products.
      </p>
      <Dialog
        open={!!detail}
        onOpenChange={(v) => {
          if (!v) setDetail(null);
        }}
      >
        <DialogContent className="session-dialog">
          <DialogHeader>
            <DialogTitle>{detail?.employee_name}</DialogTitle>
            <DialogDescription>
              {[
                detail ? recordedContext(detail) : "",
                detail?.product_name,
                detail?.sku,
              ]
                .filter(Boolean)
                .join(" · ")}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <p>
                Started: {reportingClock(detail.started_at, true)}
                <br />
                Ended:{" "}
                {detail.ended_at
                  ? reportingClock(detail.ended_at, true)
                  : "In progress"}
                <br />
                Elapsed: {clockText(totals(detail.segments).total)} ·{" "}
                {detail.status.replace("_", " ")}
              </p>
              <DataTable
                headers={["State", "Start", "End", "Duration"]}
                rows={detail.segments.map((g) => [
                  g.kind,
                  reportingClock(g.started_at, true),
                  g.ended_at ? reportingClock(g.ended_at, true) : "Active",
                  clockText(totals([g]).total),
                ])}
              />
              <p>
                Recorded units processed:{" "}
                <strong>
                  {detail.quantity ??
                    (detail.status === "completed"
                      ? "Not applicable"
                      : "Not entered")}
                </strong>
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

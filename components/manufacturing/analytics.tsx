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
import { DataTable, Metric, Pick } from "./primitives";
const num = (v: number | null) =>
  v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
const duration = (v: number) => `${num(v / 60)} min`;
export function Analytics({
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
      const d = new Date();
      if (!dashboard) d.setDate(d.getDate() - 6);
      return localDate(d);
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
        const end = new Date(`${to}T00:00:00`);
        end.setDate(end.getDate() + 1);
        const before = new Date(`${from}T00:00:00`).toISOString();
        const filter = {
          from: before,
          to: end.toISOString(),
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
                s.activity_id + ":" + s.product_id,
                { activity_id: s.activity_id, product_id: s.product_id },
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
              rate: number | null;
              samples: number;
            }[]
          >("analytics_baselines", {
            p_before: before,
            p_pairs: pairs.slice(i, i + 500),
          });
          rows.forEach(
            (r) => (baselineEntries[r.activity_id + ":" + r.product_id] = r),
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
    const key =
      group === "employee"
        ? s.employee_id
        : group === "position"
          ? (s.position_id ?? "none")
          : group === "activity"
            ? s.activity_id
            : (s.product_id ?? "none");
    const label =
      group === "employee"
        ? s.employee_name
        : group === "position"
          ? s.position_name
          : group === "activity"
            ? s.activity_name
            : s.product_name || "No design";
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
              ? new Date().toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
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
          label="Units completed"
          value={num(sum.quantity)}
          note={`${filtered.length} completed sessions`}
        />
        <Metric
          label="Productive work"
          value={duration(sum.work)}
          note={`${sum.total ? num((sum.work / sum.total) * 100) : "0"}% of elapsed time`}
        />
        <Metric
          label="Units / productive hour"
          value={num(rate(sum.quantity, sum.rateWork))}
          note="Working time from quantity-based sessions"
        />
        <Metric
          label="Units / elapsed hour"
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
            {["employee", "position", "activity", "product"].map((v) => (
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
            "Units / productive hr",
            "Units / elapsed hr",
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
            design, before {from}. Target is the KPI captured when the session
            started. All three rates use productive hours.
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
                s.activity_id + ":" + s.product_id
              ] ?? { rate: null, samples: 0 };
              return [
                <div key="name">
                  <strong>{s.employee_name}</strong>
                  <small className="table-small">
                    {[s.product_name, s.sku].filter(Boolean).join(" · ") ||
                      "No design"}
                  </small>
                </div>,
                s.activity_name,
                s.quantity ?? "Not applicable",
                num(s.quantity === null ? null : baseline.rate),
                num(s.quantity === null ? null : (targets[s.id] ?? null)),
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
        Completed sessions are included by their start date in your device’s
        local timezone. Entire sessions are counted, including sessions that
        cross midnight. Active sessions are excluded from these totals. Time
        without quantity is included in time totals and excluded from production
        rates.
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
              {[detail?.activity_name, detail?.product_name, detail?.sku]
                .filter(Boolean)
                .join(" · ")}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <p>
                {new Date(detail.started_at).toLocaleString()} ·{" "}
                {detail.status.replace("_", " ")}
              </p>
              <DataTable
                headers={["State", "Start", "End", "Duration"]}
                rows={detail.segments.map((g) => [
                  g.kind,
                  new Date(g.started_at).toLocaleTimeString(),
                  g.ended_at
                    ? new Date(g.ended_at).toLocaleTimeString()
                    : "Active",
                  clockText(totals([g]).total),
                ])}
              />
              <p>
                Quantity:{" "}
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

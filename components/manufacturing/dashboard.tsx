import { useEffect, useState } from "react";
import { type Api, message } from "@/lib/manufacturing/api";
import { localDate } from "@/lib/manufacturing/domain";
import { DataTable } from "./primitives";
interface Summary {
  completed: number;
  quantity: number;
  work_seconds: number;
  walking_seconds: number;
  interruption_seconds: number;
  active: {
    id: string;
    employee_name: string;
    activity_name: string;
    product_name: string;
    status: string;
  }[];
}
export function Dashboard({ api, lastSync }: { api: Api; lastSync: string }) {
  const [day, setDay] = useState(localDate()),
    [summary, setSummary] = useState<Summary | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(async () => {
      if (!live) return;
      setError("");
      setSummary(null);
      try {
        const from = new Date(day + "T00:00:00"),
          to = new Date(from);
        to.setDate(to.getDate() + 1);
        const data = await api.rpc<Summary>("dashboard_summary", {
          p_from: from.toISOString(),
          p_to: to.toISOString(),
        });
        if (live) setSummary(data);
      } catch (e) {
        if (live) setError(message(e));
      }
    });
    return () => {
      live = false;
    };
  }, [api, day, lastSync]);
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">STUDIO OVERVIEW</p>
          <h1>Dashboard</h1>
        </div>
        <label className="field">
          Day
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {summary && (
        <>
          <div className="settings-card">
            <h2>Daily production</h2>
            <div className="dashboard-totals">
              {[
                ["Units", summary.quantity],
                ["Completed sessions", summary.completed],
                ["Productive minutes", summary.work_seconds / 60],
                ["Walking minutes", summary.walking_seconds / 60],
                ["Interruption minutes", summary.interruption_seconds / 60],
              ].map(([label, value]) => (
                <div key={label}>
                  <span className="muted">{label}</span>
                  <strong>
                    {Number(value).toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })}
                  </strong>
                </div>
              ))}
            </div>
          </div>
          <h2>Active now</h2>
          <DataTable
            headers={["Employee", "Activity", "Design", "Status"]}
            rows={summary.active.map((s) => [
              s.employee_name,
              s.activity_name,
              s.product_name,
              s.status === "awaiting_quantity"
                ? "Awaiting quantity"
                : "Running",
            ])}
          />
        </>
      )}
    </section>
  );
}

"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Footprints,
  Pause,
  Play,
  Search,
  Square,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import type { CachedState, Product } from "@/lib/manufacturing/types";
import { SessionStore } from "@/lib/manufacturing/api";
import {
  clockText,
  currentAssignments,
  localDate,
  rate,
  relevantActivities,
  searchProducts,
  totals,
} from "@/lib/manufacturing/domain";
export function Employee({
  state,
  store,
  busy,
  run,
  online,
}: {
  state: CachedState;
  store: SessionStore;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  online: boolean;
}) {
  const [activity, setActivity] = useState(""),
    [product, setProduct] = useState<Product | null>(null),
    [assignment, setAssignment] = useState<string | null>(null),
    [search, setSearch] = useState(false),
    [query, setQuery] = useState(""),
    [quantity, setQuantity] = useState(""),
    [now, setNow] = useState(() => Date.now()),
    [kpiState, setKpi] = useState<{
      sessionId: string;
      visibility: string;
      target?: number | null;
    } | null>(null);
  const s = state.session;
  const kpi =
    state.context.visibility !== "OFF" && kpiState?.sessionId === s?.id
      ? kpiState
      : null;
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (!s?.id || state.context.visibility === "OFF") return;
    const id = s.id;
    let live = true;
    store.api
      .rpc<{ visibility: string; target?: number | null }>("employee_kpi", {
        p_session: id,
      })
      .then((value) => {
        if (live) setKpi({ ...value, sessionId: id });
      })
      .catch(() => {
        if (live) setKpi(null);
      });
    return () => {
      live = false;
    };
  }, [s?.id, state.context.visibility, store]);
  const acts = relevantActivities(
    state.catalog.activities,
    state.catalog.activity_positions,
    state.catalog.positions.some(
      (p) => p.id === state.context.profile.position_id && p.active,
    )
      ? state.context.profile.position_id
      : null,
  );
  const assigned = currentAssignments(
    state.catalog.assignments,
    state.context.profile.id,
    localDate(),
  );
  const visibleKpi =
    state.context.visibility !== "OFF" && kpi?.sessionId === s?.id
      ? { ...kpi, visibility: state.context.visibility }
      : null;
  const blocked = busy || !!state.conflict;
  const start = () =>
    run(async () => {
      await store.start(activity, product!.id, assignment);
      setProduct(null);
      setQuantity("");
    });
  if (s) {
    const t = totals(s.segments, now);
    const kind = s.segments.find((g) => !g.ended_at)?.kind;
    const stateLabel =
      kind === "WORK"
        ? "WORKING"
        : kind === "WALKING"
          ? "WALKING"
          : "INTERRUPTION";
    if (s.status === "completed")
      return (
        <div className="employee-panel complete-panel">
          <span className="completion-mark">
            <Check size={38} />
          </span>
          <p className="eyebrow">SESSION COMPLETE</p>
          <h1>{s.quantity} units recorded.</h1>
          <p>
            {s.activity_name} · {s.product_name}
          </p>
          <div className="time-summary">
            <div>
              <strong>{clockText(t.work)}</strong>
              <span>Working</span>
            </div>
            <div>
              <strong>{clockText(t.walking)}</strong>
              <span>Walking</span>
            </div>
            <div>
              <strong>{clockText(t.interruption)}</strong>
              <span>Interruption</span>
            </div>
          </div>
          {visibleKpi && visibleKpi.target != null && (
            <p className="target-note">
              Target: {visibleKpi?.target} units / productive hour
            </p>
          )}
          {visibleKpi?.visibility === "TARGET_AND_ACTUAL" && (
            <p className="notice">
              Actual: {rate(s.quantity ?? 0, t.work)?.toFixed(1) ?? "—"}{" "}
              units/productive hour
            </p>
          )}
          <p className="muted">
            {state.queue.length
              ? "Saved on this device. Reconnect to sync before starting more work."
              : "Your session is saved."}
          </p>
          <button
            className="button primary jumbo"
            disabled={blocked || state.queue.length > 0}
            onClick={() =>
              void run(async () => {
                await store.clearCompleted();
                setActivity("");
                setProduct(null);
                setQuantity("");
              })
            }
          >
            Next activity <ArrowRight />
          </button>
        </div>
      );
    if (s.status === "awaiting_quantity")
      return (
        <div className="employee-panel">
          <p className="eyebrow">WORK FINISHED · TIMER STOPPED</p>
          <h1>How many units?</h1>
          <p className="muted">
            {s.activity_name} · {s.product_name}
          </p>
          <form
            className="form-stack quantity-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await store.command("complete", { quantity: Number(quantity) });
                toast.success("Quantity recorded");
              });
            }}
          >
            <label className="field">
              Quantity completed
              <input
                className="quantity"
                autoFocus
                type="number"
                inputMode="numeric"
                min="0"
                max="1000000000"
                step="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
            </label>
            <button
              className="button primary jumbo"
              disabled={blocked || quantity === ""}
            >
              Save quantity <Check />
            </button>
          </form>
          <p className="muted">Total elapsed: {clockText(t.total)}</p>
        </div>
      );
    return (
      <div className="employee-panel">
        <div className="employee-heading">
          <span>{state.context.profile.name}</span>
          <span className="eyebrow">ACTIVE SESSION</span>
        </div>
        <div className={"timer-card " + kind?.toLowerCase()}>
          <span className="timer-state">
            <i />
            {stateLabel}
          </span>
          <h1>{s.activity_name}</h1>
          <p>{s.product_name}</p>
          <span className="sku">{s.sku}</span>
          <div className="timer-value" aria-label="Elapsed total time">
            {clockText(t.total)}
          </div>
          <span className="timer-caption">TOTAL ELAPSED</span>
          <div className="timer-breakdown">
            <div>
              <strong>{clockText(t.work)}</strong>
              <span>Working</span>
            </div>
            <div>
              <strong>{clockText(t.walking)}</strong>
              <span>Walking</span>
            </div>
            <div>
              <strong>{clockText(t.interruption)}</strong>
              <span>Interruption</span>
            </div>
          </div>
        </div>
        {visibleKpi && visibleKpi.target != null && (
          <div className="target-note">
            Target:{" "}
            <strong>{visibleKpi?.target} units / productive hour</strong>
            {visibleKpi.visibility === "TARGET_AND_ACTUAL" && (
              <small>Actual rate appears after quantity is saved.</small>
            )}
          </div>
        )}
        {kind === "WORK" ? (
          <div className="timer-actions">
            <button
              className="button walking-button"
              disabled={blocked}
              onClick={() =>
                void run(() => store.command("transition", { kind: "WALKING" }))
              }
            >
              <Footprints />
              Walking
            </button>
            <button
              className="button interruption-button"
              disabled={blocked}
              onClick={() =>
                void run(() =>
                  store.command("transition", { kind: "INTERRUPTION" }),
                )
              }
            >
              <Pause />
              Interruption
            </button>
          </div>
        ) : (
          <button
            className="button primary jumbo"
            disabled={blocked}
            onClick={() =>
              void run(() => store.command("transition", { kind: "WORK" }))
            }
          >
            <Play />
            Resume work
          </button>
        )}
        <button
          className="button finish-button jumbo"
          disabled={blocked}
          onClick={() => void run(() => store.command("finish"))}
        >
          <Square />
          Finish
        </button>
        <p className="quiet-note">
          Your timer continues when you lock your phone.
        </p>
      </div>
    );
  }
  if (state.queue.length)
    return (
      <div className="employee-panel">
        <h1>Confirming your session…</h1>
        <p>
          Your start request is saved. Reconnect and tap Sync to recover it.
        </p>
      </div>
    );
  return (
    <div className="employee-panel">
      <div className="employee-heading">
        <span>{state.context.profile.name}</span>
        <span className="eyebrow">READY TO WORK</span>
      </div>
      {activity ? (
        <>
          <button
            className="back-link"
            onClick={() => {
              setActivity("");
              setProduct(null);
              setSearch(false);
            }}
          >
            <ArrowLeft size={18} />
            Activities
          </button>
          <p className="eyebrow">
            {state.catalog.activities.find((a) => a.id === activity)?.name}
          </p>
          <h1>{product ? "Ready when you are." : "Choose a design."}</h1>
          {product ? (
            <>
              <div className="selected-design">
                <Package size={32} />
                <h2>{product.name}</h2>
                <p>{product.sku}</p>
              </div>
              <button
                className="button primary jumbo"
                disabled={blocked || !online}
                onClick={() => void start()}
              >
                <Play />
                Start work
              </button>
              <button
                className="back-link centered"
                onClick={() => setProduct(null)}
              >
                Choose a different design
              </button>
              {!online && (
                <p className="notice">Reconnect to start a new session.</p>
              )}
            </>
          ) : (
            <>
              <div className="section-label">
                <h2>{search ? "All designs" : "Your assignments"}</h2>
                <span>
                  {search
                    ? searchProducts(state.catalog.products, query).length
                    : assigned.length}
                </span>
              </div>
              {search && (
                <label className="search-box">
                  <Search size={20} />
                  <input
                    autoFocus
                    aria-label="Search all designs"
                    placeholder="Search name or SKU"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              )}
              <div className="design-list">
                {search
                  ? searchProducts(state.catalog.products, query).map((p) => (
                      <button
                        className="design-tile"
                        key={p.id}
                        onClick={() => {
                          setProduct(p);
                          setAssignment(null);
                        }}
                      >
                        <span className="design-icon">
                          <Package />
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.sku}</small>
                        </span>
                        <ArrowRight />
                      </button>
                    ))
                  : assigned.map((a) => {
                      const p = state.catalog.products.find(
                        (p) => p.id === a.product_id && p.active,
                      );
                      return p ? (
                        <button
                          className="design-tile"
                          key={a.id}
                          onClick={() => {
                            setProduct(p);
                            setAssignment(a.id);
                          }}
                        >
                          <span className="design-icon">
                            <Package />
                          </span>
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {p.sku}
                              {a.target_quantity != null
                                ? ` · ${a.target_quantity} units`
                                : ""}
                            </small>
                            {a.notes && <small>{a.notes}</small>}
                          </span>
                          <ArrowRight />
                        </button>
                      ) : null;
                    })}
              </div>
              {!search && !assigned.length && (
                <p className="empty">
                  No current assignments. Search all designs to begin.
                </p>
              )}
              <button
                className="button secondary jumbo"
                onClick={() => {
                  setSearch(!search);
                  setQuery("");
                }}
              >
                <Search size={20} />
                {search ? "Back to assignments" : "Search all designs"}
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <p className="eyebrow">LET’S GET STARTED</p>
          <h1>What are you working on?</h1>
          <p className="muted">Choose your activity.</p>
          <div className="activity-grid">
            {acts.map((a, i) => (
              <button
                className="activity-tile"
                key={a.id}
                onClick={() => setActivity(a.id)}
              >
                <span className="tile-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <strong>{a.name}</strong>
                <ArrowRight size={23} />
              </button>
            ))}
          </div>
          {!acts.length && (
            <div className="empty">
              Your manager needs to assign a position and link activities to it.
            </div>
          )}
          <div className="assignment-preview">
            <ClipboardIcon />
            <div>
              <strong>
                {assigned.length} current assignment
                {assigned.length === 1 ? "" : "s"}
              </strong>
              <p>
                {assigned
                  .map(
                    (a) =>
                      state.catalog.products.find((p) => p.id === a.product_id)
                        ?.name,
                  )
                  .filter(Boolean)
                  .slice(0, 3)
                  .join(" · ") ||
                  "Assigned designs will appear after you choose an activity."}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
function ClipboardIcon() {
  return <Package size={23} />;
}

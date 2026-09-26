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
} from "lucide-react";
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
  const [activity, setActivity] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [assignment, setAssignment] = useState<string | null>(null);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [quantity, setQuantity] = useState("");
  const [pending, setPending] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [kpiState, setKpi] = useState<{
    sessionId: string;
    target?: number | null;
  } | null>(null);
  const s = state.session;
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (
      !s?.id ||
      s.requires_quantity === false ||
      state.context.visibility === "OFF"
    )
      return;
    let live = true;
    const id = s.id;
    store.api
      .rpc<{ target?: number | null }>("employee_kpi", { p_session: id })
      .then((value) => {
        if (live) setKpi({ ...value, sessionId: id });
      })
      .catch(() => {
        if (live) setKpi(null);
      });
    return () => {
      live = false;
    };
  }, [s?.id, s?.requires_quantity, state.context.visibility, store]);
  // No ranking model: deterministic name order until configuration supplies an order.
  const acts = relevantActivities(
    state.catalog.activities,
    state.catalog.activity_positions,
    state.catalog.positions.some(
      (p) => p.id === state.context.profile.position_id && p.active,
    )
      ? state.context.profile.position_id
      : null,
  ).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const selected = acts.find((a) => a.id === activity);
  const requiresDesign = selected?.requires_design !== false;
  const assigned = currentAssignments(
    state.catalog.assignments,
    state.context.profile.id,
    localDate(),
  ).flatMap((a) => {
    const design = state.catalog.products.find(
      (p) => p.id === a.product_id && p.active,
    );
    return design ? [{ ...a, design }] : [];
  });
  const blocked = busy || !!pending || !!state.conflict;
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setPending(label);
    try {
      await run(fn);
    } finally {
      setPending("");
    }
  };
  const resetSelection = (nextActivity = "") => {
    setActivity(nextActivity);
    setProduct(null);
    setAssignment(null);
    setSearch(false);
    setQuery("");
    setQuantity("");
  };
  const selectDesign = (design: Product, assignedId: string | null) => {
    setProduct(design);
    setAssignment(assignedId);
  };
  const kpi =
    state.context.visibility !== "OFF" &&
    s?.requires_quantity !== false &&
    kpiState?.sessionId === s?.id
      ? kpiState
      : null;
  const target =
    kpi?.target != null ? (
      <p className="employee-kpi">Target: {kpi.target} units/hour</p>
    ) : null;
  const feedback = (
    <span className="work-feedback" role="status" aria-live="polite">
      {pending}
    </span>
  );
  const title = s
    ? [s.activity_name, s.product_name].filter(Boolean).join(" · ")
    : "";

  if (s) {
    const t = totals(s.segments, now);
    if (s.status === "completed")
      return (
        <section
          className="employee-panel complete-panel"
          aria-busy={!!pending}
        >
          <span className="completion-mark">
            <Check size={36} aria-hidden="true" />
          </span>
          <h1>
            {s.quantity === null
              ? "Activity completed"
              : `${s.quantity} completed`}
          </h1>
          <p>{title}</p>
          {target}
          {kpi &&
            state.context.visibility === "TARGET_AND_ACTUAL" &&
            s.quantity != null && (
              <p className="employee-kpi">
                Actual: {rate(s.quantity, t.work)?.toFixed(1) ?? "—"} units/hour
              </p>
            )}
          <p className="muted">
            {state.queue.length
              ? "Saved on this device. Reconnect to sync before starting more work."
              : "Your work is saved."}
          </p>
          <h2>What’s next?</h2>
          <button
            className="button primary jumbo"
            disabled={
              blocked ||
              state.queue.length > 0 ||
              !acts.some((a) => a.id === s.activity_id)
            }
            onClick={() =>
              void act("Getting ready…", async () => {
                await store.clearCompleted();
                resetSelection(s.activity_id);
              })
            }
          >
            Continue same activity <ArrowRight aria-hidden="true" />
          </button>
          <button
            className="button secondary jumbo"
            disabled={blocked || state.queue.length > 0}
            onClick={() =>
              void act("Getting ready…", async () => {
                await store.clearCompleted();
                resetSelection();
              })
            }
          >
            Choose different activity
          </button>
          {feedback}
        </section>
      );
    if (s.status === "awaiting_quantity")
      return (
        <section className="employee-panel" aria-busy={!!pending}>
          <p className="eyebrow">TIMER STOPPED</p>
          <h1>How many did you complete?</h1>
          <p className="muted">{title}</p>
          <form
            className="form-stack quantity-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!/^\d+$/.test(quantity) || Number(quantity) > 1000000000)
                return;
              void act("Saving…", () =>
                store.command("complete", { quantity: Number(quantity) }),
              );
            }}
          >
            <label className="field">
              Quantity completed
              <input
                className="quantity"
                autoFocus
                type="text"
                inputMode="numeric"
                pattern="[0-9]+"
                maxLength={10}
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                autoComplete="off"
              />
            </label>
            <button
              className="button primary jumbo"
              disabled={
                blocked ||
                !/^\d+$/.test(quantity) ||
                Number(quantity) > 1000000000
              }
            >
              {pending ? "Saving…" : "SAVE"}
              <Check aria-hidden="true" />
            </button>
          </form>
          {feedback}
        </section>
      );
    const kind = s.segments.find((g) => !g.ended_at)?.kind ?? "WORK";
    const label = kind === "WORK" ? "WORKING" : kind;
    return (
      <section
        className="employee-panel active-work-panel"
        aria-busy={!!pending}
      >
        <div className={"timer-card " + kind.toLowerCase()}>
          <h1>{s.activity_name}</h1>
          {s.product_name && <p>{s.product_name}</p>}
          <div className="timer-value" aria-label="Elapsed total time">
            {clockText(t.total)}
          </div>
          <span className="timer-caption">SESSION TIME</span>
          <span className="timer-state" role="status">
            <i aria-hidden="true" />
            {label}
          </span>
        </div>
        {target}
        {kind === "WORK" ? (
          <div className="timer-actions">
            <button
              className="button walking-button"
              disabled={blocked}
              onClick={() =>
                void act("Switching to Walking…", () =>
                  store.command("transition", { kind: "WALKING" }),
                )
              }
            >
              <Footprints aria-hidden="true" />
              WALKING
            </button>
            <button
              className="button interruption-button"
              disabled={blocked}
              onClick={() =>
                void act("Recording interruption…", () =>
                  store.command("transition", { kind: "INTERRUPTION" }),
                )
              }
            >
              <Pause aria-hidden="true" />
              INTERRUPTION
            </button>
          </div>
        ) : (
          <button
            className="button primary jumbo"
            disabled={blocked}
            onClick={() =>
              void act("Resuming work…", () =>
                store.command("transition", { kind: "WORK" }),
              )
            }
          >
            <Play aria-hidden="true" />
            RESUME WORK
          </button>
        )}
        <button
          className="button finish-button jumbo"
          disabled={blocked}
          onClick={() => void act("Finishing…", () => store.command("finish"))}
        >
          <Square aria-hidden="true" />
          FINISH
        </button>
        {feedback}
        <p className="quiet-note">
          You can lock your phone. Your session will resume here.
        </p>
      </section>
    );
  }
  if (state.queue.length)
    return (
      <section className="employee-panel">
        <h1>Confirming your session…</h1>
        <p>
          Your start request is saved. Reconnect and tap Sync to recover it.
        </p>
      </section>
    );
  return (
    <section className="employee-panel" aria-busy={!!pending}>
      {!selected && (
        <div className="work-greeting">
          <p>Hi, {state.context.profile.name.split(/\s+/)[0]}</p>
          <time dateTime={localDate(new Date(now))}>
            {new Date(now).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </time>
        </div>
      )}
      {!selected ? (
        <>
          <h1>What are you working on?</h1>
          <div className="activity-grid">
            {acts.map((a) => (
              <button
                className="activity-tile"
                key={a.id}
                disabled={blocked}
                onClick={() => resetSelection(a.id)}
              >
                <strong>{a.name}</strong>
                <ArrowRight aria-hidden="true" size={23} />
              </button>
            ))}
          </div>
          {!acts.length && (
            <p className="empty">
              Ask your manager to add activities for your position.
            </p>
          )}
        </>
      ) : (
        <>
          <button
            className="back-link"
            disabled={blocked}
            onClick={() => resetSelection()}
          >
            <ArrowLeft aria-hidden="true" size={18} />
            Choose different activity
          </button>
          <p className="eyebrow">{selected.name}</p>
          {!requiresDesign || product ? (
            <>
              <h1>{requiresDesign ? product!.name : selected.name}</h1>
              {requiresDesign && product?.sku && (
                <p className="muted">SKU: {product.sku}</p>
              )}
              <button
                className="button primary jumbo work-start"
                disabled={blocked || !online}
                onClick={() =>
                  void act("Starting…", async () => {
                    await store.start(
                      selected.id,
                      requiresDesign ? product!.id : null,
                      requiresDesign ? assignment : null,
                    );
                    setQuantity("");
                  })
                }
              >
                <Play aria-hidden="true" />
                {pending ? "Starting…" : "START"}
              </button>
              {requiresDesign && (
                <button
                  className="back-link centered"
                  disabled={blocked}
                  onClick={() => {
                    setProduct(null);
                    setAssignment(null);
                  }}
                >
                  Choose a different design
                </button>
              )}
              {!online && (
                <p className="notice">Reconnect to start a new session.</p>
              )}
            </>
          ) : (
            <>
              <h1>Choose a design</h1>
              <h2 className="work-section-title">Today’s work</h2>
              <div className="design-list">
                {assigned.map((a) => (
                  <button
                    className="design-tile"
                    disabled={blocked}
                    key={a.id}
                    onClick={() => selectDesign(a.design, a.id)}
                  >
                    <span>
                      <strong>{a.design.name}</strong>
                      <small>{a.design.sku}</small>
                      {a.target_quantity != null && (
                        <small>{a.target_quantity} assigned</small>
                      )}
                    </span>
                    <ArrowRight aria-hidden="true" />
                  </button>
                ))}
              </div>
              {!assigned.length && (
                <p className="muted">
                  No assignments today. Search for a design below.
                </p>
              )}
              <button
                className="button secondary jumbo"
                disabled={blocked}
                aria-expanded={search}
                aria-controls="work-design-search"
                onClick={() => setSearch(!search)}
              >
                <Search aria-hidden="true" size={20} />
                Search another design
              </button>
              {search && (
                <div id="work-design-search">
                  <label className="search-box">
                    <Search aria-hidden="true" size={20} />
                    <input
                      autoFocus
                      type="search"
                      aria-label="Search by design name or SKU"
                      placeholder="Design name or SKU"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  </label>
                  <div className="design-list">
                    {searchProducts(state.catalog.products, query).map((p) => (
                      <button
                        className="design-tile"
                        key={p.id}
                        disabled={blocked}
                        onClick={() => selectDesign(p, null)}
                      >
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.sku}</small>
                        </span>
                        <ArrowRight aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                  {!searchProducts(state.catalog.products, query).length && (
                    <p role="status" className="muted">
                      No matching designs. Try another name or SKU.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
      {feedback}
    </section>
  );
}

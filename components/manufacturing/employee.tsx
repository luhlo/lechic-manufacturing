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
  parseQuantity,
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
    [pending, setPending] = useState(""),
    [workError, setWorkError] = useState(""),
    [now, setNow] = useState(() => Date.now()),
    [kpiState, setKpi] = useState<{
      sessionId: string;
      visibility: string;
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
  }, [s?.id, s?.requires_quantity, state.context.visibility, store]);

  const acts = relevantActivities(
    state.catalog.activities,
    state.catalog.activity_positions,
    state.catalog.positions.some(
      (p) => p.id === state.context.profile.position_id && p.active,
    )
      ? state.context.profile.position_id
      : null,
  );
  const selected = acts.find((a) => a.id === activity);
  const assigned = currentAssignments(
    state.catalog.assignments,
    state.context.profile.id,
    localDate(new Date(now)),
  ).filter((a) =>
    state.catalog.products.some((p) => p.id === a.product_id && p.active),
  );
  const kpi =
    s?.requires_quantity !== false &&
    state.context.visibility !== "OFF" &&
    kpiState?.visibility !== "OFF" &&
    kpiState?.sessionId === s?.id
      ? kpiState
      : null;
  const blocked = busy || !!pending || !!state.conflict;
  const act = (label: string, fn: () => Promise<unknown>) => {
    if (blocked) return;
    setPending(label);
    setWorkError("");
    void run(async () => {
      try {
        return await fn();
      } catch (error) {
        const raw = error instanceof Error ? error.message : "";
        // Only surface known, actionable device/recovery errors; never leak RPC details.
        const friendly =
          /clock|Start not confirmed|Reconnect|Sync or resolve|access is required/i.test(
            raw,
          )
            ? raw
            : "We couldn’t record that change. Try again before leaving this screen.";
        setWorkError(friendly);
        throw Error(friendly);
      }
    }).finally(() => setPending(""));
  };
  const feedback = (
    <>
      {pending && (
        <p className="work-feedback" role="status">
          {pending}
        </p>
      )}
      {workError && (
        <p className="notice error" role="alert">
          {workError}
        </p>
      )}
    </>
  );
  const resetSelection = (nextActivity = "") => {
    setActivity(nextActivity);
    setProduct(null);
    setAssignment(null);
    setQuantity("");
    setSearch(false);
    setQuery("");
    setWorkError("");
    window.scrollTo({ top: 0 });
  };
  const choose = (p: Product, id: string | null) => {
    setProduct(p);
    setAssignment(id);
    setWorkError("");
    window.scrollTo({ top: 0 });
  };
  const target = kpi?.target != null && (
    <p className="target-note">Target: {kpi.target} units / work hour</p>
  );

  if (s) {
    const t = totals(s.segments, now);
    const kind = s.segments.find((g) => !g.ended_at)?.kind;
    const context = [s.activity_name, s.product_name]
      .filter(Boolean)
      .join(" · ");
    if (s.status === "completed") {
      const canContinue = acts.some((a) => a.id === s.activity_id);
      return (
        <div className="employee-panel complete-panel">
          <span className="completion-mark">
            <Check size={38} />
          </span>
          <h1>
            {s.quantity === null
              ? "Activity completed"
              : `${s.quantity.toLocaleString()} completed`}
          </h1>
          <p>{context}</p>
          <p className="muted completion-saved">
            {state.queue.length
              ? online
                ? "Saved on this device. Sync before starting more work."
                : "Saved on this device. Reconnect to sync before starting more work."
              : "Your session is saved."}
          </p>
          {target}
          {kpi && state.context.visibility === "TARGET_AND_ACTUAL" && (
            <p className="target-note">
              Actual: {rate(s.quantity, t.work)?.toFixed(1) ?? "—"} units / work
              hour
            </p>
          )}
          <h2 className="next-heading">What’s next?</h2>
          <div className="work-next-actions">
            <button
              className="button primary jumbo"
              disabled={blocked || !!state.queue.length || !canContinue}
              onClick={() =>
                act("Getting your next task…", async () => {
                  await store.clearCompleted();
                  resetSelection(s.activity_id);
                })
              }
            >
              Continue same activity <ArrowRight />
            </button>
            <button
              className="button secondary jumbo"
              disabled={blocked || !!state.queue.length}
              onClick={() =>
                act("Getting your activities…", async () => {
                  await store.clearCompleted();
                  resetSelection();
                })
              }
            >
              Choose different activity
            </button>
          </div>
          {!canContinue && (
            <p className="quiet-note">
              This activity is no longer available. Choose another activity.
            </p>
          )}
          {feedback}
        </div>
      );
    }
    if (s.status === "awaiting_quantity") {
      const parsed = parseQuantity(quantity);
      return (
        <div className="employee-panel">
          <p className="eyebrow">WORK FINISHED · TIMER STOPPED</p>
          <h1>How many did you complete?</h1>
          <p className="muted">{context}</p>
          <form
            className="form-stack quantity-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed !== null)
                act("Saving…", () =>
                  store.command("complete", { quantity: parsed }),
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
                aria-describedby="quantity-help"
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
            </label>
            <p
              id="quantity-help"
              className={quantity && parsed === null ? "notice error" : "muted"}
            >
              {quantity && parsed === null
                ? "Enter a whole number from 0 to 1,000,000,000."
                : "Enter the number completed. Zero is okay."}
            </p>
            <button
              className="button primary jumbo"
              disabled={blocked || parsed === null}
            >
              {pending === "Saving…" ? "Saving…" : "Save"} <Check />
            </button>
          </form>
          {feedback}
        </div>
      );
    }
    return (
      <div className="employee-panel active-work">
        <div className={"timer-card " + kind?.toLowerCase()}>
          <h1>{s.activity_name}</h1>
          {s.product_name && <p>{s.product_name}</p>}
          <div className="timer-value" aria-label="Elapsed total time">
            {clockText(t.total)}
          </div>
          <span className="timer-caption">TOTAL ELAPSED</span>
          <div className="timer-state" role="status">
            <i />
            {kind === "WORK"
              ? "WORKING"
              : kind === "WALKING"
                ? "WALKING"
                : "INTERRUPTION"}
          </div>
        </div>
        {kind === "WORK" ? (
          <div className="timer-actions">
            <button
              className="button walking-button"
              disabled={blocked}
              onClick={() =>
                act("Switching to Walking…", () =>
                  store.command("transition", { kind: "WALKING" }),
                )
              }
            >
              <Footprints />
              Walking
            </button>
            <button
              className="button interruption-button"
              disabled={blocked}
              onClick={() =>
                act("Recording interruption…", () =>
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
              act("Resuming work…", () =>
                store.command("transition", { kind: "WORK" }),
              )
            }
          >
            <Play />
            Resume work
          </button>
        )}
        <button
          className="button finish-button jumbo"
          disabled={blocked}
          onClick={() => act("Finishing…", () => store.command("finish"))}
        >
          <Square />
          Finish
        </button>
        {feedback}
        {target}
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
        {feedback}
      </div>
    );
  return (
    <div className="employee-panel">
      {!selected ? (
        <>
          <div className="work-greeting">
            <p>Hi, {state.context.profile.name.trim().split(/\s+/)[0]}</p>
            <span>
              {new Date(now).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
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
                <ArrowRight size={23} />
              </button>
            ))}
          </div>
          {!acts.length && (
            <p className="empty">
              Your manager needs to assign a position and link activities to it.
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
            <ArrowLeft size={18} />
            Activities
          </button>
          {selected.requires_design === false || product ? (
            <>
              <div className="work-start">
                <h1>{selected.name}</h1>
                {product && (
                  <>
                    <h2>{product.name}</h2>
                    <p className="muted">SKU: {product.sku}</p>
                  </>
                )}
              </div>
              <button
                className="button primary jumbo"
                disabled={blocked || !online}
                onClick={() =>
                  act("Starting…", async () => {
                    await store.start(
                      selected.id,
                      selected.requires_design === false ? null : product!.id,
                      selected.requires_design === false ? null : assignment,
                    );
                    setQuantity("");
                    setProduct(null);
                  })
                }
              >
                <Play />
                {pending ? "Starting…" : "Start"}
              </button>
              {selected.requires_design !== false && (
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
              <p className="eyebrow">{selected.name}</p>
              <h1>Choose a design.</h1>
              <div className="section-label">
                <h2>Today’s work</h2>
                <span>{assigned.length}</span>
              </div>
              <div className="design-list">
                {assigned.map((a) => {
                  const p = state.catalog.products.find(
                    (p) => p.id === a.product_id,
                  )!;
                  return (
                    <button
                      className="design-tile"
                      key={a.id}
                      disabled={blocked}
                      onClick={() => choose(p, a.id)}
                    >
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.sku}</small>
                        {a.target_quantity != null && (
                          <small>
                            {a.completed_quantity != null &&
                            a.completed_quantity > 0
                              ? `${a.completed_quantity} / ${a.target_quantity} completed`
                              : `${a.target_quantity} assigned`}
                          </small>
                        )}
                      </span>
                      <ArrowRight />
                    </button>
                  );
                })}
              </div>
              {!assigned.length && (
                <p className="empty">
                  No assignments for today. Search for a design to begin.
                </p>
              )}
              <button
                className="button secondary jumbo"
                aria-expanded={search}
                disabled={blocked}
                onClick={() => setSearch(!search)}
              >
                <Search size={20} />
                Search another design
              </button>
              {search && (
                <section
                  className="work-search"
                  aria-label="Search another design"
                >
                  <label className="search-box">
                    <Search size={20} />
                    <input
                      autoFocus
                      aria-label="Search name or SKU"
                      placeholder="Search name or SKU"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <div className="design-list">
                    {searchProducts(state.catalog.products, query).map((p) => (
                      <button
                        className="design-tile"
                        key={p.id}
                        disabled={blocked}
                        onClick={() => choose(p, null)}
                      >
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.sku}</small>
                        </span>
                        <ArrowRight />
                      </button>
                    ))}
                  </div>
                  {!searchProducts(state.catalog.products, query).length && (
                    <p className="empty">
                      No designs match. Try another name or SKU.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
      {feedback}
    </div>
  );
}

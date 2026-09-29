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
import {
  availableCategories,
  availableSteps,
  continuationStep,
  readCategory,
  rememberCategory,
  validRememberedCategory,
  recordedContext,
} from "@/lib/manufacturing/workflow";
import {
  reportingClock,
  reportingDateLabel,
} from "@/lib/manufacturing/reporting-time";
import { SessionStore } from "@/lib/manufacturing/api";
import { WorkChoices } from "./work-choices";
import { DesignImage } from "./design-image";
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
  const [category, setCategory] = useState(() =>
      readCategory(state.context.profile.id),
    ),
    [step, setStep] = useState<string | null>(null),
    [stepChosen, setStepChosen] = useState(false),
    [creating, setCreating] = useState(false),
    [newName, setNewName] = useState(""),
    [createNote, setCreateNote] = useState(""),
    [activity, setActivity] = useState(""),
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
      !!s.step_id ||
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
  }, [
    s?.id,
    s?.requires_quantity,
    s?.step_id,
    state.context.visibility,
    store,
  ]);

  const acts = relevantActivities(
    state.catalog.activities,
    state.catalog.activity_positions,
    state.catalog.positions.some(
      (p) => p.id === state.context.profile.position_id && p.active,
    )
      ? state.context.profile.position_id
      : null,
  );
  const allowCreation =
    state.context.workflow?.employee_activity_creation === true;
  const stepsEnabled = state.context.workflow?.activity_steps_enabled === true;
  const positionId = state.catalog.positions.some(
    (p) => p.id === state.context.profile.position_id && p.active,
  )
    ? state.context.profile.position_id
    : null;
  const categories = availableCategories(
    state.catalog,
    positionId,
  );
  const selectedCategory = validRememberedCategory(category, categories);
  const categoryName = categories.find((c) => c.id === selectedCategory)?.name;
  const categoryActs = acts.filter((a) => a.category_id === selectedCategory);
  const selected = categoryActs.find((a) => a.id === activity);
  const steps = availableSteps(state.catalog, selected, stepsEnabled);
  const needsStep =
    steps.length > 0 &&
    (!stepChosen || (!!step && !steps.some((s) => s.id === step)));
  const selectedStep = steps.find((s) => s.id === step);
  useEffect(() => {
    // Recovery owns the screen. Preferences only control the next task.
    if (!s) rememberCategory(state.context.profile.id, selectedCategory);
  }, [selectedCategory, state.context.profile.id, s]);
  const assigned = currentAssignments(
    state.catalog.assignments,
    state.context.profile.id,
    localDate(new Date(now)),
  ).filter((a) =>
    state.catalog.products.some((p) => p.id === a.product_id && p.active),
  );
  const kpi =
    !s?.step_id &&
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
          /clock|Start not confirmed|Reconnect|Sync or resolve|access is required|activity creation|category|Activity name|activity is unavailable/i.test(
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
    setStep(null);
    setStepChosen(false);
    setCreating(false);
    setNewName("");
    setCreateNote("");
    setProduct(null);
    setAssignment(null);
    setQuantity("");
    setSearch(false);
    setQuery("");
    setWorkError("");
    window.scrollTo({ top: 0 });
  };
  const chooseCategory = (id: string) => {
    setCategory(id);
    rememberCategory(state.context.profile.id, id);
    resetSelection();
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
    const context = [recordedContext(s), s.product_name]
      .filter(Boolean)
      .join(" · ");
    if (s.status === "completed") {
      const nextActivity = acts.find((a) => a.id === s.activity_id);
      const nextCategory = s.category_id || nextActivity?.category_id || "";
      const canUseCategory = categories.some((c) => c.id === nextCategory);
      const canContinue =
        canUseCategory && nextActivity?.category_id === nextCategory;
      return (
        <div className="employee-panel complete-panel">
          <span className="completion-mark">
            <Check size={38} />
          </span>
          <h1>
            {s.quantity === null
              ? "Activity completed"
              : `${s.quantity.toLocaleString()} units processed`}
          </h1>
          <p>{context}</p>
          <p className="muted completion-saved">
            {state.queue.length
              ? online
                ? "Saved on this device. You can continue working while it syncs."
                : "Saved on this device. You can continue working offline."
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
              disabled={blocked || !canContinue}
              onClick={() =>
                act("Getting your next task…", async () => {
                  await store.clearCompleted();
                  chooseCategory(nextCategory);
                  resetSelection(s.activity_id);
                  const continuation = continuationStep(
                    s,
                    availableSteps(state.catalog, nextActivity, stepsEnabled),
                  );
                  setStep(continuation.stepId);
                  setStepChosen(continuation.chosen);
                })
              }
            >
              Continue same activity <ArrowRight />
            </button>
            <button
              className="button secondary jumbo"
              disabled={blocked}
              onClick={() =>
                act("Getting your activities…", async () => {
                  await store.clearCompleted();
                  chooseCategory(canUseCategory ? nextCategory : "");
                })
              }
            >
              Another activity in this category
            </button>
          </div>
          <button
            className="back-link centered"
            disabled={blocked}
            onClick={() =>
              act("Getting your categories…", async () => {
                await store.clearCompleted();
                chooseCategory("");
              })
            }
          >
            Change category
          </button>
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
          <h1>How many units did you process?</h1>
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
              Quantity processed
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
                : "Enter the number processed. Zero is okay."}
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
          <p className="timer-context">
            {s.category_name || "Legacy / uncategorized"}
            {s.step_name ? ` · ${s.step_name}` : ""}
          </p>
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
        <p className="quiet-note work-clock">
          Started{" "}
          {reportingClock(
            s.started_at,
            localDate(new Date(s.started_at)) !== localDate(new Date(now)),
          )}{" "}
          · Now {reportingClock(now)}
        </p>
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
  if (state.queue.some((c) => c.action === "start" && !(state.pendingSessions ?? []).some((s) => s.id === c.session_id)))
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
      {!selectedCategory ? (
        <>
          <div className="work-greeting">
            <p>Hi, {state.context.profile.name.trim().split(/\s+/)[0]}</p>
            <span>{reportingDateLabel(now)}</span>
          </div>
          <h1>Choose a category.</h1>
          <WorkChoices items={categories} label="categories" disabled={blocked} onChoose={chooseCategory} />
          {!categories.length && (
            <p className="empty">
              No categories are assigned to your position yet. Ask your manager
              to assign a category or an activity.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="category-heading">
            <strong>{categoryName}</strong>
            <button
              className="back-link"
              disabled={blocked}
              onClick={() => chooseCategory("")}
            >
              Change category
            </button>
          </div>
          {!selected ? (
            <>
              <h1>What are you doing?</h1>
              <WorkChoices key={selectedCategory} items={categoryActs} label="activities" disabled={blocked} onChoose={resetSelection} />
              {!categoryActs.length && (
                <p className="empty">No activities assigned to you in this category yet.{allowCreation ? " Add your first activity below." : " Ask your manager to add one."}</p>
              )}
              {allowCreation &&
                (!creating ? (
                  <button
                    className="button secondary jumbo"
                    disabled={blocked || !online}
                    onClick={() => setCreating(true)}
                  >
                    + New activity
                  </button>
                ) : (
                  <form
                    className="form-stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!online || !newName.trim()) return;
                      act("Saving activity…", async () => {
                        const result = await store.api.rpc<{
                          id: string;
                          existing: boolean;
                        }>("employee_create_activity", {
                          p_category: selectedCategory,
                          p_name: newName.trim(),
                        });
                        await store.refresh();
                        resetSelection(result.id);
                        setCreateNote(
                          result.existing
                            ? "Selected the existing activity."
                            : `Activity saved under ${categoryName} and selected.`,
                        );
                      });
                    }}
                  >
                    <p className="muted">Saving under <strong>{categoryName}</strong>.</p>
                    <label className="field">
                      Activity name
                      <input
                        autoFocus
                        required
                        maxLength={100}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                      />
                    </label>
                    <button
                      className="button primary jumbo"
                      disabled={blocked || !online || !newName.trim()}
                    >
                      Save and select
                    </button>
                    <button
                      type="button"
                      className="back-link"
                      disabled={blocked}
                      onClick={() => setCreating(false)}
                    >
                      Cancel
                    </button>
                  </form>
                ))}
              {allowCreation && !online && (
                <p className="notice">Reconnect to create an activity.</p>
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
              {createNote && (
                <p role="status" className="quiet-note">
                  {createNote}
                </p>
              )}
              {needsStep ? (
                <>
                  <p className="eyebrow">{selected.name}</p>
                  <h1>Choose a step.</h1>
                  <div className="activity-grid">
                    {steps.map((value) => (
                      <button
                        key={value.id}
                        className="activity-tile"
                        disabled={blocked}
                        onClick={() => {
                          setStep(value.id);
                          setStepChosen(true);
                        }}
                      >
                        <strong>{value.name}</strong>
                        <ArrowRight size={23} />
                      </button>
                    ))}
                    <button
                      className="activity-tile"
                      disabled={blocked}
                      onClick={() => {
                        setStep(null);
                        setStepChosen(true);
                      }}
                    >
                      <strong>General activity</strong>
                      <ArrowRight size={23} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {steps.length > 0 && (
                    <div className="category-heading">
                      <span>{selectedStep?.name || "General activity"}</span>
                      <button
                        className="back-link"
                        disabled={blocked}
                        onClick={() => setStepChosen(false)}
                      >
                        Change step
                      </button>
                    </div>
                  )}
                  {selected.requires_design === false || product ? (
                    <>
                      <div className="work-start">
                        <h1>{selected.name}</h1>
                        {product && (
                          <>
                            <DesignImage url={product.image_url} name={product.name} large />
                            <h2>{product.name}</h2>
                            <p className="muted">SKU: {product.sku}</p>
                          </>
                        )}
                      </div>
                      <button
                        className="button primary jumbo"
                        disabled={blocked}
                        onClick={() =>
                          act("Starting…", async () => {
                            await store.start(
                              selected.id,
                              selected.requires_design === false
                                ? null
                                : product!.id,
                              selected.requires_design === false
                                ? null
                                : assignment,
                              selectedStep?.id ?? null,
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
                        <p className="notice">
                          You’re offline. This work will save on your device and sync when you reconnect.
                        </p>
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
                              <DesignImage url={p.image_url} name={p.name} />
                              <span>
                                <strong>{p.name}</strong>
                                <small>{p.sku}</small>
                                {a.target_quantity != null && (
                                  <small>
                                    {a.completed_quantity != null &&
                                    a.completed_quantity > 0
                                      ? `${a.completed_quantity} / ${a.target_quantity} recorded`
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
                          No assignments for today. Search for a design to
                          begin.
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
                            {searchProducts(state.catalog.products, query).map(
                              (p) => (
                                <button
                                  className="design-tile"
                                  key={p.id}
                                  disabled={blocked}
                                  onClick={() => choose(p, null)}
                                >
                                  <DesignImage url={p.image_url} name={p.name} />
                                  <span>
                                    <strong>{p.name}</strong>
                                    <small>{p.sku}</small>
                                  </span>
                                  <ArrowRight />
                                </button>
                              ),
                            )}
                          </div>
                          {!searchProducts(state.catalog.products, query)
                            .length && (
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
            </>
          )}
        </>
      )}
      {feedback}
    </div>
  );
}

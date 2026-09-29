import { relevantActivities, localDate } from "./domain";
import { availableSteps, availableCategories } from "./workflow";
import type { CachedState, Command, Session, StartContext } from "./types";

/** Local snapshots permit recording; the server rechecks every command on sync. */
export function localStart(state: CachedState, command: Command): Session {
  const { profile } = state.context, catalog = state.catalog;
  const position = catalog.positions.find((p) => p.id === profile.position_id && p.active);
  const activity = relevantActivities(catalog.activities, catalog.activity_positions, position?.id ?? null)
    .find((a) => a.id === command.activity_id);
  const category = availableCategories(catalog, position?.id ?? null)
    .find((c) => c.id === activity?.category_id);
  if (!profile.active || !position || !activity || !category)
    throw Error("This activity is unavailable for your position. Reconnect to refresh your choices.");
  const requiresDesign = activity.requires_design !== false;
  const requiresQuantity = activity.requires_quantity !== false;
  const product = catalog.products.find((p) => p.id === command.product_id && p.active);
  if (requiresDesign && !product) throw Error("Choose a saved, active design before starting.");
  if (!requiresDesign && (command.product_id || command.assignment_id))
    throw Error("This activity does not use a design. Choose it again.");
  if (command.assignment_id && !catalog.assignments.some((a) => a.id === command.assignment_id &&
    a.employee_id === profile.id && a.product_id === product?.id &&
    a.work_date === localDate(new Date(command.at)) && ["assigned", "in_progress"].includes(a.status)))
    throw Error("This assignment is unavailable. Choose the design again.");
  const stepsEnabled = state.context.workflow?.activity_steps_enabled === true && activity.use_steps === true;
  const step = availableSteps(catalog, activity, stepsEnabled).find((s) => s.id === command.step_id);
  if (command.step_id && !step) throw Error("This activity step is unavailable. Choose it again.");
  const lastEnd = [state.session, ...(state.pendingSessions ?? [])]
    .filter((s): s is Session => !!s && !!s.ended_at)
    .reduce((last, s) => Math.max(last, Date.parse(s.ended_at!)), 0);
  if (Date.parse(command.at) < lastEnd) throw Error("Your device clock moved backwards. Correct it before starting.");
  command.offline_context = {
    position_id: position.id, category_id: category.id,
    requires_design: requiresDesign, requires_quantity: requiresQuantity, steps_enabled: stepsEnabled,
  } satisfies StartContext;
  return {
    id: command.session_id, employee_id: profile.id, position_id: position.id,
    activity_id: activity.id, product_id: product?.id ?? null, assignment_id: command.assignment_id ?? null,
    employee_name: profile.name, position_name: String(position.name ?? ""), activity_name: activity.name,
    product_name: product?.name ?? "", sku: product?.sku ?? "",
    category_id: category.id, category_name: category.name, step_id: step?.id ?? null, step_name: step?.name ?? null,
    steps_enabled: stepsEnabled, requires_design: requiresDesign, requires_quantity: requiresQuantity,
    started_at: command.at, ended_at: null, status: "running", quantity: null, revision: 1,
    segments: [{ id: command.request_id, session_id: command.session_id, kind: "WORK", started_at: command.at, ended_at: null }],
  };
}

export function networkOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

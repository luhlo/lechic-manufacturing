import type {
  Activity,
  ActivityCategory,
  ActivityStep,
  Catalog,
  Session,
} from "./types";
import { relevantActivities } from "./domain";
export function availableCategories(
  catalog: Catalog,
  position: string | null,
) {
  // Management may load the entire catalog. My Work still uses only this
  // employee's active position, never their broader administration access.
  if (!catalog.positions.some((p) => p.id === position && p.active)) return [];
  const activities = relevantActivities(catalog.activities, catalog.activity_positions, position);
  return (catalog.activity_categories ?? [])
    .filter(
      (c) =>
        c.active &&
        (activities.some((a) => a.category_id === c.id) ||
          (catalog.category_positions ?? []).some(
            (p) => p.category_id === c.id && p.position_id === position,
          )),
    )
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}
export function availableSteps(
  catalog: Catalog,
  activity: Activity | undefined,
  enabled: boolean,
) {
  return enabled && activity?.use_steps
    ? (catalog.activity_steps ?? [])
        .filter((s) => s.active && s.activity_id === activity.id)
        .sort(
          (a, b) =>
            a.sort_order - b.sort_order ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id),
        )
    : [];
}
export function continuationStep(session: Session, steps: ActivityStep[]) {
  return {
    stepId:
      session.step_id && steps.some((s) => s.id === session.step_id)
        ? session.step_id
        : null,
    chosen:
      !session.step_id ||
      !steps.length ||
      steps.some((s) => s.id === session.step_id),
  };
}
export const categoryStorageKey = (employee: string) =>
  `lechic-manufacturing-category:${employee}`;
export function readCategory(
  employee: string,
  storage?: Pick<Storage, "getItem">,
) {
  try {
    return (
      (storage ?? localStorage).getItem(categoryStorageKey(employee)) ?? ""
    );
  } catch {
    return "";
  }
}
export function rememberCategory(
  employee: string,
  category: string,
  storage?: Pick<Storage, "setItem" | "removeItem">,
) {
  try {
    const s = storage ?? localStorage;
    if (category) s.setItem(categoryStorageKey(employee), category);
    else s.removeItem(categoryStorageKey(employee));
  } catch {
    /* Navigation preferences never block recording work. */
  }
}
export function validRememberedCategory(
  id: string,
  categories: ActivityCategory[],
) {
  return categories.some((c) => c.id === id) ? id : "";
}
export function recordedContext(session: Session) {
  return [
    session.category_name || "Legacy / uncategorized",
    session.activity_name,
    session.step_name,
  ]
    .filter(Boolean)
    .join(" · ");
}

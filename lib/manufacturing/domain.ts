import type {
  Activity,
  Assignment,
  Command,
  Product,
  Segment,
  Session,
} from "./types";
export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
export function searchProducts(products: Product[], query: string): Product[] {
  const terms = query.trim().split(/\s+/).map(normalize).filter(Boolean);
  return products.filter(
    (p) =>
      p.active &&
      terms.every((q) => normalize(p.name + " " + p.sku).includes(q)),
  );
}
export function relevantActivities(
  activities: Activity[],
  links: { activity_id: string; position_id: string }[],
  positionId: string | null,
) {
  return activities.filter(
    (a) =>
      a.active &&
      links.some((l) => l.activity_id === a.id && l.position_id === positionId),
  );
}
export function currentAssignments(
  assignments: Assignment[],
  employee: string,
  today: string,
) {
  return assignments
    .filter(
      (a) =>
        a.employee_id === employee &&
        a.work_date === today &&
        ["assigned", "in_progress"].includes(a.status),
    )
    .sort((a, b) => b.work_date.localeCompare(a.work_date));
}
export function totals(segments: Segment[], now = Date.now()) {
  const result = {
    work: 0,
    walking: 0,
    interruption: 0,
    total: 0,
    walkingEvents: 0,
    interruptionEvents: 0,
  };
  for (const s of segments) {
    const seconds =
      Math.max(
        0,
        (s.ended_at ? Date.parse(s.ended_at) : now) - Date.parse(s.started_at),
      ) / 1000;
    const key =
      s.kind === "WORK"
        ? "work"
        : s.kind === "WALKING"
          ? "walking"
          : "interruption";
    result[key] += seconds;
    if (s.kind === "WALKING") result.walkingEvents++;
    if (s.kind === "INTERRUPTION") result.interruptionEvents++;
  }
  result.total = result.work + result.walking + result.interruption;
  return result;
}
export function rate(quantity: number | null, seconds: number): number | null {
  return quantity != null && seconds > 0 ? (quantity * 3600) / seconds : null;
}
export function clockText(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function chooseKpi(
  targets: {
    activity_id: string;
    product_id: string | null;
    active: boolean;
    effective_from: string;
    valid_until?: string | null;
    target_value: number;
  }[],
  activityId: string,
  productId: string | null,
  at: string,
) {
  return (
    targets
      .filter(
        (k) =>
          k.active &&
          k.activity_id === activityId &&
          (!k.product_id || k.product_id === productId) &&
          Date.parse(k.effective_from) <= Date.parse(at) &&
          (!k.valid_until || Date.parse(k.valid_until) > Date.parse(at)),
      )
      .sort(
        (a, b) =>
          Number(!!b.product_id) - Number(!!a.product_id) ||
          Date.parse(b.effective_from) - Date.parse(a.effective_from),
      )[0] ?? null
  );
}
export function applyCommand(session: Session, command: Command): Session {
  if (
    command.session_id !== session.id ||
    command.expected_revision !== session.revision
  )
    throw Error("Session changed. Reconnect to recover it.");
  const s = structuredClone(session);
  const open = s.segments.find((x) => !x.ended_at);
  if (command.action === "complete") {
    if (s.status !== "awaiting_quantity")
      throw Error("Finish the session first.");
    if (
      !Number.isSafeInteger(command.quantity) ||
      command.quantity! < 0 ||
      command.quantity! > 1000000000
    )
      throw Error("Enter a whole quantity of zero or more.");
    s.quantity = command.quantity!;
    s.status = "completed";
  } else {
    if (s.status !== "running" || !open) throw Error("No running session.");
    if (Date.parse(command.at) < Date.parse(open.started_at))
      throw Error(
        "Your device clock moved backwards. Reconnect before continuing.",
      );
    open.ended_at = command.at;
    if (command.action === "transition") {
      if (!command.kind || command.kind === open.kind)
        throw Error("Choose a different state.");
      s.segments.push({
        id: command.request_id,
        session_id: s.id,
        kind: command.kind,
        started_at: command.at,
        ended_at: null,
      });
    } else if (command.action === "finish") {
      s.ended_at = command.at;
      s.status = s.requires_quantity === false ? "completed" : "awaiting_quantity";
    } else throw Error("Invalid action.");
  }
  s.revision++;
  return s;
}
export function weightedBaseline(
  sessions: Session[],
  before: string,
  activity: string,
  product: string | null,
) {
  const history = sessions.filter(
    (s) =>
      s.status === "completed" &&
      s.requires_quantity !== false && s.quantity != null &&
      s.started_at < before &&
      s.activity_id === activity &&
      s.product_id === product,
  );
  const seconds = history.reduce((n, s) => n + totals(s.segments).work, 0);
  return {
    rate: rate(
      history.reduce((n, s) => n + (s.quantity ?? 0), 0),
      seconds,
    ),
    samples: history.length,
  };
}

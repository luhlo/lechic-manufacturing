import type { Catalog, Context, Session, Command, Row } from "./types";
import { Api, type SessionFilter } from "./api";
import {
  applyCommand,
  chooseKpi,
  localDate,
  normalize,
  weightedBaseline,
} from "./domain";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const demoUid = id(1);
function seed() {
  const today = localDate();
  const catalog: Catalog = {
    profiles: [
      {
        id: demoUid,
        name: "Alex Morgan",
        email: "alex@example.invalid",
        auth_user_id: demoUid,
        position_id: id(10),
        active: true,
      },
      {
        id: id(2),
        name: "Sam Rivera",
        email: "sam@example.invalid",
        auth_user_id: null,
        position_id: id(10),
        active: true,
      },
    ],
    positions: [{ id: id(10), name: "Studio team", active: true }],
    activities: [
      { id: id(20), name: "Preparation", active: true },
      { id: id(21), name: "Finishing", active: true },
      { id: id(22), name: "Packing", active: true },
    ],
    activity_positions: [20, 21, 22].map((n) => ({
      activity_id: id(n),
      position_id: id(10),
    })),
    products: [
      { id: id(30), name: "Sample arc", sku: "DEMO-001", active: true },
      { id: id(31), name: "Sample bloom", sku: "DEMO-002", active: true },
      { id: id(32), name: "Sample wave", sku: "DEMO-003", active: true },
    ],
    assignments: [
      {
        id: id(40),
        employee_id: demoUid,
        product_id: id(30),
        work_date: today,
        target_quantity: 60,
        status: "assigned",
        notes: "",
        active: true,
      },
      {
        id: id(41),
        employee_id: demoUid,
        product_id: id(31),
        work_date: today,
        target_quantity: 40,
        status: "assigned",
        notes: "",
      },
    ],
    roles: [
      { id: id(50), name: "Administrator", active: true },
      { id: id(51), name: "Employee", active: true },
    ],
    role_permissions: [{ role_id: id(50), permission_id: "*" }],
    profile_roles: [{ profile_id: demoUid, role_id: id(50) }],
    position_roles: [],
    kpi_targets: [
      {
        id: id(60),
        activity_id: id(20),
        product_id: null,
        target_value: 45,
        active: true,
        effective_from: "2020-01-01T00:00:00Z",
        metric: "units_per_productive_hour",
      },
    ],
    settings: [{ id: "main", employee_kpi_visibility: "OFF" }],
  };
  const sessions: Session[] = [];
  for (let i = 0; i < 12; i++) {
    const start = new Date();
    start.setDate(start.getDate() - (i % 6));
    start.setHours(8 + (i % 5), 0, 0, 0);
    const sid = id(100 + i);
    const work = 1200 + i * 120,
      walk = 90 + i * 10,
      interrupt = 60;
    const end = new Date(
      +start + (work + walk + interrupt) * 1000,
    ).toISOString();
    const product = catalog.products[i % 3];
    sessions.push({
      id: sid,
      employee_id: i % 3 === 0 ? id(2) : demoUid,
      position_id: id(10),
      activity_id: id(20 + (i % 3)),
      product_id: product.id,
      assignment_id: null,
      employee_name: i % 3 === 0 ? "Sam Rivera" : "Alex Morgan",
      position_name: "Studio team",
      activity_name: catalog.activities[i % 3].name,
      product_name: product.name,
      sku: product.sku,
      started_at: start.toISOString(),
      ended_at: end,
      status: "completed",
      quantity: 18 + i,
      revision: 6,
      segments: [
        {
          id: id(200 + i * 3),
          session_id: sid,
          kind: "WORK",
          started_at: start.toISOString(),
          ended_at: new Date(+start + work * 1000).toISOString(),
        },
        {
          id: id(201 + i * 3),
          session_id: sid,
          kind: "WALKING",
          started_at: new Date(+start + work * 1000).toISOString(),
          ended_at: new Date(+start + (work + walk) * 1000).toISOString(),
        },
        {
          id: id(202 + i * 3),
          session_id: sid,
          kind: "INTERRUPTION",
          started_at: new Date(+start + (work + walk) * 1000).toISOString(),
          ended_at: end,
        },
      ],
    });
  }
  return {
    catalog,
    sessions,
    receipts: {} as Record<string, Session>,
    targets: {} as Record<string, number | null>,
  };
}
export class DemoApi extends Api {
  constructor() {
    super(null as never);
  }
  private read() {
    const raw = localStorage.getItem("manufacturing-demo");
    return raw ? (JSON.parse(raw) as ReturnType<typeof seed>) : seed();
  }
  private save(state: ReturnType<typeof seed>) {
    localStorage.setItem("manufacturing-demo", JSON.stringify(state));
  }
  async catalog() {
    return this.read().catalog;
  }
  async sessions(f: SessionFilter) {
    return this.read().sessions.filter(
      (s) =>
        (f.active
          ? s.status !== "completed"
          : s.status === "completed" &&
            s.started_at >= f.from &&
            s.started_at < f.to) &&
        (!f.employee || s.employee_id === f.employee) &&
        (!f.position || s.position_id === f.position) &&
        (!f.activity || s.activity_id === f.activity) &&
        (!f.product || s.product_id === f.product) &&
        normalize(s.sku).includes(normalize(f.sku || "")),
    );
  }
  async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    const db = this.read();
    db.targets ??= {};
    let result: unknown;
    if (name === "app_context")
      result = {
        profile: db.catalog.profiles[0],
        permissions: ["*"],
        visibility: db.catalog.settings[0].employee_kpi_visibility,
      } as Context;
    else if (name === "active_session")
      result =
        db.sessions.find(
          (s) => s.employee_id === demoUid && s.status !== "completed",
        ) ?? null;
    else if (name === "session_command") {
      const c = args!.p as Command;
      if (db.receipts[c.request_id]) return db.receipts[c.request_id] as T;
      let s: Session;
      if (c.action === "start") {
        if (
          db.sessions.some(
            (s) => s.employee_id === demoUid && s.status !== "completed",
          )
        )
          throw Object.assign(Error("You already have an active session."), {
            code: "40001",
          });
        const a = db.catalog.activities.find((a) => a.id === c.activity_id)!;
        const p = db.catalog.products.find((p) => p.id === c.product_id)!;
        s = {
          id: c.session_id,
          employee_id: demoUid,
          position_id: db.catalog.profiles[0].position_id,
          activity_id: a.id,
          product_id: p.id,
          assignment_id: c.assignment_id ?? null,
          employee_name: db.catalog.profiles[0].name,
          position_name: db.catalog.positions[0].name!,
          activity_name: a.name,
          product_name: p.name,
          sku: p.sku,
          started_at: c.at,
          ended_at: null,
          status: "running",
          quantity: null,
          revision: 1,
          segments: [
            {
              id: c.request_id,
              session_id: c.session_id,
              kind: "WORK",
              started_at: c.at,
              ended_at: null,
            },
          ],
        };
        db.targets[s.id] =
          chooseKpi(
            db.catalog.kpi_targets as never,
            s.activity_id,
            s.product_id,
            s.started_at,
          )?.target_value ?? null;
        const assigned = db.catalog.assignments.find(
          (a) => a.id === s.assignment_id,
        );
        if (assigned) assigned.status = "in_progress";
        db.sessions.push(s);
      } else {
        const index = db.sessions.findIndex((s) => s.id === c.session_id);
        s = applyCommand(db.sessions[index], c);
        db.sessions[index] = s;
      }
      const assigned = db.catalog.assignments.find(
        (a) => a.id === s.assignment_id,
      );
      if (
        s.status === "completed" &&
        assigned &&
        ["assigned", "in_progress"].includes(assigned.status) &&
        (assigned.target_quantity == null ||
          db.sessions
            .filter(
              (x) =>
                x.assignment_id === assigned.id && x.status === "completed",
            )
            .reduce((n, x) => n + (x.quantity ?? 0), 0) >=
            assigned.target_quantity)
      )
        assigned.status = "completed";
      db.receipts[c.request_id] = s;
      result = s;
    } else if (name === "employee_kpi") {
      const s = db.sessions.find((s) => s.id === args!.p_session)!;
      const visibility = db.catalog.settings[0].employee_kpi_visibility;
      result =
        visibility === "OFF"
          ? { visibility }
          : { visibility, target: db.targets[s.id] ?? null };
    } else if (name === "analytics_targets")
      result = (args!.p_ids as string[]).map((session_id) => ({
        session_id,
        target_value: db.targets[session_id] ?? null,
      }));
    else if (name === "analytics_baselines")
      result = (
        args!.p_pairs as { activity_id: string; product_id: string }[]
      ).map((p) => ({
        ...p,
        ...weightedBaseline(
          db.sessions,
          args!.p_before as string,
          p.activity_id,
          p.product_id,
        ),
      }));
    else throw Error("Unknown demo operation");
    this.save(db);
    return result as T;
  }
  async manage(entity: string, p: Record<string, unknown>) {
    const db = this.read();
    const rid = String(p.id || crypto.randomUUID());
    const row = { ...p, id: rid } as Row;
    if (entity === "settings") db.catalog.settings = [{ ...row, id: "main" }];
    else if (entity === "kpi_targets") {
      const old = db.catalog.kpi_targets.find((k) => k.id === rid);
      if (old) {
        if (old.valid_until) throw Error("Edit the latest KPI version.");
        old.valid_until = row.effective_from || new Date().toISOString();
        row.id = crypto.randomUUID();
        row.supersedes_id = old.id;
      }
      row.effective_from ||= new Date().toISOString();
      db.catalog.kpi_targets.push(row);
    } else if (entity === "profile_roles" || entity === "position_roles") {
      const field = entity === "profile_roles" ? "profile_id" : "position_id";
      (db.catalog as unknown as Record<string, unknown>)[entity] = [
        ...(db.catalog[entity] as unknown as Record<string, string>[]).filter(
          (x) => x[field] !== rid,
        ),
        ...(p.role_ids as string[]).map((role_id) => ({
          [field]: rid,
          role_id,
        })),
      ];
    } else {
      const list = (db.catalog as unknown as Record<string, Row[]>)[entity];
      const idx = list.findIndex((r) => r.id === rid);
      if (idx >= 0) list[idx] = row;
      else list.push(row);
      if (entity === "activities")
        db.catalog.activity_positions = [
          ...db.catalog.activity_positions.filter((x) => x.activity_id !== rid),
          ...(p.position_ids as string[]).map((position_id) => ({
            activity_id: rid,
            position_id,
          })),
        ];
      if (entity === "roles")
        db.catalog.role_permissions = [
          ...db.catalog.role_permissions.filter((x) => x.role_id !== rid),
          ...(p.permission_ids as string[]).map((permission_id) => ({
            role_id: rid,
            permission_id,
          })),
        ];
    }
    this.save(db);
    return row;
  }
}

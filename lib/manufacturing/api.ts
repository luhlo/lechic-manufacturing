import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Catalog,
  Context,
  Row,
  Session,
  Command,
  CachedState,
} from "./types";
import { applyCommand, localDate, normalize } from "./domain";
import { allowed } from "./types";
const forbidden = ["mhfkjrtrfdnmjmmvlueg", "inzmepwulnfdlruduhbf"];
export function clientFor(url: string, key: string) {
  if (forbidden.some((ref) => url.includes(ref)))
    throw Error(
      "This application requires its own Supabase project. Relay and Commissions are blocked.",
    );
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "lechic-manufacturing-auth",
    },
  });
}
export const emptyCatalog = (): Catalog => ({
  profiles: [],
  positions: [],
  activities: [],
  products: [],
  assignments: [],
  activity_positions: [],
  roles: [],
  role_permissions: [],
  profile_roles: [],
  position_roles: [],
  kpi_targets: [],
  settings: [],
});
export interface SessionFilter {
  from: string;
  to: string;
  employee?: string;
  position?: string;
  activity?: string;
  product?: string;
  sku?: string;
  active?: boolean;
}
export class Api {
  constructor(public client: SupabaseClient) {}
  async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw Object.assign(Error(error.message), { code: error.code });
    return data as T;
  }
  async catalog(context?: Context): Promise<Catalog> {
    const c = emptyCatalog();
    await Promise.all(
      Object.keys(c).map(async (name) => {
        if (
          name === "profiles" &&
          context &&
          !allowed(context.permissions, "employees.view") &&
          !allowed(context.permissions, "permissions.manage")
        ) {
          const directory =
            await this.rpc<Catalog["profiles"]>("employee_directory");
          c.profiles = directory.length ? directory : [context.profile];
          return;
        }
        const all: unknown[] = [];
        for (let page = 0; ; page++) {
          let query = this.client.from(name).select("*");
          const order =
            name === "activity_positions"
              ? "activity_id,position_id"
              : name === "role_permissions"
                ? "role_id,permission_id"
                : name === "profile_roles"
                  ? "profile_id,role_id"
                  : name === "position_roles"
                    ? "position_id,role_id"
                    : "id";
          for (const column of order.split(",")) query = query.order(column);
          if (
            name === "assignments" &&
            context &&
            !allowed(context.permissions, "assignments.view") &&
            !allowed(context.permissions, "analytics.view")
          )
            query = query
              .eq("work_date", localDate())
              .in("status", ["assigned", "in_progress"]);
          const { data, error } = await query.range(
            page * 1000,
            page * 1000 + 999,
          );
          if (error)
            throw Object.assign(Error(error.message), { code: error.code });
          all.push(...data);
          if (data.length < 1000) break;
        }
        (c as unknown as Record<string, unknown>)[name] = all;
      }),
    );
    if (context && allowed(context.permissions, "my_work.access")) {
      const own = c.assignments.filter(
        (a) =>
          a.employee_id === context.profile.id &&
          a.work_date === localDate() &&
          ["assigned", "in_progress"].includes(a.status),
      );
      for (let i = 0; i < own.length; i += 500) {
        let progress: { id: string; completed_quantity: number }[];
        try {
          progress = await this.rpc("assignment_progress", {
            p_ids: own.slice(i, i + 500).map((a) => a.id),
          });
        } catch (error) {
          if (
            isDenial(error) ||
            hasCode(error, "PGRST301") ||
            hasCode(error, "PGRST303")
          )
            throw error;
          // Optional progress must not block today's work if this read fails.
          break;
        }
        const counts = new Map(
          progress.map((p) => [p.id, p.completed_quantity]),
        );
        own.slice(i, i + 500).forEach((a) => {
          a.completed_quantity = counts.get(a.id);
        });
      }
    }
    return c;
  }
  async sessions(filter: SessionFilter): Promise<Session[]> {
    const rows: Session[] = [];
    for (let page = 0; ; page++) {
      let query = this.client.from("sessions").select("*, segments(*)");
      if (filter.active) query = query.neq("status", "completed");
      else
        query = query
          .eq("status", "completed")
          .gte("started_at", filter.from)
          .lt("started_at", filter.to);
      for (const [key, value] of Object.entries({
        employee_id: filter.employee,
        position_id: filter.position,
        activity_id: filter.activity,
        product_id: filter.product,
      }))
        if (value) query = query.eq(key, value);
      if (filter.sku)
        query = query.like("sku_search", `%${normalize(filter.sku)}%`);
      const { data, error } = await query
        .order("started_at", { ascending: false })
        .order("id")
        .range(page * 500, page * 500 + 499);
      if (error)
        throw Object.assign(Error(error.message), { code: error.code });
      rows.push(...(data as Session[]));
      if (data.length < 500) break;
    }
    for (const s of rows)
      s.segments.sort(
        (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at),
      );
    return rows;
  }
  manage(entity: string, p: Record<string, unknown>) {
    return this.rpc<Row>("manage", { p_entity: entity, p });
  }
}
export interface Persistence {
  read(key: string): Promise<CachedState | null>;
  write(key: string, state: CachedState): Promise<void>;
  remove(key: string): Promise<void>;
}
export const persistence: Persistence = {
  async read(key) {
    return (
      ((await transaction("readonly", (s) =>
        s.get(key),
      )) as CachedState | null) ?? null
    );
  },
  async write(key, state) {
    await transaction("readwrite", (s) => s.put(state, key));
  },
  async remove(key) {
    await transaction("readwrite", (s) => s.delete(key));
  },
};
function transaction(
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("lechic-manufacturing-v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("state");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("state", mode);
      const req = action(tx.objectStore("state"));
      tx.oncomplete = () => {
        resolve(req.result);
        db.close();
      };
      tx.onerror = () => {
        reject(tx.error);
        db.close();
      };
      tx.onabort = () => {
        reject(tx.error ?? Error("Storage interrupted"));
        db.close();
      };
    };
  });
}
export class SessionStore {
  state: CachedState | null = null;
  syncing = false;
  onPersist?: () => void;
  constructor(
    public api: Api,
    public uid: string,
    private disk: Persistence = persistence,
  ) {}
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.locks)
      return navigator.locks.request("manufacturing-" + this.uid, fn);
    if (typeof window !== "undefined")
      throw Error(
        "This browser cannot safely record work. Use an updated browser with a secure connection.",
      );
    const prior = localLocks.get(this.uid) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(fn);
    localLocks.set(this.uid, next);
    return next;
  }
  async load() {
    const cached = await this.disk.read(this.uid);
    if (cached) this.state = cached;
    await this.refresh();
    return this.state;
  }
  async refresh() {
    return this.exclusive(async () => {
      this.state = (await this.disk.read(this.uid)) ?? this.state;
      try {
        const context = await this.api.rpc<Context>("app_context");
        const catalog = await this.api.catalog(context);
        // Refresh access even while offline events need review. Never retain a revoked catalog.
        if (this.state) {
          this.state.context = context;
          this.state.catalog = catalog;
          this.state.lastSync = new Date().toISOString();
          await this.disk.write(this.uid, this.state);
          if (this.state.queue.length) await this.syncUnlocked();
          if (this.state.conflict || this.state.queue.length) return this.state;
        }
        const session = await this.api.rpc<Session | null>("active_session");
        const next = {
          context,
          catalog,
          session:
            session ??
            (this.state?.session?.status === "completed"
              ? this.state.session
              : null),
          queue: [],
          lastSync: new Date().toISOString(),
        };
        await this.disk.write(this.uid, next);
        this.state = next;
      } catch (e) {
        if (!this.state) throw e;
        this.state.syncError =
          "Connection unavailable. Showing the last saved workspace.";
        if (hasCode(e, "PGRST301") || hasCode(e, "PGRST303")) {
          this.state.syncError =
            "Sign in again to sync. Your work is saved on this device.";
          throw e;
        }
        if (isDenial(e)) {
          this.state.context = {
            ...this.state.context,
            permissions: [],
            visibility: "OFF",
          };
          this.state.catalog = emptyCatalog();
          this.state.conflict = message(e);
          await this.disk.write(this.uid, this.state);
          throw e;
        }
      }
      return this.state;
    });
  }
  async start(
    activityId: string,
    productId: string | null,
    assignmentId: string | null,
  ) {
    return this.exclusive(async () => {
      this.state = (await this.disk.read(this.uid)) ?? this.state;
      if (!this.state) throw Error("Sign in first.");
      if (!allowed(this.state.context.permissions, "my_work.access"))
        throw Error("My work access is required to start a session.");
      if (this.state.session && this.state.session.status !== "completed")
        throw Error("You already have an active session.");
      if (this.state.queue.length || this.state.conflict)
        throw Error("Sync or resolve pending work first.");
      if (typeof navigator !== "undefined" && navigator.onLine === false)
        throw Error("Connect to start a new session.");
      const command: Command = {
        request_id: crypto.randomUUID(),
        session_id: crypto.randomUUID(),
        action: "start",
        at: new Date().toISOString(),
        expected_revision: 0,
        activity_id: activityId,
        product_id: productId,
        assignment_id: assignmentId,
      };
      // Write the request before sending; an uncertain network result must retry the same UUID.
      const next = { ...this.state, queue: [...this.state.queue, command] };
      await this.disk.write(this.uid, next);
      this.state = next;
      await this.syncUnlocked();
      if (this.state.queue.length)
        throw Error(
          "Start not confirmed yet. Reconnect and tap Sync to recover this exact request.",
        );
      return this.state.session;
    });
  }
  async command(
    action: "transition" | "finish" | "complete",
    values: Partial<Command> = {},
  ) {
    return this.exclusive(async () => {
      this.state = (await this.disk.read(this.uid)) ?? this.state;
      const state = this.state;
      if (!state?.session) throw Error("No active session.");
      if (state.conflict) throw Error("Resolve the sync conflict first.");
      const command: Command = {
        ...values,
        request_id: crypto.randomUUID(),
        session_id: state.session.id,
        action,
        at: new Date().toISOString(),
        expected_revision: state.session.revision,
      };
      const updated = applyCommand(state.session, command);
      const next = {
        ...state,
        session: updated,
        queue: [...state.queue, command],
      };
      await this.disk.write(this.uid, next);
      this.state = next;
      this.onPersist?.();
      await this.syncUnlocked();
      return this.state.session;
    });
  }
  async sync() {
    return this.exclusive(async () => {
      this.state = (await this.disk.read(this.uid)) ?? this.state;
      await this.syncUnlocked();
    });
  }
  private async syncUnlocked() {
    if (!this.state || this.syncing || this.state.conflict) return;
    let state: CachedState = this.state;
    this.syncing = true;
    try {
      while (state.queue.length) {
        const command = state.queue[0];
        try {
          const server = await this.api.rpc<Session>("session_command", {
            p: command,
          });
          const queue = state.queue.slice(1);
          const session = queue.reduce((s, c) => applyCommand(s, c), server);
          const next: CachedState = {
            ...state,
            queue,
            session,
            lastSync: new Date().toISOString(),
            syncError: undefined,
          };
          await this.disk.write(this.uid, next);
          state = next;
          this.state = next;
        } catch (e) {
          if (
            isDenial(e) ||
            hasCode(e, "40001") ||
            hasCode(e, "22023") ||
            hasCode(e, "P0001") ||
            hasCode(e, "23505") ||
            hasCode(e, "23514")
          ) {
            if (isDenial(e)) {
              state.context = {
                ...state.context,
                permissions: [],
                visibility: "OFF",
              };
              state.catalog = emptyCatalog();
            }
            state.conflict = message(e);
            await this.disk.write(this.uid, state);
          } else {
            state.syncError =
              hasCode(e, "PGRST301") || hasCode(e, "PGRST303")
                ? "Sign in again to sync. Your pending work is saved on this device."
                : "Work is saved on this device. Sync will retry when the connection is available.";
          }
          break;
        }
      }
    } finally {
      this.syncing = false;
    }
  }
  async recoverServer() {
    return this.exclusive(async () => {
      const state = await this.disk.read(this.uid);
      if (!state) return;
      const session = await this.api.rpc<Session | null>("active_session");
      // Retain an audit copy of pending events before explicitly accepting the server version.
      await this.disk.write(this.uid + ":recovery:" + Date.now(), state);
      const next = {
        ...state,
        session,
        queue: [],
        conflict: undefined,
        syncError: undefined,
      };
      await this.disk.write(this.uid, next);
      this.state = next;
    });
  }
  async clearCompleted() {
    await this.exclusive(async () => {
      this.state = (await this.disk.read(this.uid)) ?? this.state;
      if (
        this.state?.session?.status === "completed" &&
        !this.state.queue.length
      ) {
        const next = { ...this.state, session: null };
        await this.disk.write(this.uid, next);
        this.state = next;
      }
    });
    await this.refresh();
  }
  async signOut(signOut: () => Promise<void>) {
    return this.exclusive(async () => {
      const state = (await this.disk.read(this.uid)) ?? this.state;
      if (state?.queue.length)
        throw Error(
          "Sync pending work before signing out. If your sign-in expired, sign in again without clearing this device.",
        );
      await signOut();
      // Keep the user-scoped cache: another open tab may still have pending work.
    });
  }
}
const localLocks = new Map<string, Promise<unknown>>();
function hasCode(e: unknown, code: string) {
  return !!e && typeof e === "object" && "code" in e && e.code === code;
}
function isDenial(e: unknown) {
  return hasCode(e, "42501");
}
export function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

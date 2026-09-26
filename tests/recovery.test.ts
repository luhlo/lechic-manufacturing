import { expect, test } from "vitest";
import {
  Api,
  SessionStore,
  emptyCatalog,
  type Persistence,
} from "../lib/manufacturing/api";
import { applyCommand } from "../lib/manufacturing/domain";
import type {
  CachedState,
  Command,
  Context,
  Session,
} from "../lib/manufacturing/types";
const context: Context = {
  profile: {
    id: "e",
    name: "Worker",
    email: "e@example.invalid",
    auth_user_id: "u",
    position_id: "p",
    active: true,
  },
  permissions: [],
  visibility: "OFF",
};
const fresh = (): Session => ({
  id: "s",
  employee_id: "e",
  position_id: "p",
  activity_id: "a",
  product_id: "d",
  assignment_id: null,
  employee_name: "Worker",
  position_name: "p",
  activity_name: "a",
  product_name: "d",
  sku: "D",
  started_at: new Date(Date.now() - 1000).toISOString(),
  ended_at: null,
  status: "running",
  quantity: null,
  revision: 1,
  segments: [
    {
      id: "g",
      session_id: "s",
      kind: "WORK",
      started_at: new Date(Date.now() - 1000).toISOString(),
      ended_at: null,
    },
  ],
});
class Network extends Api {
  online = true;
  server: Session | null = fresh();
  receipts = new Map<string, Session>();
  uncertain = false;
  calls = 0;
  constructor() {
    super(null as never);
  }
  async catalog() {
    return emptyCatalog();
  }
  async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.online) throw TypeError("Failed to fetch");
    if (name === "app_context") return context as T;
    if (name === "active_session")
      return (this.server?.status === "completed" ? null : this.server) as T;
    if (name === "session_command") {
      this.calls++;
      const c = args!.p as Command;
      if (this.receipts.has(c.request_id))
        return this.receipts.get(c.request_id) as T;
      if (c.action === "start") {
        this.server = {
          ...fresh(),
          id: c.session_id,
          segments: [{ ...fresh().segments[0], session_id: c.session_id }],
        };
      } else {
        if (c.expected_revision !== this.server?.revision)
          throw Object.assign(Error("Conflict"), { code: "40001" });
        this.server = applyCommand(this.server, c);
      }
      this.receipts.set(c.request_id, this.server);
      if (this.uncertain) {
        this.uncertain = false;
        throw TypeError("Response lost after commit");
      }
      return this.server as T;
    }
    throw Error("Unknown");
  }
}
function disk() {
  const map = new Map<string, CachedState>();
  const storage: Persistence = {
    async read(k) {
      return structuredClone(map.get(k) ?? null);
    },
    async write(k, s) {
      map.set(k, structuredClone(s));
    },
    async remove(k) {
      map.delete(k);
    },
  };
  return { storage, map };
}
test("offline transitions persist and replay after a fresh app instance", async () => {
  const api = new Network(),
    d = disk();
  const s = new SessionStore(api, "u", d.storage);
  await s.load();
  api.online = false;
  await s.command("transition", { kind: "WALKING" });
  await s.command("transition", { kind: "WORK" });
  const reopened = new SessionStore(api, "u", d.storage);
  await reopened.load();
  expect(reopened.state?.queue).toHaveLength(2);
  expect(reopened.state?.session?.segments.at(-1)?.kind).toBe("WORK");
  api.online = true;
  await reopened.sync();
  expect(reopened.state?.queue).toHaveLength(0);
  expect(api.server?.segments).toHaveLength(3);
});
test("a response lost after server commit retries the same operation without duplication", async () => {
  const api = new Network(),
    d = disk(),
    s = new SessionStore(api, "u", d.storage);
  await s.load();
  api.uncertain = true;
  await s.command("transition", { kind: "WALKING" });
  expect(s.state?.queue).toHaveLength(1);
  await s.sync();
  expect(s.state?.queue).toHaveLength(0);
  expect(api.server?.segments).toHaveLength(2);
  expect(api.receipts.size).toBe(1);
});
test("uncertain start is durable and reuses the original session ID", async () => {
  const api = new Network();
  api.server = null;
  const d = disk(),
    s = new SessionStore(api, "u", d.storage);
  await s.load();
  api.uncertain = true;
  await expect(s.start("a", "d", null)).rejects.toThrow("not confirmed");
  const sid = s.state?.queue[0].session_id;
  const reopened = new SessionStore(api, "u", d.storage);
  await reopened.load();
  expect(reopened.state?.session?.id).toBe(sid);
  expect(api.receipts.size).toBe(1);
  expect(reopened.state?.queue).toHaveLength(0);
});
test("stale-device conflict preserves events and requires deliberate recovery", async () => {
  const api = new Network(),
    d = disk(),
    s = new SessionStore(api, "u", d.storage);
  await s.load();
  api.online = false;
  await s.command("transition", { kind: "WALKING" });
  api.server = applyCommand(api.server!, {
    request_id: "other",
    session_id: "s",
    action: "transition",
    at: new Date().toISOString(),
    expected_revision: 1,
    kind: "INTERRUPTION",
  });
  api.online = true;
  await s.sync();
  expect(s.state?.conflict).toBe("Conflict");
  expect(s.state?.queue).toHaveLength(1);
  await expect(s.command("finish")).rejects.toThrow("Resolve");
  await s.recoverServer();
  expect(s.state?.session?.segments.at(-1)?.kind).toBe("INTERRUPTION");
  expect([...d.map.keys()].some((k) => k.includes(":recovery:"))).toBe(true);
});
test("storage failure prevents a transition being presented as durable", async () => {
  const api = new Network(),
    d = disk(),
    s = new SessionStore(api, "u", d.storage);
  await s.load();
  d.storage.write = async () => {
    throw Error("Quota exceeded");
  };
  await expect(s.command("transition", { kind: "WALKING" })).rejects.toThrow(
    "Quota",
  );
  expect(s.state?.session?.segments).toHaveLength(1);
  expect(api.server?.segments).toHaveLength(1);
});
test("offline finish and completion preserve the stopped timestamp and exact quantity", async () => {
  const api = new Network(),
    d = disk(),
    s = new SessionStore(api, "u", d.storage);
  await s.load();
  api.online = false;
  await s.command("finish");
  const end = s.state?.session?.ended_at;
  await s.command("complete", { quantity: 23 });
  api.online = true;
  await s.sync();
  expect(api.server?.ended_at).toBe(end);
  expect(api.server?.quantity).toBe(23);
  expect(api.server?.status).toBe("completed");
});
test("cache is scoped to the authenticated user", async () => {
  const api = new Network(),
    d = disk();
  await new SessionStore(api, "u", d.storage).load();
  api.online = false;
  await expect(
    new SessionStore(api, "another", d.storage).load(),
  ).rejects.toThrow();
});

test("successful reads never discard an unacknowledged write", async () => {
  const api = new Network(),
    d = disk(),
    s = new SessionStore(api, "u", d.storage);
  await s.load();
  const rpc = api.rpc.bind(api);
  api.rpc = async (name, args) => {
    if (name === "session_command")
      throw TypeError("Write endpoint unavailable");
    return rpc(name, args);
  };
  await s.command("transition", { kind: "WALKING" });
  await s.refresh();
  expect(s.state?.queue).toHaveLength(1);
  expect(s.state?.session?.segments.at(-1)?.kind).toBe("WALKING");
});
test("storage failure during start leaves neither a phantom queue nor a server request", async () => {
  const api = new Network(),
    d = disk(),
    s = new SessionStore(api, "u", d.storage);
  api.server = null;
  await s.load();
  d.storage.write = async () => {
    throw Error("Quota exceeded");
  };
  await expect(s.start("a", "d", null)).rejects.toThrow("Quota");
  expect(s.state?.queue).toHaveLength(0);
  expect(api.calls).toBe(0);
});
test("a second start cannot replace an existing session", async () => {
  const api = new Network(),
    d = disk(),
    s = new SessionStore(api, "u", d.storage);
  await s.load();
  await expect(s.start("a", "d", null)).rejects.toThrow("active session");
  expect(api.calls).toBe(0);
});
test("failed persistence of acknowledgement retains the same retry identifier", async () => {
  const api = new Network(),
    d = disk(),
    s = new SessionStore(api, "u", d.storage);
  await s.load();
  const write = d.storage.write;
  d.storage.write = async (k, state) => {
    if (!state.queue.length) throw Error("Quota exceeded");
    return write(k, state);
  };
  await s.command("transition", { kind: "WALKING" });
  expect(s.state?.queue).toHaveLength(1);
  d.storage.write = write;
  await s.sync();
  expect(s.state?.queue).toHaveLength(0);
  expect(api.receipts.size).toBe(1);
});
test("expired authentication keeps pending events retryable", async () => {
  const api = new Network(),
    d = disk(),
    s = new SessionStore(api, "u", d.storage);
  await s.load();
  const rpc = api.rpc.bind(api);
  api.rpc = async (name, args) => {
    if (name === "session_command")
      throw Object.assign(Error("JWT expired"), { code: "PGRST301" });
    return rpc(name, args);
  };
  await s.command("finish");
  expect(s.state?.queue).toHaveLength(1);
  expect(s.state?.conflict).toBeUndefined();
  api.rpc = rpc;
  await s.sync();
  expect(api.server?.status).toBe("awaiting_quantity");
});
test("two tabs serialize rapid start and transitions", async () => {
  const api = new Network(),
    d = disk();
  api.server = null;
  const a = new SessionStore(api, "u", d.storage),
    b = new SessionStore(api, "u", d.storage);
  await a.load();
  await b.load();
  const starts = await Promise.allSettled([
    a.start("a", "d", null),
    b.start("a", "d", null),
  ]);
  expect(starts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  const moves = await Promise.allSettled([
    a.command("transition", { kind: "WALKING" }),
    b.command("transition", { kind: "WALKING" }),
  ]);
  expect(moves.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect((api.server as Session | null)?.segments).toHaveLength(2);
});
test("clearing an old completed screen cannot erase a newer tab's session", async () => {
  const api = new Network(),
    d = disk(),
    a = new SessionStore(api, "u", d.storage),
    b = new SessionStore(api, "u", d.storage);
  await a.load();
  await a.command("finish");
  await a.command("complete", { quantity: 0 });
  await b.load();
  await b.start("a", "d", null);
  const id = api.server?.id;
  await a.clearCompleted();
  expect(a.state?.session?.id).toBe(id);
});
test("automatic refresh keeps the completed receipt visible until Next activity", async () => {
  const api = new Network(),
    d = disk(),
    s = new SessionStore(api, "u", d.storage);
  await s.load();
  await s.command("finish");
  await s.command("complete", { quantity: 7 });
  await s.refresh();
  expect(s.state?.session?.quantity).toBe(7);
  await s.clearCompleted();
  expect(s.state?.session).toBeNull();
});
test("authorization revocation removes cached management access without deleting pending work", async () => {
  const api = new Network(),
    d = disk(),
    s = new SessionStore(api, "u", d.storage);
  await s.load();
  s.state!.context.permissions = ["*"];
  await d.storage.write("u", s.state!);
  const rpc = api.rpc.bind(api);
  api.rpc = async (name, args) => {
    if (name === "session_command")
      throw Object.assign(Error("Inactive account"), { code: "42501" });
    return rpc(name, args);
  };
  await s.command("finish");
  expect(s.state?.queue).toHaveLength(1);
  expect(s.state?.context.permissions).toEqual([]);
  expect(s.state?.catalog.profiles).toEqual([]);
  expect(s.state?.conflict).toBe("Inactive account");
});

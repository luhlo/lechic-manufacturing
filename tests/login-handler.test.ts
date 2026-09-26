import { describe, expect, test } from "vitest";
import {
  createLoginHandler,
  digest,
} from "../supabase/functions/manufacturing-login/handler";

const userId = "20000000-0000-4000-8000-000000000002";
const actorId = "20000000-0000-4000-8000-000000000001";
const deviceToken = "c".repeat(64);
const config = {
  url: "https://backend.example.invalid",
  serviceKey: "server-only-test-secret",
  anonKey: "public-test-key",
};
type Json = Record<string, unknown>;
type Call = { path: string; body: Json; headers: Headers };
type Override = (call: Call) => Response | undefined;
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fixture(override?: Override) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url).replace(config.url, "");
    const call = {
      path,
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    const changed = override?.(call);
    if (changed) return changed;
    if (path === "/rest/v1/rpc/login_gateway") {
      if (call.body.action === "credential_status")
        return response({
          username: "worker",
          user_id: userId,
          pin_enabled: true,
        });
      if (call.body.action === "approve_device")
        return response({
          id: "device-id",
          name: "Studio",
          expires_at: "2099-01-01",
        });
      if (call.body.action === "devices") return response([]);
      if (call.body.action === "credentials") return response({ ok: true });
      return response({ user_id: userId });
    }
    if (path.startsWith("/auth/v1/admin/users/"))
      return response({
        id: userId,
        email: "worker@example.invalid",
        email_confirmed_at: "2026-01-01",
        factors: [],
      });
    if (path === "/auth/v1/admin/generate_link")
      return response({ id: userId, hashed_token: "one-time-hash" });
    if (path === "/auth/v1/verify" || path.startsWith("/auth/v1/token?"))
      return response({
        access_token: "access",
        refresh_token: "refresh",
        user: { id: userId, email: "worker@example.invalid" },
      });
    if (path === "/auth/v1/user") return response({ id: actorId });
    throw Error("Unexpected endpoint: " + path);
  };
  return { calls, handler: createLoginHandler(config, fetcher) };
}
function token(method = "password", sub = actorId) {
  return (
    "test." + btoa(JSON.stringify({ sub, amr: [{ method }] })) + ".signature"
  );
}
function request(
  body: Json,
  bearer?: string,
  origin = "https://lcwork.luhlo.com",
) {
  return new Request("https://function.example.invalid", {
    method: "POST",
    headers: {
      origin,
      "Content-Type": "application/json",
      ...(bearer ? { authorization: "Bearer " + bearer } : {}),
    },
    body: JSON.stringify(body),
  });
}
describe("PIN sign-in trust boundaries", () => {
  test("requires an approved device and exchanges a token only for the identified existing user", async () => {
    const { handler, calls } = fixture();
    const result = await handler(
      request({ action: "pin", pin: "0123", device_token: deviceToken }),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      access_token: "access",
      refresh_token: "refresh",
    });
    expect(result.headers.get("cache-control")).toBe("no-store");
    const payload = calls[0].body.payload as Json;
    expect(payload.device_digest).toBe(await digest(deviceToken));
    expect(payload.pin_digest).toBe(
      await digest("pin:v1:0123", config.serviceKey),
    );
    expect(JSON.stringify(calls)).not.toContain("0123");
    expect(calls.map((c) => c.path)).toEqual([
      "/rest/v1/rpc/login_gateway",
      "/auth/v1/admin/users/" + userId,
      "/auth/v1/admin/generate_link",
      "/auth/v1/verify",
    ]);
    expect(calls[2].body).toEqual({
      type: "recovery",
      email: "worker@example.invalid",
    });
    expect(calls[3].body).toEqual({
      type: "recovery",
      token_hash: "one-time-hash",
    });
    // No signup, invitation, email delivery or password-change endpoint is used.
  });
  test.each(["123", "12345", "abcd"])(
    "rejects malformed PIN %s before backend work",
    async (pin) => {
      const { handler, calls } = fixture();
      expect(
        (
          await handler(
            request({ action: "pin", pin, device_token: deviceToken }),
          )
        ).status,
      ).toBe(401);
      expect(calls).toHaveLength(0);
    },
  );
  test.each([
    ["device_unapproved", 403],
    ["device_locked", 429],
    ["invalid_pin", 401],
  ] as const)("does not contact Auth when %s", async (error, status) => {
    const { handler, calls } = fixture(() => response({ error }));
    expect(
      (
        await handler(
          request({ action: "pin", pin: "0123", device_token: deviceToken }),
        )
      ).status,
    ).toBe(status);
    expect(calls).toHaveLength(1);
  });
  test.each([
    { id: userId, email: "worker@example.invalid" },
    {
      id: userId,
      email: "worker@example.invalid",
      email_confirmed_at: "2026-01-01",
      banned_until: "2099-01-01",
    },
    {
      id: "wrong-user",
      email: "worker@example.invalid",
      email_confirmed_at: "2026-01-01",
    },
    {
      id: userId,
      email: "worker@example.invalid",
      email_confirmed_at: "2026-01-01",
      factors: [{ status: "verified" }],
    },
  ])("does not mint a PIN session for an ineligible account", async (user) => {
    const { handler, calls } = fixture((call) =>
      call.path.startsWith("/auth/v1/admin/users/")
        ? response(user)
        : undefined,
    );
    expect(
      (
        await handler(
          request({ action: "pin", pin: "0123", device_token: deviceToken }),
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(calls.some((c) => c.path === "/auth/v1/admin/generate_link")).toBe(
      false,
    );
  });
  test.each(["/auth/v1/admin/generate_link", "/auth/v1/verify"])(
    "rejects an account mismatch from %s",
    async (path) => {
      const { handler } = fixture((call) =>
        call.path === path
          ? response({
              id: "wrong-user",
              hashed_token: "hash",
              access_token: "bad",
              refresh_token: "bad",
              user: { id: "wrong-user" },
            })
          : undefined,
      );
      const result = await handler(
        request({ action: "pin", pin: "0123", device_token: deviceToken }),
      );
      expect(result.status).toBe(502);
      expect(await result.text()).not.toContain("access_token");
    },
  );
});
describe("username sign-in", () => {
  test("normalizes username, verifies the existing password, and returns only session tokens", async () => {
    const { handler, calls } = fixture();
    const result = await handler(
      request({
        action: "username",
        username: "  Worker.One ",
        password: "existing password",
      }),
    );
    expect(result.status).toBe(200);
    expect(calls[0].body.payload).toMatchObject({ username: "worker.one" });
    expect(calls.at(-1)?.body).toEqual({
      email: "worker@example.invalid",
      password: "existing password",
    });
    expect(await result.json()).toEqual({
      access_token: "access",
      refresh_token: "refresh",
    });
  });
  test("unknown and incorrect credentials have the same public error", async () => {
    const missing = fixture((c) =>
      c.path.endsWith("/login_gateway")
        ? response({ user_id: null })
        : c.path.startsWith("/auth/v1/token?")
          ? response({}, 400)
          : undefined,
    );
    const incorrect = fixture((c) =>
      c.path.startsWith("/auth/v1/token?") ? response({}, 400) : undefined,
    );
    const body = { action: "username", username: "worker", password: "wrong" };
    const a = await missing.handler(request(body)),
      b = await incorrect.handler(request(body));
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
    expect(missing.calls.at(-1)?.body.email).toBe(
      "unavailable-account@example.invalid",
    );
  });
  test("stops password calls when rate limited", async () => {
    const { handler, calls } = fixture(() =>
      response({ error: "rate_limited" }),
    );
    expect(
      (
        await handler(
          request({
            action: "username",
            username: "worker",
            password: "wrong",
          }),
        )
      ).status,
    ).toBe(429);
    expect(calls).toHaveLength(1);
  });
});
describe("manager authentication", () => {
  test("rejects an invalid session before the service-role gateway", async () => {
    const { handler, calls } = fixture((c) =>
      c.path === "/auth/v1/user" ? response({}, 401) : undefined,
    );
    expect(
      (await handler(request({ action: "devices", actor: actorId }, token())))
        .status,
    ).toBe(401);
    expect(calls).toHaveLength(1);
  });
  test.each(["otp", "magiclink", "recovery"])(
    "a %s session cannot approve devices or change credentials",
    async (method) => {
      const { handler, calls } = fixture();
      expect(
        (
          await handler(
            request(
              { action: "approve_device", name: "Studio" },
              token(method),
            ),
          )
        ).status,
      ).toBe(403);
      expect(calls).toHaveLength(1);
    },
  );
  test("rejects token subject mismatch", async () => {
    const { handler, calls } = fixture();
    expect(
      (await handler(request({ action: "devices" }, token("password", userId))))
        .status,
    ).toBe(401);
    expect(calls).toHaveLength(1);
  });
  test("derives actor from the verified token, checks permissions, and hides raw PINs from the database", async () => {
    const { handler, calls } = fixture();
    const result = await handler(
      request(
        {
          action: "credentials",
          actor: userId,
          profile_id: userId,
          username: "WORKER",
          pin: "0123",
        },
        token(),
      ),
    );
    expect(result.status).toBe(200);
    const dbCalls = calls.filter((c) => c.path.endsWith("/login_gateway"));
    expect(dbCalls.every((c) => c.body.actor === actorId)).toBe(true);
    expect(dbCalls.at(-1)?.body.payload).toEqual({
      profile_id: userId,
      username: "worker",
      disable_pin: false,
      pin_digest: await digest("pin:v1:0123", config.serviceKey),
    });
    expect(JSON.stringify(calls)).not.toContain("0123");
  });
  test("database permission denial cannot be bypassed by a valid password token", async () => {
    const { handler } = fixture((c) =>
      c.path.endsWith("/login_gateway")
        ? response({ code: "42501" }, 403)
        : undefined,
    );
    expect(
      (await handler(request({ action: "devices" }, token()))).status,
    ).toBe(403);
  });
  test("returns a new random device secret once, storing only its hash", async () => {
    const { handler, calls } = fixture();
    const result = await handler(
      request({ action: "approve_device", name: "Studio" }, token()),
    );
    const device = await result.json();
    expect(device.token).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.at(-1)?.body.payload).toEqual({
      name: "Studio",
      device_digest: await digest(device.token),
    });
    expect(JSON.stringify(calls)).not.toContain(device.token);
  });
  test("status reveals availability without exposing the Auth user ID", async () => {
    const { handler } = fixture();
    const result = await handler(
      request({ action: "credential_status", profile_id: userId }, token()),
    );
    expect(await result.json()).toEqual({
      username: "worker",
      pin_enabled: true,
      account_ready: true,
    });
  });
});
test("rejects disallowed origins and oversized streamed bodies before any backend calls", async () => {
  const { handler, calls } = fixture();
  const disallowed = await handler(
    request(
      { action: "devices" },
      token(),
      "https://unrelated.example.invalid",
    ),
  );
  expect(disallowed.status).toBe(403);
  expect(disallowed.headers.has("access-control-allow-origin")).toBe(false);
  const large = await handler(
    request({
      action: "username",
      username: "worker",
      password: "x".repeat(5000),
    }),
  );
  expect(large.status).toBe(413);
  expect(calls).toHaveLength(0);
});

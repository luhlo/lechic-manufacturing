export interface LoginConfig {
  url: string;
  serviceKey: string;
  anonKey: string;
}
type Json = Record<string, unknown>;
const origins = new Set([
  "https://lcwork.luhlo.com",
  "https://luhlo.github.io",
  "https://lechic-manufacturing.alejoc.chatgpt.site",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5176",
]);
const usernamePattern = /^[a-z][a-z0-9._-]{2,31}$/;
const devicePattern = /^[0-9a-f]{64}$/;
class LoginError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function digest(value: string, secret?: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const result = secret
    ? await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
        bytes,
      )
    : await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function createLoginHandler(
  config: LoginConfig,
  fetcher: typeof fetch = fetch,
) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (origin && origins.has(origin))
      headers["Access-Control-Allow-Origin"] = origin;
    const respond = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !origins.has(origin))
      return respond({ error: "This app address is not allowed." }, 403);
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return respond({ error: "Use POST." }, 405);
    try {
      // Bound reads, including requests that omit or falsify Content-Length.
      const reader = req.body?.getReader();
      let raw = "";
      let size = 0;
      if (reader) {
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4096) {
            await reader.cancel();
            throw new LoginError(413, "Request too large.");
          }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      }
      let body: Json;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new LoginError(400, "Invalid request.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new LoginError(400, "Invalid request.");
      const action = String(body.action ?? "");
      const call = async (
        path: string,
        data: unknown,
        token = config.serviceKey,
        method = "POST",
      ) => {
        const r = await fetcher(config.url + path, {
          method,
          headers: {
            "X-Supabase-Api-Version": "2024-01-01",
            apikey: config.serviceKey,
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          ...(method === "GET" ? {} : { body: JSON.stringify(data) }),
        });
        const result = await r.json();
        return { ok: r.ok, status: r.status, data: result };
      };
      const gateway = async (
        operation: string,
        payload: Json,
        actor?: string,
      ) => {
        const r = await call("/rest/v1/rpc/login_gateway", {
          action: operation,
          payload,
          actor: actor ?? null,
        });
        if (!r.ok) {
          if (r.data.code === "23505")
            throw new LoginError(
              409,
              "That username or PIN is already in use. Choose another.",
            );
          if (r.data.code === "42501")
            throw new LoginError(
              403,
              "You do not have permission to manage these login settings.",
            );
          throw new LoginError(
            400,
            "Could not save login settings. Check the employee account and try again.",
          );
        }
        return r.data;
      };
      const existingUser = async (id: string) => {
        const r = await call(
          "/auth/v1/admin/users/" + encodeURIComponent(id),
          null,
          config.serviceKey,
          "GET",
        );
        if (
          !r.ok ||
          r.data.id !== id ||
          !r.data.email ||
          !r.data.email_confirmed_at ||
          r.data.is_anonymous ||
          (r.data.banned_until && Date.parse(r.data.banned_until) > Date.now())
        )
          throw new LoginError(
            401,
            "The employee must finish creating and confirming their account first.",
          );
        return r.data;
      };
      const sessionResponse = (data: Json) => {
        if (
          typeof data.access_token !== "string" ||
          typeof data.refresh_token !== "string"
        )
          throw new LoginError(
            502,
            "Sign-in could not be completed. Please try again.",
          );
        return respond({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
      };
      if (action === "username") {
        const username = String(body.username ?? "")
          .trim()
          .toLowerCase();
        if (
          !usernamePattern.test(username) ||
          typeof body.password !== "string" ||
          !body.password ||
          body.password.length > 1024
        )
          throw new LoginError(401, "Username or password is incorrect.");
        const record = await gateway("username", {
          username,
          bucket: await digest("username:" + username, config.serviceKey),
        });
        if (record.error === "rate_limited")
          throw new LoginError(
            429,
            "Too many attempts. Try again in 15 minutes or use your email.",
          );
        let email = "unavailable-account@example.invalid";
        if (record.user_id) {
          try {
            const user = await existingUser(record.user_id);
            email = user.email;
          } catch {
            /* Use the same credential error and password verification path. */
          }
        }
        const r = await call(
          "/auth/v1/token?grant_type=password",
          { email, password: body.password },
          config.anonKey,
        );
        if (!record.user_id || !r.ok || r.data.user?.id !== record.user_id)
          throw new LoginError(401, "Username or password is incorrect.");
        return sessionResponse(r.data);
      }
      if (action === "pin") {
        if (
          !/^\d{4}$/.test(String(body.pin ?? "")) ||
          !devicePattern.test(String(body.device_token ?? ""))
        )
          throw new LoginError(
            401,
            "Use an approved studio device and enter your four-digit PIN.",
          );
        const record = await gateway("pin", {
          device_digest: await digest(String(body.device_token)),
          pin_digest: await digest("pin:v1:" + body.pin, config.serviceKey),
        });
        if (record.error === "device_locked")
          throw new LoginError(
            429,
            "PIN sign-in is locked on this device. Ask a manager to sign in with a password and approve it again.",
          );
        if (record.error === "device_unapproved")
          throw new LoginError(
            403,
            "This device needs manager approval for PIN sign-in.",
          );
        if (!record.user_id)
          throw new LoginError(401, "PIN not recognized. Please try again.");
        const user = await existingUser(record.user_id);
        if (
          user.factors?.some((f: { status: string }) => f.status === "verified")
        )
          throw new LoginError(
            403,
            "Use email or username and password for an account with two-factor authentication.",
          );
        // generate_link does not send mail. The recovery type requires an existing
        // account, even if it was deleted after our eligibility check. Exchange it
        // server-side without changing a password or navigating through a reset URL.
        const link = await call("/auth/v1/admin/generate_link", {
          type: "recovery",
          email: user.email,
        });
        if (
          !link.ok ||
          link.data.id !== record.user_id ||
          typeof link.data.hashed_token !== "string"
        )
          throw new LoginError(
            502,
            "PIN sign-in is temporarily unavailable. Use your password.",
          );
        const verified = await call(
          "/auth/v1/verify",
          { type: "recovery", token_hash: link.data.hashed_token },
          config.anonKey,
        );
        if (!verified.ok || verified.data.user?.id !== record.user_id)
          throw new LoginError(
            502,
            "PIN sign-in could not be completed. Use your password.",
          );
        return sessionResponse(verified.data);
      }
      if (
        ![
          "credential_status",
          "credentials",
          "devices",
          "approve_device",
          "revoke_device",
          "create_account",
        ].includes(action)
      )
        throw new LoginError(400, "Invalid request.");
      const token =
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
      const verified = await call("/auth/v1/user", null, token, "GET");
      if (!token || !verified.ok || !verified.data.id)
        throw new LoginError(
          401,
          "Sign in with your password to manage login settings.",
        );
      // Decode only after the Auth server validates this exact token.
      let claims: Json = {};
      try {
        const segment = token
          .split(".")[1]
          .replace(/-/g, "+")
          .replace(/_/g, "/");
        claims = JSON.parse(atob(segment));
      } catch {
        throw new LoginError(401, "Sign in again with your password.");
      }
      if (claims.sub !== verified.data.id)
        throw new LoginError(401, "Sign in again with your password.");
      if (
        !Array.isArray(claims.amr) ||
        !claims.amr.some((m: { method?: string }) => m.method === "password")
      )
        throw new LoginError(
          403,
          "Sign out and sign in with your password to manage login settings.",
        );
      const actor = verified.data.id;
      if (action === "create_account") {
        if (
          typeof body.profile_id !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(body.profile_id)
        )
          throw new LoginError(400, "Choose an employee.");
        if (
          typeof body.password !== "string" ||
          body.password.length < 10 ||
          new TextEncoder().encode(body.password).length > 72
        )
          throw new LoginError(
            400,
            "Use a password with at least 10 characters and at most 72 UTF-8 bytes.",
          );
        // Use the validated user's JWT for these reads so existing database RLS and
        // active-role checks remain authoritative. Never accept permissions or email
        // from the browser, and never return the employee's session to the manager.
        const context = await call("/rest/v1/rpc/app_context", {}, token);
        if (
          !context.ok ||
          context.data.profile?.auth_user_id !== actor ||
          !Array.isArray(context.data.permissions) ||
          !context.data.permissions.includes("*")
        )
          throw new LoginError(
            403,
            "Only an administrator can create accounts.",
          );
        const path =
          "/rest/v1/profiles?id=eq." +
          encodeURIComponent(body.profile_id) +
          "&select=id,email,active,auth_user_id";
        const record = await call(path, null, token, "GET");
        const profile =
          Array.isArray(record.data) && record.data.length === 1
            ? record.data[0]
            : null;
        if (
          !record.ok ||
          profile?.id !== body.profile_id ||
          !profile.active ||
          !profile.email
        )
          throw new LoginError(
            400,
            "Choose an active employee with an email address.",
          );
        if (profile.auth_user_id)
          throw new LoginError(
            409,
            "This employee already has an account. Refresh login options.",
          );
        const created = await call("/auth/v1/admin/users", {
          email: profile.email,
          password: body.password,
          email_confirm: true,
        });
        if (!created.ok) {
          if (
            created.data.code === "email_exists" ||
            created.data.error_code === "email_exists"
          )
            throw new LoginError(
              409,
              "An account already exists for this email. Refresh login options.",
            );
          throw new LoginError(
            400,
            "Could not create the account. Check the password and employee email, then refresh before retrying.",
          );
        }
        // The existing Auth trigger links only an active preauthorized profile.
        // On an uncertain response, preserve any created account instead of deleting
        // or overwriting it; a retry detects the existing link and cannot reset it.
        const linked = await call(path, null, token, "GET");
        if (
          !created.data.id ||
          !linked.ok ||
          linked.data?.[0]?.auth_user_id !== created.data.id
        )
          throw new LoginError(
            503,
            "The account may have been created. Refresh login options before trying again.",
          );
        return respond({ ok: true });
      }
      if (action === "credentials" || action === "credential_status") {
        if (
          typeof body.profile_id !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(body.profile_id)
        )
          throw new LoginError(400, "Choose an employee.");
        const status = await gateway(
          "credential_status",
          { profile_id: body.profile_id },
          actor,
        );
        if (action === "credential_status")
          return respond({
            username: status.username,
            pin_enabled: status.pin_enabled,
            account_ready: !!status.user_id,
          });
        const username = String(body.username ?? "")
          .trim()
          .toLowerCase();
        if (username && !usernamePattern.test(username))
          throw new LoginError(
            400,
            "Use 3–32 letters, numbers, dots, hyphens or underscores, starting with a letter.",
          );
        const payload: Json = {
          profile_id: body.profile_id,
          username,
          disable_pin: body.disable_pin === true,
        };
        if (body.pin && body.disable_pin !== true) {
          if (!/^\d{4}$/.test(String(body.pin)))
            throw new LoginError(400, "Enter exactly four digits.");
          if (!status.user_id)
            throw new LoginError(
              400,
              "An administrator must create this employee’s account first.",
            );
          const user = await existingUser(status.user_id);
          if (
            user.factors?.some(
              (f: { status: string }) => f.status === "verified",
            )
          )
            throw new LoginError(
              400,
              "Keep password sign-in for accounts with two-factor authentication.",
            );
          payload.pin_digest = await digest(
            "pin:v1:" + body.pin,
            config.serviceKey,
          );
        }
        return respond(await gateway("credentials", payload, actor));
      }
      if (action === "approve_device") {
        const name = String(body.name ?? "").trim();
        if (!name || name.length > 80)
          throw new LoginError(
            400,
            "Give this device a name (up to 80 characters).",
          );
        const token = devicePattern.test(String(body.device_token ?? ""))
          ? String(body.device_token)
          : Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");
        return respond({
          ...(await gateway(
            action,
            { name, device_digest: await digest(token) },
            actor,
          )),
          token,
        });
      }
      return respond(
        await gateway(
          action,
          action === "revoke_device" ? { id: body.id } : {},
          actor,
        ),
      );
    } catch (error) {
      if (error instanceof LoginError)
        return respond({ error: error.message }, error.status);
      // Never log request bodies, credentials, Auth responses or tokens.
      return respond(
        { error: "Sign-in service is temporarily unavailable. Try again." },
        503,
      );
    }
  };
}

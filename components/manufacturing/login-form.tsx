import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appHome } from "@/lib/manufacturing/routes";
import { message } from "@/lib/manufacturing/api";
import {
  loginWithPin,
  loginWithUsername,
  savedPinDevice,
} from "@/lib/manufacturing/login";
export function Auth({
  client,
  error,
}: {
  client: SupabaseClient | null;
  error: string;
}) {
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [device] = useState(savedPinDevice);
  const [method, setMethod] = useState<"password" | "pin">("pin");
  const [identifier, setIdentifier] = useState(""),
    [password, setPassword] = useState(""),
    [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const pinMode = mode === "login" && method === "pin";
  const attemptPin = async (value: string) => {
    if (!client || inFlight.current || !/^\d{4}$/.test(value)) return;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    try {
      await loginWithPin(client, value);
    } catch (e) {
      setNotice(message(e));
    } finally {
      setPin("");
      setBusy(false);
      inFlight.current = false;
    }
  };
  return (
    <>
      <p className="eyebrow">YOUR WORKSPACE</p>
      <h2>{mode === "reset" ? "Reset your password." : "Welcome back."}</h2>
      <p className="muted">
        {mode === "reset"
          ? "We’ll send a password reset link."
          : pinMode
            ? "Enter your PIN to start."
            : "Sign in to record your work."}
      </p>
      {!client && (
        <div className="notice">
          The database connection is unavailable. Please try again shortly.
        </div>
      )}
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {mode === "login" && (
        <div className="auth-methods" aria-label="Sign-in method">
          <button
            type="button"
            className={"button " + (method === "pin" ? "primary" : "")}
            aria-pressed={method === "pin"}
            disabled={busy}
            onClick={() => {
              setMethod("pin");
              setNotice("");
              setPassword("");
            }}
          >
            PIN
          </button>
          <button
            type="button"
            className={"button " + (method === "password" ? "primary" : "")}
            aria-pressed={method === "password"}
            disabled={busy}
            onClick={() => {
              setMethod("password");
              setNotice("");
              setPin("");
            }}
          >
            Email / username
          </button>
        </div>
      )}
      {pinMode ? (
        <>
          {
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void attemptPin(pin);
              }}
            >
              <label className="field">
                PIN
                <input
                  className="pin-input"
                  aria-label="PIN"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  minLength={4}
                  autoComplete="off"
                  required
                  value={pin}
                  disabled={busy || !device}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                    setPin(v);
                    if (v.length === 4) void attemptPin(v);
                  }}
                />
              </label>
              <button
                className="button primary"
                disabled={busy || !client || !device || pin.length !== 4}
              >
                {busy ? "Signing in…" : "Sign in with PIN"}
                <ArrowRight size={18} />
              </button>
            </form>
          }
          {!device && (
            <div className="notice">
              Ask a manager to sign in with their password and approve this
              device in Settings. Then you can use just your PIN.
            </div>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
        </>
      ) : (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!client || inFlight.current) return;
            inFlight.current = true;
            setBusy(true);
            setNotice("");
            try {
              const value = identifier.trim();
              if (mode === "reset") {
                const r = await client.auth.resetPasswordForEmail(value, {
                  redirectTo: appHome(location.origin),
                });
                if (r.error) throw r.error;
                setNotice("Check your email for the reset link.");
              } else if (value.includes("@")) {
                const r = await client.auth.signInWithPassword({
                  email: value,
                  password,
                });
                if (r.error) throw r.error;
              } else await loginWithUsername(client, value, password);
            } catch (e) {
              setNotice(message(e));
            } finally {
              setBusy(false);
              inFlight.current = false;
            }
          }}
        >
          <label className="field">
            {mode === "login" ? "Email or username" : "Email"}
            <input
              type={mode === "login" ? "text" : "email"}
              autoComplete={mode === "login" ? "username" : "email"}
              autoCapitalize="none"
              spellCheck={false}
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </label>
          {mode !== "reset" && (
            <label className="field">
              Password
              <input
                type="password"
                required
                minLength={1}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          <button className="button primary" disabled={busy || !client}>
            {busy
              ? "Please wait…"
              : mode === "reset"
                ? "Send reset link"
                : "Sign in"}
            <ArrowRight size={18} />
          </button>
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
        </form>
      )}
      <div className="auth-links">
        <button
          disabled={busy}
          onClick={() => {
            setMode(mode === "reset" ? "login" : "reset");
            setNotice("");
            setPin("");
            setPassword("");
          }}
        >
          {mode === "reset" ? "Back to sign in" : "Forgot password?"}
        </button>
      </div>
      <p className="muted tiny">
        Accounts are created by an administrator. Public registration is not
        available.
      </p>
    </>
  );
}

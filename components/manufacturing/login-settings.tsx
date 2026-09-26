import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  loginRequest,
  savedPinDevice,
  rememberPinDevice,
  forgetPinDevice,
  type PinDevice,
} from "@/lib/manufacturing/login";
import { message } from "@/lib/manufacturing/api";
import type { Row } from "@/lib/manufacturing/types";
interface CredentialStatus {
  username: string | null;
  pin_enabled: boolean;
  account_ready: boolean;
}
export function EmployeeLoginSettings({
  client,
  profile,
  refresh,
  canCreateAccount,
}: {
  client: SupabaseClient;
  profile: Row;
  refresh: () => Promise<void>;
  canCreateAccount: boolean;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [status, setStatus] = useState<CredentialStatus | null>(null),
    [username, setUsername] = useState(""),
    [pin, setPin] = useState(""),
    [disable, setDisable] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");
  const load = async () => {
    setOpen(true);
    setBusy(true);
    setError("");
    setStatus(null);
    setPin("");
    setDisable(false);
    setNewPassword("");
    setConfirmPassword("");
    setNotice("");
    try {
      const v = await loginRequest<CredentialStatus>(client, {
        action: "credential_status",
        profile_id: profile.id,
      });
      setStatus(v);
      setUsername(v.username ?? "");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="edit-button"
        onClick={() => void load()}
        aria-label={"Login options for " + profile.name}
      >
        Login options
      </button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) {
            setOpen(v);
            setPin("");
            setNewPassword("");
            setConfirmPassword("");
          }
        }}
      >
        <DialogContent className="editor-dialog">
          <DialogHeader>
            <DialogTitle>Login options: {profile.name}</DialogTitle>
            <DialogDescription>
              Manage this employee’s account, username and PIN. PINs work on
              approved studio devices.
            </DialogDescription>
          </DialogHeader>
          {busy && !status && <p>Loading…</p>}
          {status && !status.account_ready && canCreateAccount && (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setError("");
                setNotice("");
                if (newPassword !== confirmPassword) {
                  setError("The passwords do not match.");
                  return;
                }
                setBusy(true);
                try {
                  await loginRequest(client, {
                    action: "create_account",
                    profile_id: profile.id,
                    password: newPassword,
                  });
                  setStatus(
                    await loginRequest<CredentialStatus>(client, {
                      action: "credential_status",
                      profile_id: profile.id,
                    }),
                  );
                  await refresh();
                  setNotice(
                    "Account created. The employee can sign in with their email and password. You can assign a username and PIN below.",
                  );
                } catch (e) {
                  setError(message(e));
                } finally {
                  setNewPassword("");
                  setConfirmPassword("");
                  setBusy(false);
                }
              }}
            >
              <h3>Create login account</h3>
              <p className="muted">
                Email: {String(profile.email)}. No invitation email will be
                sent. Share the credentials with the employee directly.
              </p>
              <label className="field">
                Initial password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={72}
                  disabled={busy}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <label className="field">
                Confirm initial password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={72}
                  disabled={busy}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </label>
              <p className="muted tiny">
                Use at least 10 characters. Creating the account does not sign
                you out.
              </p>
              <button className="button primary" disabled={busy}>
                {busy ? "Creating…" : "Create employee account"}
              </button>
            </form>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {status && (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await loginRequest(client, {
                    action: "credentials",
                    profile_id: profile.id,
                    username,
                    pin,
                    disable_pin: disable,
                  });
                  setPin("");
                  await refresh();
                  setOpen(false);
                } catch (e) {
                  setError(message(e));
                  setPin("");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Username (optional)
                <input
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={32}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <p className="muted tiny">
                3–32 characters, starting with a letter. Letters, numbers, dots,
                hyphens and underscores are allowed. Sign in with this username
                and the existing password.
              </p>
              <label className="field">
                {status.pin_enabled
                  ? "Replace four-digit PIN (optional)"
                  : "Four-digit PIN (optional)"}
                <input
                  aria-label="New four-digit PIN"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  minLength={4}
                  disabled={!status.account_ready || disable || busy}
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                />
              </label>
              {!status.account_ready && (
                <p className="notice">
                  An administrator must create this employee’s login account
                  before a PIN can be assigned.
                </p>
              )}
              {status.pin_enabled && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={disable}
                    onChange={(e) => {
                      setDisable(e.target.checked);
                      setPin("");
                    }}
                  />
                  Disable this employee’s PIN
                </label>
              )}
              <p className="muted tiny">
                Use a unique PIN for each employee. An existing PIN is never
                displayed. Leave the PIN blank to keep it unchanged.
              </p>
              <button className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Save login options"}
              </button>
            </form>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
interface DeviceStatus {
  id: string;
  name: string;
  locked: boolean;
  expires_at: string;
}
export function PinDevices({ client }: { client: SupabaseClient }) {
  const [devices, setDevices] = useState<DeviceStatus[]>([]),
    [local, setLocal] = useState(savedPinDevice),
    [name, setName] = useState(() => savedPinDevice()?.name ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      setDevices(
        await loginRequest<DeviceStatus[]>(client, { action: "devices" }),
      );
    } catch (e) {
      setError(message(e));
    }
  }, [client]);
  useEffect(() => {
    let active = true;
    void loginRequest<DeviceStatus[]>(client, { action: "devices" }).then(
      (value) => {
        if (active) setDevices(value);
      },
      (error) => {
        if (active) setError(message(error));
      },
    );
    return () => {
      active = false;
    };
  }, [client]);
  return (
    <div className="settings-card">
      <h2>PIN sign-in devices</h2>
      <p className="muted">
        Approve each studio browser once. Employees can then enter just their
        four-digit PIN. Approval lasts 90 days. Five incorrect PIN attempts lock
        the device until a manager approves it again.
      </p>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const device = await loginRequest<PinDevice>(client, {
              action: "approve_device",
              name,
              device_token: local?.token,
            });
            rememberPinDevice(device);
            setLocal(device);
            setNotice("This device is approved. Sign out to use PIN sign-in.");
            await load();
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          This device’s name
          <input
            required
            maxLength={80}
            placeholder="For example: Studio tablet"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy
            ? "Saving…"
            : local
              ? "Approve this device again"
              : "Approve this device"}
        </button>
      </form>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {devices.map((d) => (
        <div className="pin-device-row" key={d.id}>
          <div>
            <strong>
              {d.name}
              {d.id === local?.id ? " (this device)" : ""}
            </strong>
            <p className="muted tiny">
              {d.locked ? "Locked · approve again on that device" : "Approved"}{" "}
              · expires {new Date(d.expires_at).toLocaleDateString()}
            </p>
          </div>
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await loginRequest(client, {
                  action: "revoke_device",
                  id: d.id,
                });
                if (local?.id === d.id) {
                  forgetPinDevice();
                  setLocal(null);
                }
                await load();
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove approval
          </button>
        </div>
      ))}
      <p className="muted tiny">
        Removing approval prevents future PIN sign-ins. It does not end an
        employee’s existing session. Use a password to manage usernames, PINs
        and approved devices.
      </p>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loginRequest } from "@/lib/manufacturing/login";
import { message } from "@/lib/manufacturing/api";
import { pinExpired } from "@/lib/manufacturing/pin-policy";
import { Check } from "./primitives";
interface PinStatus {
  pin_enabled: boolean;
  pin_changed_at: string | null;
}
export function PinExpiration({
  client,
  profileId,
  enabled,
  onChange,
  expirationDate,
  onDateChange,
}: {
  client: SupabaseClient;
  profileId: string | null;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  expirationDate: string | null;
  onDateChange: (date: string | null) => void;
}) {
  const [now] = useState(() => Date.now());
  const [mode, setMode] = useState<"date" | "90_days">(() =>
    enabled && !expirationDate ? "90_days" : "date",
  );
  const [status, setStatus] = useState<PinStatus | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (profileId)
      void loginRequest<PinStatus>(client, {
        action: "credential_status",
        profile_id: profileId,
      })
        .then((v) => {
          if (live) setStatus(v);
        })
        .catch((e) => {
          if (live) setError(message(e));
        });
    return () => {
      live = false;
    };
  }, [client, profileId]);
  const changed = status?.pin_changed_at
    ? new Date(status.pin_changed_at)
    : null;
  const rollingExpiry = changed
    ? new Date(changed.getTime() + 90 * 86400000)
    : null;
  const missingDate = enabled && mode === "date" && !expirationDate;
  const expired =
    !missingDate &&
    pinExpired(enabled, expirationDate, status?.pin_changed_at ?? null, now);
  return (
    <fieldset className="pin-policy">
      <legend>PIN expiration</legend>
      <Check label="PIN expires" checked={enabled} onChange={onChange} />
      {enabled ? (
        <>
          <label className="field">
            Expiration
            <select
              value={mode}
              onChange={(e) => {
                const value = e.target.value as "date" | "90_days";
                setMode(value);
                if (value === "90_days") onDateChange(null);
              }}
            >
              <option value="date">On a date I choose</option>
              <option value="90_days">90 days after PIN change</option>
            </select>
          </label>
          {mode === "date" ? (
            <>
              <label className="field">
                Expiration date
                <input
                  type="date"
                  required
                  max="9999-12-31"
                  value={expirationDate ?? ""}
                  onInput={(e) => onDateChange(e.currentTarget.value || null)}
                  onChange={(e) => onDateChange(e.target.value || null)}
                />
              </label>
              <p className="muted tiny">
                The PIN works through this date, in Miami time. Changing the PIN
                does not extend this date.
              </p>
            </>
          ) : (
            <p className="muted tiny">
              Expires 90 days after the last PIN change. Resetting the PIN
              starts another 90 days.
            </p>
          )}
        </>
      ) : (
        <p className="muted tiny">
          No expiration. The PIN keeps working until you disable it or turn
          expiration on.
        </p>
      )}
      {status && (
        <dl>
          <dt>Last PIN change</dt>
          <dd>{changed?.toLocaleString() ?? "Not set"}</dd>
          <dt>Next expiration</dt>
          <dd>
            {!enabled
              ? "No expiration"
              : mode === "date"
                ? expirationDate
                  ? `End of ${expirationDate} (Miami time)`
                  : "Choose a date"
                : (rollingExpiry?.toLocaleString() ?? "After a PIN is set")}
          </dd>
          <dt>PIN status</dt>
          <dd>
            {!status.pin_enabled ? "Not set" : expired ? "Expired" : "Active"}
          </dd>
        </dl>
      )}
      <p className="muted tiny">
        Changing expiration requires password sign-in.
      </p>
      {!profileId && (
        <p className="muted tiny">
          Save the employee, then set their PIN in Login options.
        </p>
      )}
      {error && (
        <p role="status" className="notice">
          {error}
        </p>
      )}
    </fieldset>
  );
}

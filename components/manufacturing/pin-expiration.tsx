import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loginRequest } from "@/lib/manufacturing/login";
import { message } from "@/lib/manufacturing/api";
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
}: {
  client: SupabaseClient;
  profileId: string | null;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const [now] = useState(() => Date.now());
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
  const expires =
    changed && enabled ? new Date(changed.getTime() + 90 * 86400000) : null;
  return (
    <fieldset className="pin-policy">
      <legend>PIN expiration</legend>
      <Check
        label="Require PIN change every 90 days"
        checked={enabled}
        onChange={onChange}
      />
      <p className="muted tiny">
        Off by default. Enabling this uses the last PIN change date, including
        when re-enabled. Saving requires password sign-in.
      </p>
      {status && (
        <dl>
          <dt>Last PIN change</dt>
          <dd>{changed?.toLocaleString() ?? "Not set"}</dd>
          <dt>Next expiration</dt>
          <dd>{expires?.toLocaleString() ?? "No expiration"}</dd>
          <dt>PIN status</dt>
          <dd>
            {!status.pin_enabled
              ? "Not set"
              : expires && expires.getTime() <= now
                ? "Expired"
                : "Active"}
          </dd>
        </dl>
      )}
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

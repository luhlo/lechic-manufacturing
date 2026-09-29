import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { type Api, message } from "@/lib/manufacturing/api";
import { allowed, type CachedState, type Row } from "@/lib/manufacturing/types";
import { Check } from "./primitives";
import { positionPermissions } from "@/lib/manufacturing/assignment-access";
const modules = [
  ["assignments", "Assignments"],
  ["kpis", "KPIs"],
  ["employees", "Employees"],
  ["positions", "Positions"],
  ["activities", "Activities"],
  ["products", "Designs"],
];
export function PositionAccess({
  position,
  state,
  api,
  refresh,
}: {
  position: Row;
  state: CachedState;
  api: Api;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [permissions, setPermissions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const toggle = (key: string, on: boolean) =>
    setPermissions((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(key);
        if (
          key.endsWith(".manage") &&
          modules.some(([m]) => key === m + ".manage")
        )
          next.add(key.replace(".manage", ".view"));
      } else {
        next.delete(key);
        if (key.endsWith(".view")) next.delete(key.replace(".view", ".manage"));
      }
      return [...next];
    });
  const check = (key: string, label: string) => (
    <Check
      label={label}
      checked={allowed(permissions, key)}
      onChange={(on) => toggle(key, on)}
    />
  );
  return (
    <>
      <button
        className="edit-button"
        aria-label={`App access for ${position.name}`}
        onClick={() => {
          setPermissions(positionPermissions(state.catalog, position.id));
          setError("");
          setOpen(true);
        }}
      >
        App access
      </button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent className="editor-dialog">
          <DialogHeader>
            <DialogTitle>App access: {position.name}</DialogTitle>
            <DialogDescription>
              Employees inherit this access from their position. Manage includes
              viewing. Individual employee overrides remain in Permissions.
            </DialogDescription>
          </DialogHeader>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api.manage("position_access", {
                  id: position.id,
                  permission_ids: permissions,
                });
                await refresh();
                setOpen(false);
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Check
              label="Full access (Operations Manager)"
              checked={permissions.includes("*")}
              onChange={(on) => toggle("*", on)}
            />
            <fieldset disabled={permissions.includes("*") || busy}>
              <legend>Pages and actions</legend>
              {check("my_work.access", "My work")}
              {check("dashboard.view", "View dashboard")}
              {modules.map(([key, label]) => (
                <div className="access-row" key={key}>
                  <strong>{label}</strong>
                  <div>
                    {check(
                      key + ".view",
                      "View " + (key === "kpis" ? "KPIs" : label.toLowerCase()),
                    )}
                    {check(
                      key + ".manage",
                      "Manage " +
                        (key === "kpis" ? "KPIs" : label.toLowerCase()),
                    )}
                  </div>
                </div>
              ))}
              {check("analytics.view", "View analytics")}
              {check("permissions.manage", "Manage permissions")}
              {check("settings.manage", "Manage settings")}
            </fieldset>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Save app access"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

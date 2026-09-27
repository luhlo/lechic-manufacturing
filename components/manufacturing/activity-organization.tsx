"use client";
import { useRef, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { type Api, message } from "@/lib/manufacturing/api";
import {
  allowed,
  type Activity,
  type ActivityCategory,
  type ActivityStep,
  type CachedState,
} from "@/lib/manufacturing/types";
import { Check, DataTable } from "./primitives";

type Props = { state: CachedState; api: Api; refresh: () => Promise<void> };
export function ActivityOrganization({ state, api, refresh }: Props) {
  const [editing, setEditing] = useState<
    (Partial<ActivityCategory> & { position_ids: string[] }) | null
  >(null);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const canManage = allowed(state.context.permissions, "activities.manage");
  const canConfigure = allowed(state.context.permissions, "settings.manage");
  const categories = [...(state.catalog.activity_categories ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  const save = async (
    entity: string,
    payload: Record<string, unknown>,
    close = false,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      await api.manage(entity, payload);
      await refresh();
      if (close) setEditing(null);
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  return (
    <div className="activity-organization">
      <fieldset
        className="settings-card workflow-controls"
        disabled={!canConfigure || saving}
      >
        <legend>Workflow settings</legend>
        <Check
          label="Allow employees to add new activities"
          checked={state.context.workflow?.employee_activity_creation === true}
          onChange={(value) =>
            void save("workflow_settings", {
              employee_activity_creation: value,
            })
          }
        />
        <Check
          label="Enable activity steps"
          checked={state.context.workflow?.activity_steps_enabled === true}
          onChange={(value) =>
            void save("workflow_settings", { activity_steps_enabled: value })
          }
        />
        <p className="muted tiny">
          Changes apply to future work. Existing activities, steps and sessions
          are preserved.
          {!canConfigure
            ? " Only authorized settings managers can change these switches."
            : ""}
        </p>
      </fieldset>
      {error && !editing && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <details className="panel category-management">
        <summary>
          Categories <span className="count">{categories.length}</span>
        </summary>
        <p className="muted">
          Organize activities below. Empty-category positions only allow
          activity creation; they never unlock other activities.
        </p>
        {canManage && (
          <button
            className="button secondary"
            onClick={() => {
              setError("");
              setEditing({
                name: "",
                active: true,
                sort_order: 0,
                requires_design_default: true,
                requires_quantity_default: true,
                position_ids: [],
              });
            }}
          >
            <Plus size={18} />
            Add category
          </button>
        )}
        <DataTable
          headers={["Category", "Order", "Status", ""]}
          rows={categories.map((c) => [
            c.name,
            c.sort_order,
            c.active ? "Active" : "Inactive",
            canManage ? (
              <button
                key="edit"
                className="edit-button"
                onClick={() => {
                  setError("");
                  setEditing({
                    ...c,
                    position_ids: (state.catalog.category_positions ?? [])
                      .filter((p) => p.category_id === c.id)
                      .map((p) => p.position_id),
                  });
                }}
              >
                <Pencil size={15} />
                Edit {c.name}
              </button>
            ) : (
              "View only"
            ),
          ])}
        />
      </details>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !saving) setEditing(null);
        }}
      >
        <DialogContent className="editor-dialog">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Edit category" : "Add category"}
            </DialogTitle>
            <DialogDescription>
              Changes affect future choices. Historical session context stays
              unchanged.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void save("activity_categories", editing, true);
              }}
            >
              <fieldset disabled={saving} className="form-stack">
                <label className="field">
                  Category name
                  <input
                    required
                    maxLength={100}
                    value={editing.name ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Display order
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step={1}
                    required
                    value={editing.sort_order ?? 0}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        sort_order: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <Check
                  label="Active category"
                  checked={editing.active !== false}
                  onChange={(v) => setEditing({ ...editing, active: v })}
                />
                <fieldset>
                  <legend>Defaults for employee-created activities</legend>
                  <Check
                    label="Requires design/product"
                    checked={editing.requires_design_default !== false}
                    onChange={(v) =>
                      setEditing({ ...editing, requires_design_default: v })
                    }
                  />
                  <Check
                    label="Requires quantity"
                    checked={editing.requires_quantity_default !== false}
                    onChange={(v) =>
                      setEditing({ ...editing, requires_quantity_default: v })
                    }
                  />
                </fieldset>
                <fieldset>
                  <legend>
                    Allow these positions to use an empty category
                  </legend>
                  {state.catalog.positions.map((p) => (
                    <Check
                      key={p.id}
                      label={String(p.name)}
                      checked={editing.position_ids.includes(p.id)}
                      onChange={(v) =>
                        setEditing({
                          ...editing,
                          position_ids: v
                            ? [...editing.position_ids, p.id]
                            : editing.position_ids.filter((id) => id !== p.id),
                        })
                      }
                    />
                  ))}
                </fieldset>
                <button
                  className="button primary"
                  disabled={saving || !editing.name?.trim()}
                >
                  {saving ? "Saving…" : "Save category"}
                </button>
              </fieldset>
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ActivitySteps({
  activity,
  state,
  api,
  refresh,
}: Props & { activity: Activity }) {
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Partial<ActivityStep> | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const steps = (state.catalog.activity_steps ?? [])
    .filter((s) => s.activity_id === activity.id)
    .sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );
  if (!allowed(state.context.permissions, "activities.manage")) return null;
  return (
    <>
      <button
        className="edit-button"
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        Steps ({steps.length})
      </button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!saving) {
            setOpen(v);
            setEditing(null);
          }
        }}
      >
        <DialogContent className="editor-dialog">
          <DialogHeader>
            <DialogTitle>Steps · {activity.name}</DialogTitle>
            <DialogDescription>
              Optional details, with the same design and quantity requirements
              as this activity.
            </DialogDescription>
          </DialogHeader>
          {(!state.context.workflow?.activity_steps_enabled ||
            !activity.use_steps) && (
            <p className="notice">
              Steps are preserved. Enable activity steps globally and “Use steps
              for this activity” to offer them for new work.
            </p>
          )}
          {!editing ? (
            <>
              <button
                className="button secondary"
                onClick={() =>
                  setEditing({
                    activity_id: activity.id,
                    name: "",
                    active: true,
                    sort_order: 0,
                  })
                }
              >
                Add step
              </button>
              <DataTable
                headers={["Step", "Order", "Status", ""]}
                rows={steps.map((s) => [
                  s.name,
                  s.sort_order,
                  s.active ? "Active" : "Inactive",
                  <button
                    key="edit"
                    className="edit-button"
                    onClick={() => setEditing({ ...s })}
                  >
                    Edit {s.name}
                  </button>,
                ])}
              />
            </>
          ) : (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (lock.current) return;
                lock.current = true;
                setSaving(true);
                setError("");
                try {
                  await api.manage("activity_steps", {
                    ...editing,
                    activity_id: activity.id,
                  });
                  await refresh();
                  setEditing(null);
                } catch (e) {
                  setError(message(e));
                } finally {
                  lock.current = false;
                  setSaving(false);
                }
              }}
            >
              <fieldset disabled={saving} className="form-stack">
                <label className="field">
                  Step name
                  <input
                    required
                    maxLength={100}
                    value={editing.name ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Display order
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step={1}
                    required
                    value={editing.sort_order ?? 0}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        sort_order: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <Check
                  label="Active step"
                  checked={editing.active !== false}
                  onChange={(v) => setEditing({ ...editing, active: v })}
                />
                <button
                  className="button primary"
                  disabled={saving || !editing.name?.trim()}
                >
                  {saving ? "Saving…" : "Save step"}
                </button>
                <button
                  type="button"
                  className="back-link"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </fieldset>
            </form>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";
import { useState } from "react";
import { Plus, Search, Pencil, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { Api } from "@/lib/manufacturing/api";
import { message } from "@/lib/manufacturing/api";
import {
  allowed,
  canManagePage,
  permissionNames,
  type CachedState,
  type Row,
  type Activity,
} from "@/lib/manufacturing/types";
import {
  reportingDateTime,
  reportingInstant,
  reportingClock,
} from "@/lib/manufacturing/reporting-time";
import { localDate, normalize } from "@/lib/manufacturing/domain";
import { Check, DataTable, Pick } from "./primitives";
import { ActivityOrganization, ActivitySteps } from "./activity-organization";
import { PositionAccess } from "./position-access";
import { PinExpiration } from "./pin-expiration";
import { EmployeeLoginSettings, PinDevices } from "./login-settings";
import { useAssignmentRecipients } from "./use-assignment-recipients";
import { assignmentEditable, hierarchyLabel, positionPermissions, recipientAllowed } from "@/lib/manufacturing/assignment-access";
const titles: Record<string, string> = {
  profiles: "Employees",
  positions: "Positions",
  roles: "Permissions",
  activities: "Activities",
  products: "Designs",
  assignments: "Assignments",
  kpi_targets: "KPI targets",
  settings: "Settings",
};
const singular: Record<string, string> = {
  profiles: "employee",
  positions: "position",
  roles: "role",
  activities: "activity",
  products: "design",
  assignments: "assignment",
  kpi_targets: "KPI target",
};
export function Management({
  page,
  state,
  api,
  refresh,
}: {
  page: string;
  state: CachedState;
  api: Api;
  refresh: () => Promise<void>;
}) {
  const c = state.catalog;
  const canEdit = canManagePage(state.context.permissions, page);
  const canManageAccess = allowed(state.context.permissions, "permissions.manage");
  const { scope: recipients, reloadRecipients } = useAssignmentRecipients(
    api, state, page === "assignments" && canEdit,
  );
  const [query, setQuery] = useState(""),
    [editing, setEditing] = useState<Record<string, unknown> | null>(null),
    [saving, setSaving] = useState(false),
    [formError, setFormError] = useState(""),
    [assignmentScope, setAssignmentScope] = useState("profile_roles");
  const entity = page === "roles" ? "roles" : page;
  const currentAssignment = c.assignments.find((a) => a.id === editing?.id);
  const assignmentSaveAllowed = recipientAllowed(recipients, editing?.employee_id) &&
    (!editing?.id || (!!currentAssignment &&
      assignmentEditable(recipients, currentAssignment.employee_id, editing.employee_id)));
  const find = (list: Row[], id: unknown) =>
    list.find((x) => x.id === id)?.name ?? "—";
  const options = (list: Row[]) =>
    list.map((r) => ({
      value: r.id,
      label: String(r.name ?? r.id) + (r.active === false ? " (inactive)" : ""),
    }));
  const records = (
    (c as unknown as Record<string, Row[]>)[entity] ?? []
  ).filter((r) => page !== "roles" || !r.managed_position_id);
  const filtered = records.filter((r) =>
    normalize(JSON.stringify(r)).includes(normalize(query)),
  );
  const update = (key: string, value: unknown) =>
    setEditing((prev) => ({ ...prev, [key]: value }));
  const edit = (row?: Row) => {
    setFormError("");
    const r: Record<string, unknown> = { active: true, ...row };
    if (page === "activities") {
      r.category_id ??=
        (c.activity_categories ?? []).find((c) => c.is_fallback)?.id ?? "";
      r.use_steps ??= false;
      r.requires_design ??= true;
      r.requires_quantity ??= true;
      r.position_ids = c.activity_positions
        .filter((x) => x.activity_id === row?.id)
        .map((x) => x.position_id);
    }
    if (page === "roles")
      r.permission_ids = c.role_permissions
        .filter((x) => x.role_id === row?.id)
        .map((x) => x.permission_id);
    if (page === "assignments") {
      reloadRecipients();
      r.work_date ??= localDate();
      r.status ??= "assigned";
    }
    if (page === "kpi_targets") {
      r.effective_from = reportingDateTime();
    }
    setEditing(r);
  };
  const selected = (field: string, value: string) =>
    ((editing?.[field] ?? []) as string[]).includes(value);
  const multi = (field: string, value: string, on: boolean) =>
    update(
      field,
      on
        ? [...((editing?.[field] ?? []) as string[]), value]
        : ((editing?.[field] ?? []) as string[]).filter((v) => v !== value),
    );
  const input = (
    label: string,
    key: string,
    type = "text",
    required = true,
  ) => (
    <label className="field">
      {label}
      <input
        type={type}
        required={required}
        min={type === "number" ? 0 : undefined}
        step={
          key === "target_value" ? "any" : type === "number" ? 1 : undefined
        }
        maxLength={key === "notes" ? 2000 : 180}
        value={String(editing?.[key] ?? "")}
        onChange={(e) => update(key, e.target.value)}
      />
    </label>
  );
  const pick = (label: string, key: string, list: Row[], empty?: string) => (
    <Pick
      label={label}
      value={String(editing?.[key] ?? "")}
      onChange={(v) => update(key, v)}
      options={options(list)}
      empty={empty}
    />
  );
  const status = (r: Row) => (
    <span className={"status-pill " + (r.active === false ? "inactive" : "")}>
      {r.active === false
        ? "Inactive"
        : r.valid_until
          ? "Superseded"
          : "Active"}
    </span>
  );
  const action = (r: Row) =>
    canEdit && (page !== "assignments" || assignmentEditable(recipients, r.employee_id)) ? (
      <button
        className="edit-button"
        aria-label={`Edit ${r.name ?? find(c.products, r.product_id)}`}
        onClick={() => edit(r)}
      >
        <Pencil size={15} />
        Edit
      </button>
    ) : page === "assignments" && canEdit ? <span className="muted tiny">View only</span> : null;
  const table = () => {
    switch (page) {
      case "profiles":
        return (
          <DataTable
            headers={[
              "Employee",
              "Email",
              "Username",
              "Position",
              "Status",
              "",
            ]}
            rows={filtered.map((r) => [
              <strong key="name">{r.name}</strong>,
              String(r.email),
              String(r.username ?? "—"),
              find(c.positions, r.position_id),
              status(r),
              <div className="login-actions" key="actions">
                {action(r)}
                {canEdit && api.client && (
                  <EmployeeLoginSettings
                    client={api.client}
                    profile={r}
                    refresh={refresh}
                    canCreateAccount={allowed(state.context.permissions, "*")}
                  />
                )}
              </div>,
            ])}
          />
        );
      case "positions":
        return (
          <DataTable
            headers={["Position", "Hierarchy level", ...(canManageAccess ? ["Can assign work"] : []), "Employees", "Status", ""]}
            rows={filtered.map((r) => [
              <strong key="name">{r.name}</strong>,
              hierarchyLabel(r.assignment_level),
              ...(canManageAccess ? [r.active !== false && allowed(positionPermissions(c, r.id), "assignments.manage") ? "Yes" : "No"] : []),
              c.profiles.filter((p) => p.position_id === r.id).length,
              status(r),
              <div className="login-actions" key="actions">
                {action(r)}
                {allowed(state.context.permissions, "permissions.manage") && (
                  <PositionAccess
                    position={r}
                    state={state}
                    api={api}
                    refresh={refresh}
                  />
                )}
              </div>,
            ])}
          />
        );
      case "activities":
        return (
          <DataTable
            headers={["Activity", "Category", "Positions", "Status", ""]}
            rows={filtered.map((r) => [
              <strong key="name">{r.name}</strong>,
              find(c.activity_categories ?? [], r.category_id),
              c.activity_positions
                .filter((x) => x.activity_id === r.id)
                .map((x) => find(c.positions, x.position_id))
                .join(", ") || "None assigned",
              status(r),
              <div className="login-actions" key="actions">
                {action(r)}
                {canEdit && (
                  <ActivitySteps
                    activity={r as Activity}
                    state={state}
                    api={api}
                    refresh={refresh}
                  />
                )}
              </div>,
            ])}
          />
        );
      case "products":
        return (
          <DataTable
            headers={["Design / style", "SKU", "Status", ""]}
            rows={filtered.map((r) => [
              <strong key="name">{r.name}</strong>,
              <code key="sku">{String(r.sku)}</code>,
              status(r),
              action(r),
            ])}
          />
        );
      case "assignments":
        return (
          <DataTable
            headers={[
              "Design",
              "Employee",
              "Date",
              "Target units",
              "Status",
              "",
            ]}
            rows={filtered.map((r) => [
              find(c.products, r.product_id),
              find(c.profiles, r.employee_id),
              String(r.work_date),
              String(r.target_quantity ?? "—"),
              <span key="status" className="status-pill">
                {String(r.status).replace("_", " ")}
              </span>,
              action(r),
            ])}
          />
        );
      case "kpi_targets":
        return (
          <DataTable
            headers={[
              "Activity",
              "Design scope",
              "Units / productive hr",
              "Effective from",
              "Status",
              "",
            ]}
            rows={filtered.map((r) => [
              find(c.activities, r.activity_id),
              r.product_id ? find(c.products, r.product_id) : "All designs",
              String(r.target_value),
              reportingClock(String(r.effective_from), true),
              status(r),
              action(r),
            ])}
          />
        );
      case "roles":
        return (
          <DataTable
            headers={["Role", "Capabilities", "Status", ""]}
            rows={filtered.map((r) => [
              <strong key="name">{r.name}</strong>,
              c.role_permissions
                .filter((x) => x.role_id === r.id)
                .map((x) =>
                  x.permission_id === "*"
                    ? "Full administration"
                    : (permissionNames[x.permission_id] ?? x.permission_id),
                )
                .join(", ") || "No app access",
              status(r),
              action(r),
            ])}
          />
        );
      default:
        return null;
    }
  };
  if (page === "settings")
    return (
      <section>
        <div className="page-heading">
          <div>
            <p className="eyebrow">WORKSPACE</p>
            <h1>Settings</h1>
          </div>
        </div>
        <div className="settings-card">
          <h2>Employee KPI visibility</h2>
          <p className="muted">
            Performance data is collected in every mode. This setting controls
            what employees see.
          </p>
          <VisibilityForm
            current={state.context.visibility}
            save={async (value) => {
              await api.manage("settings", { employee_kpi_visibility: value });
              await refresh();
              toast.success("Settings saved");
            }}
          />
        </div>
        {api.client &&
          allowed(state.context.permissions, "permissions.manage") && (
            <PinDevices client={api.client} />
          )}
        <div className="settings-card">
          <h2>Install on a phone</h2>
          <p>
            On iPhone, open this app in Safari, choose Share, then Add to Home
            Screen. On Android, use Install app in the browser menu.
          </p>
          <p className="muted">
            Sign in once on your own phone. Open the app online before your
            first shift. A new session needs a connection; an active session can
            record changes temporarily offline.
          </p>
        </div>
      </section>
    );
  return (
    <section key={page}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE / CONFIGURATION</p>
          <h1>{titles[page]}</h1>
          <p className="muted">
            {!canEdit
              ? "View only. Contact your Operations Manager to make changes."
              : page === "kpi_targets"
                ? "Design-specific targets take priority over activity targets. Edits create a new version."
                : page === "roles"
                  ? "Advanced employee overrides. Configure primary app access in Positions."
                  : page === "profiles"
                    ? "Assign a position for app access. Administrators create login accounts."
                    : page === "activities"
                      ? "Link each activity to the positions that can perform it."
                      : page === "assignments"
                        ? "Current assignments appear first on each employee’s phone."
                        : "Create, edit, or deactivate records while preserving work history."}
          </p>
        </div>
        {canEdit && (
          <button className="button primary" onClick={() => edit()}
            disabled={page === "assignments" && (!recipients?.can_manage || !recipients.recipients.length)}>
            <Plus size={18} />
            Add {singular[page]}
          </button>
        )}
      </div>
      {page === "assignments" && canEdit && (!recipients || recipients.reason || !recipients.recipients.length) && (
        <p className="notice" role="status">
          {!recipients ? "Checking assignment access…" : recipients.reason ??
            "No eligible employees. Ask your Operations Manager to review active employees, positions and hierarchy levels."}
        </p>
      )}
      {page === "activities" && (
        <ActivityOrganization state={state} api={api} refresh={refresh} />
      )}
      {page === "roles" ? (
        <Tabs defaultValue="roles">
          <TabsList>
            <TabsTrigger value="roles">Roles & capabilities</TabsTrigger>
            <TabsTrigger value="assign">Assign roles</TabsTrigger>
          </TabsList>
          <TabsContent value="roles">{table()}</TabsContent>
          <TabsContent value="assign">
            <div className="settings-card">
              <Pick
                label="Assign roles to"
                value={assignmentScope}
                onChange={setAssignmentScope}
                options={[{ value: "profile_roles", label: "Employees" }]}
              />
              <RoleAssignments
                key={assignmentScope}
                entity={assignmentScope}
                state={state}
                api={api}
                refresh={refresh}
              />
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        <>
          <div className="table-toolbar">
            <label className="search-box">
              <Search size={18} />
              <input
                aria-label={`Search ${titles[page]}`}
                placeholder={
                  page === "products"
                    ? "Search design or SKU"
                    : `Search ${titles[page].toLowerCase()}`
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <span className="muted">{filtered.length} records</span>
          </div>
          {table()}
        </>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setFormError("");
          }
        }}
      >
        <DialogContent className="editor-dialog">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Edit" : "Add"} {singular[page]}
            </DialogTitle>
            <DialogDescription>
              {page === "kpi_targets"
                ? "Historical session targets remain unchanged."
                : "Changes apply to future work. Historical session labels are retained."}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                setFormError("");
                try {
                  const p = { ...editing };
                  if (!canEdit) throw Error("Your management access has changed. Contact your Operations Manager.");
                  if (page === "positions") {
                    if (canManageAccess) p.assignment_level = p.assignment_level === "" || p.assignment_level == null ? null : String(p.assignment_level);
                    else delete p.assignment_level;
                  }
                  if (
                    page === "activities" &&
                    (!p.category_id || !(p.position_ids as string[])?.length)
                  )
                    throw Error("Choose a category and at least one position.");
                  if (
                    page === "assignments" &&
                    (!p.employee_id || !p.product_id)
                  )
                    throw Error("Choose an employee and design.");
                  if (page === "assignments" && !assignmentSaveAllowed)
                    throw Error("Assignment access has changed. Review the eligible employees before saving.");
                  if (page === "kpi_targets") {
                    if (!p.activity_id || Number(p.target_value) <= 0)
                      throw Error("Choose an activity and a positive target.");
                    p.effective_from = reportingInstant(
                      String(p.effective_from),
                    );
                  }
                  await api.manage(entity, p);
                  setEditing(null);
                  await refresh();
                  toast.success("Saved");
                } catch (e) {
                  setFormError(message(e));
                  if (page === "assignments") {
                    await refresh();
                    reloadRecipients();
                  }
                } finally {
                  setSaving(false);
                }
              }}
            >
              {[
                "profiles",
                "positions",
                "roles",
                "activities",
                "products",
              ].includes(page) &&
                input(
                  page === "profiles"
                    ? "Employee name"
                    : page === "products"
                      ? "Design / style name"
                      : "Name",
                  "name",
                )}
              {page === "profiles" && (
                <>
                  {input("Email used to sign in", "email", "email")}
                  {pick("Position", "position_id", c.positions)}
                  {!canManageAccess && <p className="muted tiny">Changing assignment authority requires permission-management access.</p>}
                  {input(
                    "External employee ID (optional)",
                    "external_employee_id",
                    "text",
                    false,
                  )}
                  <PinExpiration
                    client={api.client}
                    profileId={editing.id ? String(editing.id) : null}
                    enabled={editing.pin_expiration_enabled === true}
                    onChange={(v) => update("pin_expiration_enabled", v)}
                    expirationDate={
                      editing.pin_expiration_date
                        ? String(editing.pin_expiration_date)
                        : null
                    }
                    onDateChange={(v) => update("pin_expiration_date", v)}
                  />
                  <p className="muted tiny">
                    After saving, an administrator can open Login options to
                    create the employee’s account and assign a username and PIN.
                    Access is inherited from their position.
                  </p>
                </>
              )}
              {page === "positions" && (
                <>
                  <label className="field">
                    Assignment hierarchy level
                    <input type="number" min="1" max="2147483647" step="1"
                      placeholder="Not configured" disabled={!canManageAccess}
                      value={String(editing.assignment_level ?? "")}
                      onChange={(e) => update("assignment_level", e.target.value)} />
                  </label>
                  <p className="muted tiny">Higher numbers have more authority. With assignment permission, this position can assign work to employees at the same level or below.</p>
                  <p className="muted tiny">Leave blank for Not configured. {canManageAccess
                    ? `Can assign work: ${editing.active !== false && editing.id && allowed(positionPermissions(c, String(editing.id)), "assignments.manage") ? "Yes" : "No"}. Configure that permission separately in App access.`
                    : "Changing hierarchy levels requires permission-management access."}</p>
                </>
              )}
              {page === "products" && input("SKU", "sku")}
              {page === "activities" && (
                <fieldset>
                  <legend>Employee workflow</legend>
                  {pick("Category", "category_id", c.activity_categories ?? [])}
                  <Check
                    label="Use steps for this activity"
                    checked={editing.use_steps === true}
                    onChange={(v) => update("use_steps", v)}
                  />
                  {!state.context.workflow?.activity_steps_enabled && (
                    <p className="muted tiny">
                      Global activity steps are off. Configured steps are
                      preserved.
                    </p>
                  )}
                  <Check
                    label="Requires design/product"
                    checked={editing.requires_design !== false}
                    onChange={(v) => update("requires_design", v)}
                  />
                  <Check
                    label="Requires quantity"
                    checked={editing.requires_quantity !== false}
                    onChange={(v) => update("requires_quantity", v)}
                  />
                  <p className="muted tiny">
                    Applies when new work starts. Sessions already in progress
                    keep their original settings.
                  </p>
                </fieldset>
              )}
              {page === "activities" && (
                <fieldset>
                  <legend>Positions</legend>
                  {c.positions.map((p) => (
                    <Check
                      key={p.id}
                      label={String(p.name)}
                      checked={selected("position_ids", p.id)}
                      onChange={(on) => multi("position_ids", p.id, on)}
                    />
                  ))}
                </fieldset>
              )}
              {page === "activities" &&
                records.some(
                  (r) =>
                    r.id !== editing.id &&
                    r.category_id === editing.category_id &&
                    normalize(String(r.name)).includes(
                      normalize(String(editing.name ?? "")),
                    ) &&
                    normalize(String(editing.name ?? "")).length > 2,
                ) && (
                  <p className="notice">
                    A similar activity name exists. Review the list to avoid
                    duplicates.
                  </p>
                )}
              {page === "assignments" && (
                <>
                  <Pick label="Employee"
                    value={recipientAllowed(recipients, editing.employee_id) ? String(editing.employee_id) : ""}
                    // Radix can emit an empty native-select change while options refresh.
                    // Keep the draft ID; eligibility separately invalidates stale recipients.
                    onChange={(id) => { if (recipientAllowed(recipients, id)) update("employee_id", id); }}
                    empty={!canEdit ? "Assignment management unavailable" : !recipients ? "Checking access…" : recipients.recipients.length ? "Choose eligible employee…" : "No eligible employees"}
                    options={(recipients?.recipients ?? []).map((r) => ({ value: r.id,
                      label: `${r.name} · ${r.position_name ?? "No position"}${r.position_active === false ? " (inactive)" : ""} · ${hierarchyLabel(r.assignment_level)}` }))} />
                  {recipients?.reason && <p className="notice" role="status">{recipients.reason}</p>}
                  {!canEdit && <p className="notice" role="alert">Assignment management access has changed. Contact your Operations Manager. Your draft has not been saved.</p>}
                  {recipients && !recipients.reason && !recipients.recipients.length && <p className="notice">No eligible employees. Ask your Operations Manager to review position hierarchy levels.</p>}
                  {recipients && editing.employee_id && !recipientAllowed(recipients, editing.employee_id) ?
                    <p className="notice" role="alert">Assignment access has changed. The selected employee is no longer eligible. Your other inputs are preserved.</p> : null}
                  {recipients && editing.id && (!currentAssignment || !assignmentEditable(recipients, currentAssignment.employee_id)) ?
                    <p className="notice" role="alert">You can no longer modify this assignment under the current hierarchy, including reassigning or cancelling it.</p> : null}
                  {pick("Design", "product_id", c.products)}
                  <div className="form-row">
                    {input("Work date", "work_date", "date")}
                    {input(
                      "Target quantity (optional)",
                      "target_quantity",
                      "number",
                      false,
                    )}
                  </div>
                  <Pick
                    label="Status"
                    value={String(editing.status)}
                    onChange={(v) => update("status", v)}
                    options={[
                      "assigned",
                      "in_progress",
                      "completed",
                      "cancelled",
                    ].map((value) => ({
                      value,
                      label: value.replace("_", " "),
                    }))}
                  />
                  {input("Notes (optional)", "notes", "text", false)}
                </>
              )}
              {page === "kpi_targets" && (
                <>
                  {pick("Activity", "activity_id", c.activities)}
                  {pick(
                    "Design (optional)",
                    "product_id",
                    c.products,
                    "All designs",
                  )}
                  {input(
                    "Target units per productive hour",
                    "target_value",
                    "number",
                  )}
                  {input(
                    "Effective from (America/Chicago)",
                    "effective_from",
                    "datetime-local",
                  )}
                </>
              )}
              {page === "roles" && (
                <fieldset>
                  <legend>Capabilities</legend>
                  <Check
                    label="Full administration"
                    checked={selected("permission_ids", "*")}
                    onChange={(on) => multi("permission_ids", "*", on)}
                  />
                  {Object.entries(permissionNames).map(([key, label]) => (
                    <Check
                      key={key}
                      label={label}
                      checked={selected("permission_ids", key)}
                      onChange={(on) => multi("permission_ids", key, on)}
                    />
                  ))}
                </fieldset>
              )}
              {page !== "assignments" && (
                <Check
                  label="Active"
                  checked={editing.active !== false}
                  onChange={(v) => update("active", v)}
                />
              )}
              {formError && (
                <p role="alert" className="notice error">
                  {formError}
                </p>
              )}
              <button className="button primary" disabled={saving || !canEdit || (page === "assignments" && !assignmentSaveAllowed)}>
                {saving ? "Saving…" : "Save changes"}
                <ArrowRight size={18} />
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function RoleAssignments({
  entity,
  state,
  api,
  refresh,
}: {
  entity: string;
  state: CachedState;
  api: Api;
  refresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(""),
    [roles, setRoles] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const c = state.catalog;
  const list = entity === "profile_roles" ? c.profiles : c.positions;
  return (
    <div className="form-stack">
      <Pick
        label={entity === "profile_roles" ? "Employee" : "Position"}
        value={selected}
        onChange={(id) => {
          setSelected(id);
          setRoles(
            entity === "profile_roles"
              ? c.profile_roles
                  .filter((r) => r.profile_id === id)
                  .map((r) => r.role_id)
              : c.position_roles
                  .filter((r) => r.position_id === id)
                  .map((r) => r.role_id),
          );
        }}
        options={list.map((r) => ({ value: r.id, label: String(r.name) }))}
      />
      {c.roles
        .filter((r) => !r.managed_position_id)
        .map((r) => (
          <Check
            key={r.id}
            label={String(r.name)}
            checked={roles.includes(r.id)}
            onChange={(on) =>
              setRoles(on ? [...roles, r.id] : roles.filter((x) => x !== r.id))
            }
          />
        ))}
      <button
        className="button primary"
        disabled={
          !selected ||
          busy ||
          !allowed(state.context.permissions, "permissions.manage")
        }
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api.manage(entity, { id: selected, role_ids: roles });
            await refresh();
            toast.success("Roles saved");
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Save roles
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function VisibilityForm({
  current,
  save,
}: {
  current: string;
  save: (v: string) => Promise<void>;
}) {
  const [value, setValue] = useState(current),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="form-stack">
      <Pick
        label="Employee view"
        value={value}
        onChange={setValue}
        options={[
          { value: "OFF", label: "Off — no KPI display" },
          { value: "TARGET_ONLY", label: "Target only" },
          { value: "TARGET_AND_ACTUAL", label: "Target and actual" },
        ]}
      />
      <button
        className="button primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await save(value);
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Save setting
      </button>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </div>
  );
}

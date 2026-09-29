import { describe, expect, it, vi } from "vitest";
import { assignmentEditable, hierarchyLabel, positionPermissions, recipientAllowed } from "../lib/manufacturing/assignment-access";
import { Api, emptyCatalog } from "../lib/manufacturing/api";
import type { AssignmentRecipients } from "../lib/manufacturing/types";

const scope: AssignmentRecipients = {
  can_manage: true, reason: null,
  recipients: [
    { id: "lower", name: "Worker", position_id: "one", position_name: "Painting", position_active: true, assignment_level: 1 },
    { id: "equal", name: "Peer", position_id: "other", position_name: "Packaging", position_active: true, assignment_level: 2 },
  ],
};
describe("assignment UI follows server scope without granting permissions from rank", () => {
  it("allows lower and equal recipients only when returned by the server", () => {
    expect(recipientAllowed(scope, "lower")).toBe(true);
    expect(recipientAllowed(scope, "equal")).toBe(true);
    expect(recipientAllowed(scope, "upper")).toBe(false);
  });
  it("fails closed during refresh, missing permission and an empty result", () => {
    expect(recipientAllowed(null, "lower")).toBe(false);
    expect(recipientAllowed({ ...scope, can_manage: false }, "lower")).toBe(false);
    expect(recipientAllowed({ ...scope, recipients: [] }, "lower")).toBe(false);
  });
  it("requires both old and new recipients, including edit/cancel of old work", () => {
    expect(assignmentEditable(scope, "lower", "equal")).toBe(true);
    expect(assignmentEditable(scope, "upper", "lower")).toBe(false);
    expect(assignmentEditable(scope, "lower", "upper")).toBe(false);
    expect(assignmentEditable(scope, "upper")).toBe(false);
  });
  it("immediately invalidates a selected employee removed by a context refresh", () => {
    expect(assignmentEditable(scope, "equal")).toBe(true);
    const refreshed = { ...scope, recipients: scope.recipients.slice(0, 1) };
    expect(assignmentEditable(refreshed, "equal", "lower")).toBe(false);
    expect(recipientAllowed(refreshed, "equal")).toBe(false);
  });
  it("accepts the trusted full-admin recipient result during unconfigured setup", () => {
    const admin = { ...scope, recipients: [{ ...scope.recipients[0], assignment_level: null }] };
    expect(recipientAllowed(admin, "lower")).toBe(true);
    expect(hierarchyLabel(null)).toBe("Not configured");
    expect(hierarchyLabel(2)).toBe("Level 2");
  });
  it("displays existing active position grants independently of numeric level", () => {
    const c = emptyCatalog();
    c.positions = [{ id: "one", assignment_level: 999 }];
    c.roles = [{ id: "active", active: true }, { id: "dormant", active: false }];
    c.position_roles = [{ position_id: "one", role_id: "active" }, { position_id: "one", role_id: "dormant" }];
    c.role_permissions = [{ role_id: "active", permission_id: "my_work.access" }, { role_id: "dormant", permission_id: "*" }];
    expect(positionPermissions(c, "one")).toEqual(["my_work.access"]);
  });
  it("fetches dedicated scope with no browser-supplied actor or hierarchy", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: scope, error: null });
    const api = new Api({ rpc } as never);
    expect(await api.assignmentRecipients()).toEqual(scope);
    expect(rpc).toHaveBeenCalledWith("assignment_recipients", undefined);
  });
});

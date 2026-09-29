import type { AssignmentRecipients, Catalog } from "./types";

// The server owns eligibility. Never calculate a sender's rank in the browser.
export function recipientAllowed(scope: AssignmentRecipients | null, id: unknown) {
  return !!scope?.can_manage && scope.recipients.some((r) => r.id === id);
}

export function assignmentEditable(
  scope: AssignmentRecipients | null,
  currentRecipient: unknown,
  proposedRecipient?: unknown,
) {
  return recipientAllowed(scope, currentRecipient) &&
    (proposedRecipient === undefined || recipientAllowed(scope, proposedRecipient));
}

export function positionPermissions(catalog: Catalog, positionId: string) {
  const roles = new Set(catalog.position_roles
    .filter((r) => r.position_id === positionId &&
      catalog.roles.some((role) => role.id === r.role_id && role.active))
    .map((r) => r.role_id));
  return [...new Set(catalog.role_permissions
    .filter((r) => roles.has(r.role_id)).map((r) => r.permission_id))];
}

export const hierarchyLabel = (level: unknown) =>
  typeof level === "number" ? `Level ${level}` : "Not configured";

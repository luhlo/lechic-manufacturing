export type SegmentKind = "WORK" | "WALKING" | "INTERRUPTION";
export type Visibility = "OFF" | "TARGET_ONLY" | "TARGET_AND_ACTUAL";
export type Row = {
  id: string;
  name?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};
export interface Profile extends Row {
  name: string;
  auth_user_id: string | null;
  email: string;
  username?: string | null;
  position_id: string | null;
  active: boolean;
}
export interface Activity extends Row {
  name: string;
  active: boolean;
  position_ids?: string[];
}
export interface Product extends Row {
  name: string;
  sku: string;
  active: boolean;
}
export interface Assignment extends Row {
  employee_id: string;
  product_id: string;
  work_date: string;
  target_quantity: number | null;
  status: string;
  notes: string;
}
export interface Segment {
  id: string;
  session_id: string;
  kind: SegmentKind;
  started_at: string;
  ended_at: string | null;
}
export interface Session extends Row {
  employee_id: string;
  position_id: string | null;
  activity_id: string;
  product_id: string;
  assignment_id: string | null;
  employee_name: string;
  position_name: string;
  activity_name: string;
  product_name: string;
  sku: string;
  started_at: string;
  ended_at: string | null;
  status: "running" | "awaiting_quantity" | "completed";
  quantity: number | null;
  revision: number;
  segments: Segment[];
}
export interface Command {
  request_id: string;
  session_id: string;
  action: "start" | "transition" | "finish" | "complete";
  at: string;
  expected_revision: number;
  activity_id?: string;
  product_id?: string;
  assignment_id?: string | null;
  kind?: SegmentKind;
  quantity?: number;
}
export interface Context {
  profile: Profile;
  permissions: string[];
  visibility: Visibility;
}
export interface Catalog {
  profiles: Profile[];
  positions: Row[];
  activities: Activity[];
  products: Product[];
  assignments: Assignment[];
  activity_positions: { activity_id: string; position_id: string }[];
  roles: Row[];
  role_permissions: { role_id: string; permission_id: string }[];
  profile_roles: { profile_id: string; role_id: string }[];
  position_roles: { position_id: string; role_id: string }[];
  kpi_targets: Row[];
  settings: Row[];
}
export interface CachedState {
  context: Context;
  catalog: Catalog;
  session: Session | null;
  queue: Command[];
  conflict?: string;
  syncError?: string;
  lastSync: string;
}
export const permissionNames: Record<string, string> = {
  "employees.manage": "Manage employees",
  "positions.manage": "Manage positions",
  "activities.manage": "Manage activities",
  "products.manage": "Manage designs",
  "assignments.manage": "Assign work",
  "analytics.view": "View analytics",
  "kpis.manage": "Manage KPIs",
  "settings.manage": "Manage settings",
  "permissions.manage": "Manage permissions",
};
export const allowed = (permissions: string[], key: string) =>
  permissions.includes("*") || permissions.includes(key);

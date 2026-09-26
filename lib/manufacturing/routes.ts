import { canViewPage, firstPage, pagePermissions, type Session } from "./types";
import paths from "./page-paths.json";
export const pagePaths: Record<string, string> = paths;

export function pageFromPath(
  path: string,
  base = import.meta.env.BASE_URL,
): string | undefined {
  if (!path.startsWith(base)) return undefined;
  const relative = "/" + path.slice(base.length);
  const normalized = relative.replace(/\/+$/, "") || "/";
  const aliases: Record<string, string> = {
    "/employees": "profiles",
    "/settings": "settings",
  };
  if (aliases[normalized]) return aliases[normalized];
  return Object.keys(pagePaths).find((page) => pagePaths[page] === normalized);
}

export function pathForPage(
  page: string,
  base = import.meta.env.BASE_URL,
): string {
  return base + (pagePaths[page] ?? pagePaths.work).slice(1);
}

export function appHome(
  origin: string,
  base = import.meta.env.BASE_URL,
): string {
  return new URL(base, origin).href;
}

// Recovery wins over a stale URL. Explicit protected routes still use the normal access gate.
export function landingPage(
  permissions: string[],
  requested: string | undefined,
  session: Session | null,
  signedIn = false,
) {
  const hasWork = canViewPage(permissions, "work");
  if (hasWork && session && session.status !== "completed") return "work";
  const workOnly =
    hasWork &&
    Object.keys(pagePermissions).filter((p) => canViewPage(permissions, p))
      .length === 1;
  if (signedIn && workOnly) return "work";
  return requested ?? firstPage(permissions) ?? "work";
}

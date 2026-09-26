import paths from "./page-paths.json";
import { allowed, firstPage, type Session } from "./types";
export const pagePaths: Record<string, string> = paths;

export function landingPage(
  requested: string | undefined,
  permissions: string[],
  session: Session | null,
) {
  if (
    session &&
    session.status !== "completed" &&
    allowed(permissions, "my_work.access")
  )
    return "work";
  // Preserve explicit protected routes so access denial remains visible.
  return requested ?? firstPage(permissions) ?? "work";
}

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

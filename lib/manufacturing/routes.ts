import paths from "./page-paths.json";
export const pagePaths: Record<string, string> = paths;

export function pageFromPath(path: string, base = import.meta.env.BASE_URL): string | undefined {
  if (!path.startsWith(base)) return undefined;
  const relative = "/" + path.slice(base.length);
  const normalized = relative.replace(/\/+$/, "") || "/";
  return Object.keys(pagePaths).find((page) => pagePaths[page] === normalized);
}

export function pathForPage(page: string, base = import.meta.env.BASE_URL): string {
  return base + (pagePaths[page] ?? pagePaths.work).slice(1);
}

export function appHome(origin: string, base = import.meta.env.BASE_URL): string {
  return new URL(base, origin).href;
}

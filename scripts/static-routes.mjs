import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deploymentBase } from "../build/base-path.mjs";
const base = deploymentBase(process.env.BASE_PATH ?? "/");
const root = "dist";
const html = readFileSync(root + "/index.html", "utf8");
const paths = JSON.parse(readFileSync("lib/manufacturing/page-paths.json", "utf8"));
// GitHub Pages serves real route directories; no SPA rewrite server is needed.
for (const path of ["/login", "/employees", "/settings", ...Object.values(paths)]) {
  mkdirSync(root + path, { recursive: true });
  writeFileSync(root + path + "/index.html", html);
}
const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
for (const key of ["id", "start_url", "scope"]) manifest[key] = base;
for (const icon of manifest.icons) icon.src = base + icon.src.replace(/^\//, "");
writeFileSync(root + "/manifest.webmanifest", JSON.stringify(manifest) + "\n");
writeFileSync(root + "/.nojekyll", "");
console.log(`Static routes and PWA scope generated at ${base}`);

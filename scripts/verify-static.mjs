import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { deploymentBase } from "../build/base-path.mjs";
const base = deploymentBase(process.env.BASE_PATH ?? "/");
const root = "dist";
for (const path of ["404.html", "_worker.js", "_routes.json", "server", "functions", ".env", ".env.local"])
  assert.ok(!existsSync(`${root}/${path}`), `Static Pages output must not contain ${path}`);
const html = readFileSync(`${root}/index.html`, "utf8");
for (const [, path] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  assert.ok(path.startsWith(base) && !path.startsWith("//"), "Use root-relative static assets");
  assert.ok(existsSync(root + "/" + path.slice(base.length)), `Missing static asset: ${path}`);
}
const manifest = JSON.parse(readFileSync(`${root}/manifest.webmanifest`, "utf8"));
for (const key of ["id", "start_url", "scope"]) assert.equal(manifest[key], base);
assert.equal(manifest.display, "standalone");
for (const icon of manifest.icons) assert.ok(existsSync(root + "/" + icon.src.slice(base.length)), `Missing icon: ${icon.src}`);
const sw = readFileSync(`${root}/sw.js`, "utf8");
assert.ok(!sw.includes("BUILD_ASSETS"));
assert.match(sw, /lechic-shell-[a-f0-9]{8}-[a-f0-9]{12}/);
assert.ok(!sw.includes("skipWaiting"), "Updates must not interrupt an open session");
for (const file of readdirSync(root + "/assets")) {
  if (!file.endsWith(".js")) continue;
  const body = readFileSync(root + "/assets/" + file, "utf8");
  for (const removed of ["Explore with sample data", "manufacturing-demo-mode", "SAMPLE WORKSPACE", "First time here?"])
    assert.ok(!body.includes(removed), `Removed public entry point in production bundle: ${removed}`);
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{20,}/.test(body), "A secret key entered the bundle");
  assert.ok(!body.includes("process.env.NEXT_PUBLIC_"), "Public environment variables were not substituted");
  for (const [token] of body.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    assert.notEqual(payload.role, "service_role", "A service-role JWT entered the bundle");
  }
}
const paths = JSON.parse(readFileSync("lib/manufacturing/page-paths.json", "utf8"));
for (const path of ["/login", "/employees", "/settings", ...Object.values(paths)])
  assert.equal(readFileSync(root + path + "/index.html", "utf8"), html);
console.log("Static output: physical deep routes, asset paths, manifest, safe PWA update and public-only key checks passed");

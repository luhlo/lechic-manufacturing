import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { deploymentBase } from "../build/base-path.mjs";
const base = deploymentBase(process.env.BASE_PATH ?? "/");
const root = "dist";
const files = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const name = path + "/" + entry.name;
    if (entry.isDirectory()) walk(name);
    else if (/\.(?:html|js|css|woff2?|png|svg|webmanifest)$/.test(name) && !name.endsWith("/sw.js"))
      files.push("/" + name.slice(root.length + 1));
  }
}
walk(root);
files.sort();
const source = readFileSync("public/sw.js", "utf8");
const prefix = "lechic-shell-" + createHash("sha256").update(base).digest("hex").slice(0, 8) + "-";
const hash = createHash("sha256").update(base).update(source);
for (const file of files) hash.update(file).update(readFileSync(root + file));
const revision = hash.digest("hex").slice(0, 12);
const sw = source
  .replace("lechic-shell-v1", prefix + revision)
  .replace(/const CACHE_PREFIX = "lechic-shell-"; \/\/ BUILD_SCOPE/, "const CACHE_PREFIX = " + JSON.stringify(prefix) + ";")
  .replace(
    /const PRECACHE\s*=\s*\[\];\s*\/\/ BUILD_ASSETS/,
    "const PRECACHE=" + JSON.stringify(files.map((file) => file.endsWith("/index.html") ? base + file.slice(1, -10) : base + file.slice(1))) + ";",
  );
if (sw.includes("BUILD_ASSETS") || !files.includes("/index.html") || !files.some((f) => f.endsWith(".js")))
  throw new Error("The production offline asset list was not generated.");
writeFileSync(root + "/sw.js", sw);
console.log(`PWA: precached ${files.length} assets (${revision})`);

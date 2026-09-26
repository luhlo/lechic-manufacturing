/* Local production-shell checks. All external traffic is blocked. The removed
   sample workspace is deliberately unavailable, including to old demo flags. */
import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? process.env.PLAYWRIGHT_MODULE + "/index.mjs"
    : "playwright"
);
const origin = process.env.QA_ORIGIN || "http://127.0.0.1:5177";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const base = process.env.QA_BASE_PATH || "/";
const home = origin + base.replace(/\/$/, "");
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const errors = [],
  external = [];
await context.addInitScript(() =>
  localStorage.setItem("manufacturing-demo-mode", "true"),
);
await context.route("**/*", (route) => {
  if (
    !route
      .request()
      .url()
      .startsWith(origin + "/")
  ) {
    external.push(route.request().url());
    return route.abort();
  }
  return route.continue();
});
let page = await context.newPage();
const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
watch(page);
const swFile = "dist/sw.js",
  original = fs.readFileSync(swFile, "utf8");
const login = async () => {
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  await page
    .getByText(
      "Accounts are created by an administrator. Public registration is not available.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /Explore with sample data|First time here/ })
      .count(),
    0,
  );
};
try {
  const routes = new Set([
    "/login",
    ...Object.values(
      JSON.parse(fs.readFileSync("lib/manufacturing/page-paths.json", "utf8")),
    ),
  ]);
  for (const path of routes) {
    const r = await page.goto(home + path);
    assert.equal(r.status(), 200, path);
    await login();
    await page.reload();
    await login();
    assert.equal(
      new URL(page.url()).pathname.replace(/\/$/, ""),
      base.replace(/\/$/, "") + path,
    );
  }
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  await page
    .getByRole("button", { name: "Forgot password?", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Send reset link", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Back to sign in", exact: true })
    .click();
  await login();
  const manifest = await (
    await context.request.get(home + "/manifest.webmanifest")
  ).json();
  for (const key of ["id", "scope", "start_url"])
    assert.equal(manifest[key], base);
  for (const icon of manifest.icons)
    assert.equal((await context.request.get(origin + icon.src)).status(), 200);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration()).scope,
    ),
    origin + base,
  );
  await context.setOffline(true);
  await page.reload();
  await login();
  await context.setOffline(false);
  fs.writeFileSync(
    swFile,
    original.replace(
      /const CACHE = "([^"]+)";/,
      'const CACHE = "$1-account-qa";',
    ),
  );
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration()).waiting,
  );
  await page.close();
  page = await context.newPage();
  watch(page);
  await page.goto(home + "/login/");
  await login();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS: authenticated route gates, direct refresh, old demo flags ignored, no public registration/sample entry, mobile layout, reset form, manifest, offline shell and waiting service-worker update.",
  );
} finally {
  fs.writeFileSync(swFile, original);
  await browser.close();
}

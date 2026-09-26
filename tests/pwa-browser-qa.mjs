const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? process.env.PLAYWRIGHT_MODULE + "/index.mjs"
    : "playwright"
);
import fs from "node:fs";
import assert from "node:assert/strict";
const c = JSON.parse(fs.readFileSync(process.env.QA_CREDENTIALS, "utf8"));
const origin = process.env.QA_ORIGIN || "http://127.0.0.1:5174";
(async () => {
  const swFile = "dist/sw.js",
    original = fs.readFileSync(swFile, "utf8");
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    let page = await context.newPage();
    const errors = [];
    const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
    watch(page);
    await page.goto(origin);
    await page
      .getByLabel("Email", { exact: true })
      .fill(c.worker.replace("worker", "other"));
    await page.getByLabel("Password", { exact: true }).fill(c.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: /Browser QA forbidden/ }).click();
    await page
      .getByRole("button", { name: "Search all designs", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Search all designs" })
      .fill("qa001");
    await page
      .getByRole("button", { name: /Browser QA design.*QA-001/ })
      .click();
    await page.getByRole("button", { name: "Start work", exact: true }).click();
    await page.getByText("WORKING", { exact: true }).waitFor();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const manifest = await (
      await context.request.get(origin + "/manifest.webmanifest")
    ).json();
    assert.equal(manifest.display, "standalone");
    assert.ok(manifest.icons.some((i) => i.sizes === "512x512"));
    console.log("production service worker, manifest and first-visit precache");
    fs.writeFileSync(
      swFile,
      original.replace(
        /const CACHE = "([^"]+)";/,
        'const CACHE = "$1-qa-update";',
      ),
    );
    await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      await r.update();
    });
    await page.waitForFunction(
      async () => !!(await navigator.serviceWorker.getRegistration()).waiting,
    );
    await page.getByText("WORKING", { exact: true }).waitFor();
    console.log("application update waits while session stays active");
    await page.close();
    page = await context.newPage();
    watch(page);
    await page.goto(origin);
    await page.getByText("WORKING", { exact: true }).waitFor();
    await context.setOffline(true);
    for (const state of ["WORKING", "WALKING", "INTERRUPTION"]) {
      if (state === "WALKING")
        await page
          .getByRole("button", { name: "Walking", exact: true })
          .click();
      if (state === "INTERRUPTION") {
        await page.getByRole("button", { name: "Resume work" }).click();
        await page
          .getByRole("button", { name: "Interruption", exact: true })
          .click();
      }
      await page.getByText(state, { exact: true }).waitFor();
      await page.reload();
      await page.getByText(state, { exact: true }).waitFor();
      await page.close();
      page = await context.newPage();
      watch(page);
      await page.goto(origin);
      await page.getByText(state, { exact: true }).waitFor();
      console.log("production offline refresh/reopen " + state);
    }
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await page.getByLabel("Quantity completed").fill("1");
    await page.getByRole("button", { name: "Save quantity" }).click();
    await page.getByRole("heading", { name: "1 units recorded." }).waitFor();
    await context.setOffline(false);
    await page.getByRole("button", { name: "Sync now" }).click();
    await page.getByRole("button", { name: "Next activity" }).click();
    await page.getByRole("button", { name: /Browser QA forbidden/ }).waitFor();
    const urls = await page.evaluate(async () => {
      const out = [];
      for (const k of await caches.keys()) {
        for (const req of await (await caches.open(k)).keys())
          out.push(req.url);
      }
      return out;
    });
    assert.ok(
      urls.every(
        (u) =>
          u.startsWith(origin) &&
          !u.includes("/rest/") &&
          !u.includes("/auth/"),
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        pwaQA: "PASS",
        offlineAllStates: true,
        updatePreservedSession: true,
        cachedManufacturingResponses: false,
        errors,
      }),
    );
  } finally {
    fs.writeFileSync(swFile, original);
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

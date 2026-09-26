/* Runs against a dedicated seeded QA workspace. Never use production employee credentials. */
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? process.env.PLAYWRIGHT_MODULE + "/index.mjs"
    : "playwright"
);
import fs from "node:fs";
import assert from "node:assert/strict";
const config = JSON.parse(fs.readFileSync(process.env.QA_CREDENTIALS, "utf8"));
const origin = process.env.QA_ORIGIN || "http://localhost:5173";
const artifacts = process.env.QA_ARTIFACTS || "../../work";
const tag = Date.now();
const checks = [];
const mark = (text) => {
  checks.push(text);
  console.log(text);
};
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  let page = await context.newPage();
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(e.message));
  watch(page);
  const waitState = async (name) =>
    page.getByText(name, { exact: true }).waitFor();
  const double = async (name) => {
    const button = page.getByRole("button", { name, exact: true });
    await button.waitFor();
    for (let i = 0; i < 300 && !(await button.isEnabled()); i++)
      await page.waitForTimeout(50);
    assert.ok(await button.isEnabled(), name + " enabled");
    await button.evaluate((el) => {
      el.click();
      el.click();
    });
  };
  const overflow = async (label) => {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      label,
    );
  };
  const login = async (p, email) => {
    await p.goto(origin);
    await p.getByLabel("Email", { exact: true }).fill(email);
    await p.getByLabel("Password", { exact: true }).fill(config.password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  await login(page, config.worker);
  await page.getByRole("button", { name: /Browser QA prep/ }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Employees", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /Browser QA forbidden/ }).count(),
    0,
  );
  mark("real Supabase password sign-in and employee permissions");
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await overflow("activities " + width);
  }
  await page.getByRole("button", { name: /Browser QA prep/ }).click();
  await page
    .getByRole("button", { name: "Search all designs", exact: true })
    .click();
  for (const q of [
    "QA-001",
    "qa-001",
    "qa001",
    "001",
    "Browser QA design",
    "BROWSER QA DESIGN",
    "design",
  ]) {
    await page.getByRole("textbox", { name: "Search all designs" }).fill(q);
    await page
      .getByRole("button", { name: /Browser QA design.*QA-001/ })
      .waitFor();
  }
  mark("full/partial/case-insensitive SKU and design searches");
  await page.getByRole("button", { name: "Back to assignments" }).click();
  await page.getByRole("button", { name: /Browser QA design.*QA-001/ }).click();
  await double("Start work");
  await waitState("WORKING");
  for (const state of ["WORKING", "WALKING", "INTERRUPTION"]) {
    if (state === "WALKING") await double("Walking");
    if (state === "INTERRUPTION") {
      await double("Resume work");
      await double("Interruption");
    }
    await waitState(state);
    await page.reload();
    await waitState(state);
    await page.close();
    page = await context.newPage();
    watch(page);
    await page.goto(origin);
    await waitState(state);
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await overflow(state + " " + width);
    }
    await page.screenshot({
      path: `${artifacts}/qa-${state.toLowerCase()}.png`,
      fullPage: true,
    });
    mark("refresh and close/reopen " + state);
  }
  const toSeconds = (s) => s.split(":").reduce((a, b) => a * 60 + Number(b), 0);
  const before = toSeconds(
    await page.getByLabel("Elapsed total time").textContent(),
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((r) => setTimeout(r, 2100));
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await page.bringToFront();
  await page.waitForTimeout(1100);
  assert.ok(
    toSeconds(await page.getByLabel("Elapsed total time").textContent()) >=
      before + 2,
  );
  mark("browser suspension reconstructs elapsed from timestamps");
  await double("Resume work");
  await context.setOffline(true);
  await double("Walking");
  await waitState("WALKING");
  await double("Resume work");
  await double("Interruption");
  await double("Resume work");
  await double("Finish");
  await page.getByRole("heading", { name: "How many units?" }).waitFor();
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await overflow("quantity " + width);
  }
  await page.getByLabel("Quantity completed").fill("30");
  await double("Save quantity");
  await page.getByRole("heading", { name: "30 units recorded." }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Next activity" }).isEnabled(),
    false,
  );
  mark("offline transitions finish and quantity remain durable");
  await context.setOffline(false);
  await page.getByRole("button", { name: "Sync now" }).click();
  await page
    .getByRole("button", { name: "Next activity" })
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Next activity" }).click();
  await page.getByRole("button", { name: /Browser QA prep/ }).waitFor();
  await page.getByRole("button", { name: /Browser QA prep/ }).click();
  assert.equal(
    await page
      .getByRole("button", { name: /Browser QA design.*QA-001/ })
      .count(),
    0,
  );
  mark("assignment completes and clears from current work");
  await page
    .getByRole("button", { name: "Search all designs", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search all designs" })
    .fill("QA-002");
  await page
    .getByRole("button", { name: /Browser QA other design.*QA-002/ })
    .click();
  await double("Start work");
  await waitState("WORKING");
  await double("Finish");
  await page.getByLabel("Quantity completed").fill("0");
  await double("Save quantity");
  await page.getByRole("heading", { name: "0 units recorded." }).waitFor();
  mark("immediate next session and zero quantity");
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const admin = await adminContext.newPage();
  watch(admin);
  await login(admin, config.admin);
  await admin
    .getByRole("heading", { name: "The studio, at a glance." })
    .waitFor();
  for (const name of [
    "Employees",
    "Positions",
    "Permissions",
    "Activities",
    "Designs",
    "Assignments",
    "KPIs",
    "Settings",
    "Analytics",
    "Dashboard",
  ]) {
    await admin.getByRole("button", { name, exact: true }).click();
    await admin.waitForTimeout(250);
    assert.equal(
      await admin.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "desktop " + name,
    );
  }
  await admin.screenshot({
    path: `${artifacts}/qa-dashboard.png`,
    fullPage: true,
  });
  mark("all desktop management routes");
  await admin.getByRole("button", { name: "Positions", exact: true }).click();
  await admin.getByRole("button", { name: "Add position" }).click();
  await admin
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(`Browser QA new station ${tag}`);
  await admin.getByRole("button", { name: "Save changes" }).click();
  await admin
    .getByText(`Browser QA new station ${tag}`, { exact: true })
    .waitFor();
  await admin.getByRole("button", { name: "Activities", exact: true }).click();
  await admin.getByRole("button", { name: "Add activity" }).click();
  await admin
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(`Browser QA new activity ${tag}`);
  await admin.getByLabel("Browser QA position", { exact: true }).check();
  await admin.getByRole("button", { name: "Save changes" }).click();
  await admin
    .getByText(`Browser QA new activity ${tag}`, { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Next activity" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: new RegExp("Browser QA new activity " + tag) })
    .waitFor();
  mark("management mutations propagate to worker");
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${artifacts}/qa-browser-results.json`,
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

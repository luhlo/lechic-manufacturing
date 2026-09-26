const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? process.env.PLAYWRIGHT_MODULE + "/index.mjs"
    : "playwright"
);
import fs from "node:fs";
import assert from "node:assert/strict";
const c = JSON.parse(fs.readFileSync(process.env.QA_CREDENTIALS, "utf8"));
const origin = process.env.QA_ORIGIN || "http://localhost:5173";
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const tag = Date.now(),
    name = `Browser QA ${tag}`;
  await p.goto(origin);
  await p.getByLabel("Email", { exact: true }).fill(c.admin);
  await p.getByLabel("Password", { exact: true }).fill(c.password);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.getByRole("heading", { name: "The studio, at a glance." }).waitFor();
  const nav = async (n) =>
    p.getByRole("button", { name: n, exact: true }).click();
  const pick = async (label, value) => {
    await p.getByRole("combobox", { name: label, exact: true }).click();
    await p.getByRole("option", { name: value, exact: true }).click();
  };
  const save = async () => {
    await p.getByRole("button", { name: "Save changes" }).click();
    await p.getByRole("dialog").waitFor({ state: "hidden" });
  };
  const edit = async (text) =>
    p
      .getByRole("row")
      .filter({ hasText: text })
      .getByRole("button", { name: "Edit" })
      .click();
  await nav("Positions");
  await p.getByRole("button", { name: "Add position" }).click();
  await p
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(name + " position");
  await save();
  await edit(name + " position");
  await p
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(name + " station");
  await save();
  await edit(name + " station");
  await p.getByLabel("Active", { exact: true }).uncheck();
  await save();
  assert.match(
    await p
      .getByRole("row")
      .filter({ hasText: name + " station" })
      .textContent(),
    /Inactive/i,
  );
  console.log("position create/edit/deactivate");
  await nav("Employees");
  await p.getByRole("button", { name: "Add employee" }).click();
  await p.getByLabel("Employee name", { exact: true }).fill(name + " employee");
  await p
    .getByLabel("Email used to sign in")
    .fill(`browser-qa-${tag}@example.invalid`);
  await pick("Position", "Browser QA position");
  await save();
  await edit(name + " employee");
  await p.getByLabel("Active", { exact: true }).uncheck();
  await save();
  console.log("employee creation/deactivation");
  await nav("Designs");
  await p.getByRole("button", { name: "Add design" }).click();
  await p.getByLabel("Design / style name").fill(name + " design");
  await p.getByLabel("SKU", { exact: true }).fill("BQA-" + tag);
  await save();
  await edit(name + " design");
  await p.getByLabel("Design / style name").fill(name + " design renamed");
  await save();
  console.log("design create/edit");
  await nav("Activities");
  await p.getByRole("button", { name: "Add activity" }).click();
  await p
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(name + " activity");
  await p.getByLabel("Browser QA position", { exact: true }).check();
  await save();
  await edit(name + " activity");
  await p
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(name + " activity renamed");
  await save();
  await edit(name + " activity renamed");
  await p.getByLabel("Active", { exact: true }).uncheck();
  await save();
  console.log("activity create/edit/deactivate and position relationship");
  await nav("Assignments");
  await p.getByRole("button", { name: "Add assignment" }).click();
  await pick("Employee", "Browser QA Worker");
  await pick("Design", name + " design renamed");
  await p.getByLabel("Notes (optional)").fill("Browser QA optional quantity");
  await save();
  console.log("assignment optional quantity/date/notes");
  await nav("KPIs");
  await p.getByRole("button", { name: "Add KPI target" }).click();
  await pick("Activity", "Browser QA prep");
  await pick("Design (optional)", name + " design renamed");
  await p.getByLabel("Target units per productive hour").fill("40");
  await save();
  console.log("activity/design KPI creation");
  await nav("Permissions");
  await p.getByRole("button", { name: "Add role" }).click();
  await p
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(name + " analyst");
  await p.getByLabel("View analytics", { exact: true }).check();
  await save();
  await p.getByRole("tab", { name: "Assign roles", exact: true }).click();
  await pick("Employee", name + " employee");
  await p.getByLabel(name + " analyst", { exact: true }).check();
  await p.getByRole("button", { name: "Save roles", exact: true }).click();
  await p.getByText("Roles saved", { exact: true }).waitFor();
  console.log("capability role and employee role assignment");
  await nav("Settings");
  for (const value of [
    "Target only",
    "Target and actual",
    "Off — no KPI display",
  ]) {
    await pick("Employee view", value);
    await p.getByRole("button", { name: "Save setting" }).click();
    await p.getByText("Settings saved", { exact: true }).first().waitFor();
  }
  console.log("all KPI visibility settings");
  await nav("Analytics");
  const units = () =>
    p
      .locator(".primary-metrics .metric")
      .first()
      .locator("strong")
      .textContent();
  const settle = async () => {
    await p.waitForTimeout(350);
    await p
      .getByText("Loading manufacturing records…", { exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(await p.locator("main [role=alert]").count(), 0);
  };
  await settle();
  assert.ok(Number(await units()) > 0);
  for (const [field, value, reset] of [
    ["Employee", "Browser QA Other", "All employees"],
    ["Position", "Browser QA unrelated", "All positions"],
    ["Activity", "Browser QA forbidden", "All activities"],
    ["Design", name + " design renamed", "All designs"],
  ]) {
    await pick(field, value);
    await settle();
    assert.equal(Number(await units()), 0, field);
    await pick(field, reset);
    await settle();
    assert.ok(Number(await units()) > 0, field + " reset");
  }
  await p.getByPlaceholder("Filter by SKU").fill("NO-MATCH");
  await settle();
  assert.equal(Number(await units()), 0);
  await p.getByPlaceholder("Filter by SKU").fill("qa001");
  await settle();
  assert.ok(Number(await units()) > 0);
  await p.getByLabel("From date").fill("2099-01-01");
  await p.getByLabel("Through date").fill("2099-01-02");
  await settle();
  assert.equal(Number(await units()), 0);
  console.log("all six analytics filters change actual data");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ adminQA: "PASS", errors }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

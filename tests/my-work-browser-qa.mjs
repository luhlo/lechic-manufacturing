/* Local browser integration using the real UI/SessionStore and an intercepted Supabase boundary.
   No credentials or requests reach the production database. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCommand } from "../lib/manufacturing/domain.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE + "/index.mjs");
const origin = process.env.QA_ORIGIN || "http://127.0.0.1:5186";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const id = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = new Date();
const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const catalog = {
  profiles: [
    {
      id: id(1),
      auth_user_id: id(1),
      name: "Ileana QA",
      email: "qa@example.invalid",
      position_id: id(2),
      active: true,
    },
  ],
  positions: [{ id: id(2), name: "Painter", active: true }],
  activities: [
    {
      id: id(3),
      name: "A production",
      active: true,
      requires_design: true,
      requires_quantity: true,
    },
    {
      id: id(4),
      name: "B inspection",
      active: true,
      requires_design: true,
      requires_quantity: false,
    },
    {
      id: id(5),
      name: "C bulk",
      active: true,
      requires_design: false,
      requires_quantity: true,
    },
    {
      id: id(6),
      name: "D cleaning",
      active: true,
      requires_design: false,
      requires_quantity: false,
    },
  ],
  activity_positions: [3, 4, 5, 6].map((n) => ({
    activity_id: id(n),
    position_id: id(2),
  })),
  products: [
    { id: id(7), name: "Monarch QA", sku: "MON-001", active: true },
    { id: id(8), name: "Poppy QA", sku: "POP-002", active: true },
  ],
  assignments: [
    {
      id: id(9),
      employee_id: id(1),
      product_id: id(7),
      work_date: today,
      status: "assigned",
      target_quantity: 30,
      notes: "",
    },
  ],
  roles: [],
  role_permissions: [],
  profile_roles: [],
  position_roles: [],
  kpi_targets: [],
  settings: [],
};
const profile = catalog.profiles[0];
let server = null,
  offline = false;
const receipts = new Map();
const calls = [];
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block",
});
const jwt =
  [
    { alg: "HS256", typ: "JWT" },
    {
      sub: id(1),
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  ]
    .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
    .join(".") + ".qa";
await context.addInitScript(
  ({ jwt, user }) => {
    localStorage.setItem(
      "lechic-manufacturing-auth",
      JSON.stringify({
        access_token: jwt,
        refresh_token: "qa-refresh",
        token_type: "bearer",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        user: {
          id: user,
          email: "qa@example.invalid",
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {},
          user_metadata: {},
        },
      }),
    );
  },
  { jwt, user: id(1) },
);
await context.route("**/*", async (route) => {
  const request = route.request(),
    url = new URL(request.url());
  if (url.origin === origin) return route.continue();
  if (!url.hostname.endsWith(".supabase.co")) return route.abort();
  if (offline) return route.abort();
  const send = (data) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  if (url.pathname.endsWith("/auth/v1/user"))
    return send({ id: id(1), email: profile.email });
  if (url.pathname.includes("/rpc/")) {
    const name = url.pathname.split("/").at(-1);
    calls.push(name);
    if (name === "app_context")
      return send({
        profile,
        permissions: ["my_work.access"],
        visibility: "OFF",
      });
    if (name === "employee_directory") return send([profile]);
    if (name === "active_session")
      return send(server?.status === "completed" ? null : server);
    if (name === "session_command") {
      const c = request.postDataJSON().p;
      if (receipts.has(c.request_id)) return send(receipts.get(c.request_id));
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (c.action === "start") {
        assert.ok(!server || server.status === "completed");
        const a = catalog.activities.find((a) => a.id === c.activity_id),
          p = catalog.products.find((p) => p.id === c.product_id);
        assert.equal(!!p, a.requires_design);
        server = {
          id: c.session_id,
          employee_id: profile.id,
          position_id: profile.position_id,
          activity_id: a.id,
          product_id: p?.id ?? null,
          assignment_id: c.assignment_id ?? null,
          employee_name: profile.name,
          position_name: "Painter",
          activity_name: a.name,
          product_name: p?.name ?? "",
          sku: p?.sku ?? "",
          requires_design: a.requires_design,
          requires_quantity: a.requires_quantity,
          started_at: c.at,
          ended_at: null,
          status: "running",
          quantity: null,
          revision: 1,
          segments: [
            {
              id: c.request_id,
              session_id: c.session_id,
              kind: "WORK",
              started_at: c.at,
              ended_at: null,
            },
          ],
        };
      } else server = applyCommand(server, c);
      receipts.set(c.request_id, structuredClone(server));
      return send(server);
    }
    throw Error("Unexpected RPC " + name);
  }
  const table = url.pathname.split("/").at(-1);
  if (table in catalog) return send(catalog[table]);
  throw Error("Unexpected request " + url.pathname);
});
let page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const button = (name) => page.getByRole("button", { name, exact: true });
const widths = [320, 375, 390, 430, 1440];
async function qaLayout(stage) {
  console.log("Checking", stage);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      stage + " overflow " + width,
    );
    const sizes = await page
      .locator(".employee-panel button:visible")
      .evaluateAll((es) =>
        es.map((el) => ({
          text: el.textContent,
          height: el.getBoundingClientRect().height,
        })),
      );
    assert.ok(
      sizes.every((s) => s.height >= 44),
      stage + " targets " + width,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (process.env.QA_ARTIFACTS) {
    fs.mkdirSync(process.env.QA_ARTIFACTS, { recursive: true });
    await page.screenshot({
      path: process.env.QA_ARTIFACTS + "/" + stage + ".png",
      fullPage: true,
    });
  }
}
const heading = (text) =>
  page.getByRole("heading", { name: text, exact: true }).waitFor();
try {
  await page.goto(origin + "/work");
  await heading("What are you working on?");
  await qaLayout("home");
  assert.equal(await button("Employees").count(), 0);
  await button("A production").click();
  await heading("Choose a design");
  await qaLayout("assignments");
  assert.ok(
    (await page.getByRole("heading", { name: "Today’s work" }).boundingBox())
      .y < (await button("Search another design").boundingBox()).y,
  );
  await page
    .getByRole("button", { name: /Monarch QA.*MON-001.*30 assigned/ })
    .click();
  await button("START").click();
  await page.getByText("WORKING", { exact: true }).waitFor();
  await qaLayout("active");
  assert.equal(calls.includes("employee_kpi"), false);
  await button("WALKING").click();
  await button("RESUME WORK").waitFor();
  assert.equal(server.segments.at(-1).kind, "WALKING");
  await page.goto(origin + "/admin");
  await button("RESUME WORK").waitFor();
  assert.ok(page.url().endsWith("/work"));
  await button("RESUME WORK").click();
  await button("INTERRUPTION").click();
  await button("RESUME WORK").waitFor();
  await page.reload();
  await button("RESUME WORK").waitFor();
  assert.equal(server.segments.at(-1).kind, "INTERRUPTION");
  await button("RESUME WORK").click();
  await button("FINISH").click();
  await heading("How many did you complete?");
  await qaLayout("quantity");
  assert.equal(
    await page.getByLabel("Quantity completed").getAttribute("inputmode"),
    "numeric",
  );
  await page.getByLabel("Quantity completed").fill("24");
  await button("SAVE").click();
  await heading("24 completed");
  await qaLayout("receipt");
  await button("Continue same activity").click();
  await heading("Choose a design");
  await button("Search another design").click();
  for (const q of ["poppy", "POP-002", "pop-0", "ppy", "002"]) {
    await page.getByLabel("Search by design name or SKU").fill(q);
    await page.getByRole("button", { name: /Poppy QA.*POP-002/ }).waitFor();
  }
  await qaLayout("search");
  await page.getByRole("button", { name: /Poppy QA.*POP-002/ }).click();
  await button("START").click();
  await button("FINISH").click();
  await page.getByLabel("Quantity completed").fill("0");
  await button("SAVE").click();
  await heading("0 completed");
  await button("Choose different activity").click();
  for (const [name, design, quantity] of [
    ["B inspection", true, false],
    ["C bulk", false, true],
    ["D cleaning", false, false],
  ]) {
    await button(name).click();
    if (design)
      await page
        .getByRole("button", { name: /Monarch QA.*30 assigned/ })
        .click();
    else
      assert.equal(
        await page
          .getByRole("heading", { name: "Choose a design", exact: true })
          .count(),
        0,
      );
    await button("START").click();
    await button("FINISH").click();
    if (quantity) {
      await heading("How many did you complete?");
      await page.getByLabel("Quantity completed").fill("7");
      await button("SAVE").click();
      await heading("7 completed");
    } else {
      await heading("Activity completed");
      assert.equal(server.quantity, null);
    }
    await button("Choose different activity").click();
  }
  // Existing IndexedDB queue preserves timestamp transitions and offline Finish until sync.
  await button("D cleaning").click();
  await button("START").click();
  await button("WALKING").waitFor();
  offline = true;
  await context.setOffline(true);
  await button("WALKING").click();
  await button("RESUME WORK").waitFor();
  await button("RESUME WORK").click();
  await button("FINISH").click();
  await heading("Activity completed");
  assert.equal(await button("Continue same activity").isEnabled(), false);
  await context.setOffline(false);
  offline = false;
  await button("Sync now").click();
  await button("Continue same activity").waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent.includes("Continue same activity"),
      ).disabled,
  );
  assert.equal(server.status, "completed");
  assert.equal(server.quantity, null);
  assert.deepEqual(errors, []);
  const report = {
    scenarios:
      "A–J passed against intercepted Supabase; real UI, durable SessionStore and IndexedDB",
    widths,
    touchTargets: "All visible employee buttons at least 44px",
    startTaps: 3,
    completion: "Finish → numeric entry → Save",
    continuation: "Continue same activity → Design → Start",
    liveDatabaseWrites: 0,
  };
  fs.mkdirSync(process.env.QA_ARTIFACTS || "../../work", { recursive: true });
  fs.writeFileSync(
    (process.env.QA_ARTIFACTS || "../../work") +
      "/my-work-browser-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await browser.close();
}

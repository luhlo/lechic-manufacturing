// Local browser fixtures only. Every external request is intercepted; no accounts,
// emails, device approvals or manufacturing records are created in Supabase.
import assert from "node:assert/strict";
import fs from "node:fs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? process.env.PLAYWRIGHT_MODULE + "/index.mjs"
    : "playwright"
);
const origin = process.env.QA_ORIGIN || "http://127.0.0.1:5177";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  serviceWorkers: "block",
  viewport: { width: 390, height: 844 },
});
const requests = [],
  errors = [];
await context.route("**/*", async (route) => {
  if (
    route
      .request()
      .url()
      .startsWith(origin + "/")
  )
    return route.continue();
  const request = route.request();
  requests.push({ url: request.url(), body: request.postDataJSON() });
  if (request.url().endsWith("/functions/v1/manufacturing-login")) {
    const message =
      request.postDataJSON().action === "pin"
        ? "PIN not recognized. Please try again."
        : "Username or password is incorrect.";
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: message }),
    });
  }
  if (request.url().includes("/auth/v1/token?"))
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: "Invalid login credentials",
      }),
    });
  throw Error("Unexpected external request: " + request.url());
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(origin + "/login/");
  await page
    .getByLabel("Email or username", { exact: true })
    .fill("worker.one");
  await page.getByLabel("Password", { exact: true }).fill("local fixture only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByText("Username or password is incorrect.", { exact: true })
    .waitFor();
  assert.deepEqual(requests[0].body, {
    action: "username",
    username: "worker.one",
    password: "local fixture only",
  });
  await page
    .getByLabel("Email or username", { exact: true })
    .fill("worker@example.invalid");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("Invalid login credentials", { exact: true }).waitFor();
  assert.ok(requests[1].url.includes("/auth/v1/token?grant_type=password"));
  await page.getByRole("button", { name: "4-digit PIN", exact: true }).click();
  await page
    .getByText(/Ask a manager to sign in with their password/)
    .waitFor();
  assert.equal(
    await page.getByLabel("Four-digit PIN", { exact: true }).count(),
    0,
  );
  const device = {
    id: "local-device",
    name: "QA tablet",
    token: "c".repeat(64),
    expires_at: "2099-01-01T00:00:00Z",
  };
  await page.evaluate(
    (value) =>
      localStorage.setItem(
        "lechic-manufacturing-pin-device",
        JSON.stringify(value),
      ),
    device,
  );
  await page.reload();
  const pin = page.getByLabel("Four-digit PIN", { exact: true });
  await pin.fill("012");
  assert.equal(requests.length, 2, "three digits do not submit");
  await pin.pressSequentially("3");
  await page
    .getByText("PIN not recognized. Please try again.", { exact: true })
    .waitFor();
  assert.equal(
    requests.length,
    3,
    "four digits submit exactly once without a button click",
  );
  assert.deepEqual(requests[2].body, {
    action: "pin",
    pin: "0123",
    device_token: device.token,
  });
  assert.equal(await pin.inputValue(), "", "PIN cleared after attempt");
  assert.equal(
    await page.getByLabel("Email or username", { exact: true }).count(),
    0,
  );
  assert.equal(await page.getByLabel("Password", { exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() =>
      Object.values(localStorage).join("").includes("0123"),
    ),
    false,
    "PIN is not persisted",
  );
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "PIN layout fits " + width,
    );
  }
  fs.mkdirSync("../../work/deployment", { recursive: true });
  await page.screenshot({
    path: "../../work/deployment/pin-login-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Email / username", exact: true })
    .click();
  await page.getByLabel("Email or username", { exact: true }).waitFor();
  await page.screenshot({
    path: "../../work/deployment/username-login-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page
      .getByRole("button", { name: "First time here?", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: /Explore with sample data/ })
      .count(),
    0,
  );
  await page
    .getByText(
      "Accounts are created by an administrator. Public registration is not available.",
      { exact: true },
    )
    .waitFor();
  await page
    .getByRole("button", { name: "Forgot password?", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Password", { exact: true }).count(), 0);
  assert.equal(
    requests.length,
    3,
    "checking the reset screen does not send email",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: email/username routing, unapproved-device guidance, four-digit automatic PIN submission, secret clearing, mobile layout reset screen, and no public registration or sample entry; all external requests mocked.",
  );
} finally {
  await browser.close();
}

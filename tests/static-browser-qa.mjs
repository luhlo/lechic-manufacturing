/* Static deployment checks use only the existing local sample workspace.
   No production Supabase records or authentication accounts are created. */
import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? process.env.PLAYWRIGHT_MODULE + "/index.mjs" : "playwright");
const origin = process.env.QA_ORIGIN || "http://127.0.0.1:5175";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Run static QA only against the local static server");
const base = process.env.QA_BASE_PATH || "/";
const appOrigin = origin + base.replace(/\/$/, "");
const artifacts = process.env.QA_ARTIFACTS || "../../work/deployment";
fs.mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
const context = await browser.newContext({viewport:{width:1440,height:1000}});
const errors = [], external = [], checks = [];
const mark = (s) => { checks.push(s); console.log(s); };
const watch = (p) => p.on("pageerror", e => errors.push(e.message));
await context.route("**/*", route => {
  if (!route.request().url().startsWith(origin + "/")) { external.push(route.request().url()); return route.abort(); }
  return route.continue();
});
let page = await context.newPage(); watch(page);
const swFile = "dist/sw.js", original = fs.readFileSync(swFile,"utf8");
const routes = {
  "/admin":"The studio, at a glance.", "/admin/employees":"Employees",
  "/admin/activities":"Activities", "/admin/assignments":"Assignments",
  "/admin/kpis":"KPI targets", "/analytics":"Manufacturing analytics",
};
const overflow = async (label) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, label);
const mobileWidths = async (label) => {
  for (const width of [320,375,390,430]) { await page.setViewportSize({width,height:844}); await overflow(label+" "+width); }
};
const activeSnapshot = async () => page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem("manufacturing-demo"));
  const session = db.sessions.find(s => s.status !== "completed");
  return session ? {id:session.id,started_at:session.started_at} : null;
});
try {
  for (const path of ["/login",...Object.keys(routes)]) {
    const response = await page.goto(appOrigin+path);
    assert.equal(response.status(),200,path);
    assert.equal(new URL(page.url()).pathname.replace(/\/$/, ""),appOrigin.slice(origin.length)+path,"deep-link URL preserved");
    await page.getByRole("button", {name:"Sign in",exact:true}).waitFor();
    await page.reload();
    await page.getByRole("button", {name:"Sign in",exact:true}).waitFor();
  }
  mark("Every requested nested route directly loads and refreshes behind sign-in");
  await page.getByRole("button", {name:/Explore with sample data/}).click();
  await page.getByRole("heading",{name:routes["/analytics"],exact:true}).waitFor();
  for (const [path,title] of Object.entries(routes)) {
    await page.goto(appOrigin+path);
    await page.getByRole("heading",{name:title,exact:true}).waitFor();
    await page.reload();
    await page.getByRole("heading",{name:title,exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname.replace(/\/$/, ""),appOrigin.slice(origin.length)+path);
    await overflow(path+" desktop");
  }
  await page.getByRole("button",{name:"Employees",exact:true}).click();
  assert.equal(new URL(page.url()).pathname,appOrigin.slice(origin.length)+"/admin/employees");
  await page.goBack();
  await page.getByRole("heading",{name:routes["/analytics"],exact:true}).waitFor();
  await page.goForward();
  await page.getByRole("heading",{name:"Employees",exact:true}).waitFor();
  await page.screenshot({path:artifacts+"/static-admin.png",fullPage:true});
  mark("Direct admin screens, refresh, desktop layout, URL navigation, Back and Forward");
  await page.goto(appOrigin+"/work");
  await page.getByRole("button",{name:/Preparation/}).waitFor();
  await mobileWidths("activities");
  await page.getByRole("button",{name:/Preparation/}).click();
  await mobileWidths("assignments");
  await page.getByRole("button",{name:/Sample arc.*DEMO-001/}).click();
  await mobileWidths("start confirmation");
  await page.getByRole("button",{name:"Start work",exact:true}).click();
  await page.getByText("WORKING",{exact:true}).waitFor();
  const originalSession = await activeSnapshot(); assert.ok(originalSession?.started_at);
  await page.evaluate(async () => {await navigator.serviceWorker.ready;});
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const manifestResponse = await context.request.get(appOrigin+"/manifest.webmanifest");
  assert.match(manifestResponse.headers()["content-type"],/manifest|json/);
  const manifest = await manifestResponse.json();
  for (const key of ["id","scope","start_url"]) assert.equal(manifest[key],base);
  assert.equal(manifest.display,"standalone");
  for (const icon of manifest.icons) {
    const response = await context.request.get(origin+icon.src);
    assert.equal(response.status(),200); assert.match(response.headers()["content-type"],/image\/png/);
    const dimensions = await page.evaluate(async src => {
      const i=new Image();i.src=src; await i.decode();return `${i.naturalWidth}x${i.naturalHeight}`;
    },icon.src);
    assert.equal(dimensions,icon.sizes);
  }
  const sw = await context.request.get(appOrigin+"/sw.js");
  assert.match(sw.headers()["content-type"],/javascript/);
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope), origin+base);
  mark("Manifest, icon sizes, repository scope and production SW control");
  fs.writeFileSync(swFile,original.replace(/const CACHE = "([^"]+)";/,'const CACHE = "$1-deployment-qa";'));
  await page.evaluate(async () => {await (await navigator.serviceWorker.getRegistration()).update();});
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
  await page.getByText("WORKING",{exact:true}).waitFor();
  await page.close(); page=await context.newPage();watch(page);
  await page.goto(appOrigin+"/work");
  await page.getByText("WORKING",{exact:true}).waitFor();
  await page.waitForFunction(async () => (await caches.keys()).some(k => k.endsWith("-deployment-qa")));
  await page.waitForFunction(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return !!navigator.serviceWorker.controller && r.active?.state === "activated" && !r.waiting;
  });
  assert.deepEqual(await activeSnapshot(),originalSession);
  mark("Waiting SW update activates after close/reopen and preserves session ID and starting timestamp");
  await context.setOffline(true);
  for (const state of ["WORKING","WALKING","INTERRUPTION"]) {
    if(state === "WALKING") await page.getByRole("button",{name:"Walking",exact:true}).click();
    if(state === "INTERRUPTION") {await page.getByRole("button",{name:"Resume work",exact:true}).click();await page.getByRole("button",{name:"Interruption",exact:true}).click();}
    await page.getByText(state,{exact:true}).waitFor();
    await mobileWidths(state);
    await page.reload();await page.getByText(state,{exact:true}).waitFor();
    await page.close();page=await context.newPage();watch(page);
    await page.goto(appOrigin+"/work");await page.getByText(state,{exact:true}).waitFor();
    assert.deepEqual(await activeSnapshot(),originalSession);
  }
  await page.setViewportSize({width:375,height:812});
  await overflow("mobile screenshot");
  await page.screenshot({path:artifacts+"/static-mobile.png",fullPage:true});
  await page.getByRole("button",{name:"Finish",exact:true}).click();
  await page.getByRole("heading",{name:"How many units?",exact:true}).waitFor();
  await mobileWidths("quantity");
  await page.reload();await page.getByRole("heading",{name:"How many units?",exact:true}).waitFor();
  await page.getByLabel("Quantity completed").fill("7");
  await page.getByRole("button",{name:"Save quantity",exact:true}).click();
  await page.getByRole("heading",{name:"7 units recorded.",exact:true}).waitFor();
  await mobileWidths("completion");
  await page.reload();await page.getByRole("heading",{name:"7 units recorded.",exact:true}).waitFor();
  mark("320/375/390/430px workflow; offline refresh/reopen in every timing state; unfinished quantity and completed receipt recovery");
  await context.setOffline(false);
  await page.getByRole("button",{name:"Sync now",exact:true}).click();
  await page.getByRole("button",{name:"Next activity",exact:true}).click();
  await page.getByRole("button",{name:/Preparation/}).waitFor();
  const cached = await page.evaluate(async () => {
    const urls=[];for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())urls.push(req.url);return urls;
  });
  assert.ok(cached.length>0);
  assert.ok(cached.every(u=>u.startsWith(origin+"/") && !/\/(auth|rest|api)\//.test(u)));
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
  mark("Queued transitions and quantity sync; cache contains only static files; no external API calls or JavaScript errors");
  const result={status:"PASS",scope:"local static host under " + base + ", isolated sample workspace",checks,errors,externalRequests:external};
  fs.writeFileSync(artifacts+"/static-browser-results.json",JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({path:artifacts+"/static-failure.png",fullPage:true}).catch(()=>{});
  console.error({url:page.url(), errors, external});
  throw error;
} finally {
  fs.writeFileSync(swFile,original);
  await browser.close();
}

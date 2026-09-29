import { createElement } from "react";
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignImage } from "../components/manufacturing/design-image";
import { parseSheetLink, sheetScript } from "../lib/manufacturing/sheet-sync";
import { createDesignSyncHandler } from "../supabase/functions/manufacturing-design-sync/handler";

test("blank and unsafe image URLs render no element or placeholder", () => {
  for (const url of [undefined, null, "", "  ", "http://example.com/x", "javascript:alert(1)"])
    expect(renderToStaticMarkup(createElement(DesignImage, {url, name:"Design"}))).toBe("");
  expect(renderToStaticMarkup(createElement(DesignImage, {url:"https://example.com/image.png",name:"Design"}))).toContain('<img');
});
test("sheet links are restricted to Google and preserve the selected tab", () => {
  expect(parseSheetLink("https://docs.google.com/spreadsheets/d/test-id/edit?gid=4#gid=5")).toEqual({spreadsheet_id:"test-id",sheet_id:"5"});
  for (const link of ["https://evil.com/spreadsheets/d/test/edit", "https://docs.google.com.evil.com/spreadsheets/d/test/edit", "javascript:alert(1)"])
    expect(() => parseSheetLink(link)).toThrow();
});
test("generated script sends only selected design columns and installs one timer", () => {
  const script = sheetScript({enabled:true,spreadsheet_id:"test-id",sheet_id:"7",last_sync:null,result:null,token:"f".repeat(64)},"https://example.invalid/sync");
  expect(script).toContain("@OnlyCurrentDoc");
  expect(script).toContain("getDisplayValues()");
  expect(script).toContain("everyMinutes(5)");
  expect(script).toContain("r[image].trim()");
  expect(() => new Function(script)).not.toThrow();
});
const request = (body: unknown) => new Request("https://example.invalid", {method:"POST",body:JSON.stringify(body)});
test("design sync uses a hash and server credential without exposing either in its response", async () => {
  let payload: Record<string,unknown> = {};
  const handler=createDesignSyncHandler({url:"https://example.invalid",serviceKey:"server-secret",fetcher:async (_url,init) => {
    payload=JSON.parse(String(init?.body));
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer server-secret");
    return Response.json({added:1,updated:0,unchanged:0,skipped:0});
  }});
  const response=await handler(request({token:"a".repeat(64),spreadsheet_id:"sheet",rows:[{name:"One",sku:"1",image_url:""}]}));
  expect(response.status).toBe(200);
  expect(payload.p_digest).toMatch(/^[a-f0-9]{64}$/);
  expect(payload.p_digest).not.toBe("a".repeat(64));
  expect(JSON.stringify(payload)).not.toContain('"token"');
  expect(await response.text()).not.toContain("secret");
});
test("invalid credentials and oversized input never reach database", async () => {
  let called=false;
  const handler=createDesignSyncHandler({url:"https://example.invalid",serviceKey:"secret",fetcher:async()=>{called=true;return Response.json({});}});
  expect((await handler(request({token:"bad",rows:[]}))).status).toBe(401);
  expect((await handler(request({token:"a".repeat(64),spreadsheet_id:"s",rows:Array(5001).fill({})}))).status).toBe(400);
  expect((await handler(request({token:"a".repeat(64),padding:"x".repeat(2_000_001)}))).status).toBe(413);
  expect(called).toBe(false);
});
test("authorization and validation errors are safe and actionable", async () => {
  for (const [code,status] of [["42501",401],["22023",400],["XX000",503]] as const) {
    const handler=createDesignSyncHandler({url:"https://example.invalid",serviceKey:"secret",fetcher:async()=>Response.json({code,message:"validation detail"},{status:400})});
    const response=await handler(request({token:"a".repeat(64),spreadsheet_id:"s",rows:[]}));
    expect(response.status).toBe(status);
    const text=await response.text();
    expect(text.includes("validation detail")).toBe(code==="22023");
  }
});

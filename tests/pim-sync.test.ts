import {expect,test} from "vitest";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {createCatalogHandler,safePhotoUrl} from "../integrations/pim/manufacturing-catalog/handler";
import {createPimSyncHandler} from "../supabase/functions/manufacturing-pim-sync/handler";
const source="https://caikfzxvlyzmqvgpvgye.supabase.co";
const token="a".repeat(64);
const row={product_id:"b3000000-0000-4000-8000-000000000001",variant_id:"b2000000-0000-4000-8000-000000000001",sku:"E-HP-WD-0001",name:"Earring",available:true,photo:null};
const snap={schema_version:1,source_project:"caikfzxvlyzmqvgpvgye",snapshot_at:new Date().toISOString(),complete:true,rows:[row]};
const req=(headers:Record<string,string>={})=>new Request("https://example.invalid",{method:"POST",headers});
test("PIM feed authenticates before reading and never exposes credential digests or private photo paths",async()=>{
 let calls=0;
 const handler=createCatalogHandler({serviceKey:"private",fetcher:async(_u,init)=>{calls++;expect(JSON.parse(String(init?.body)).p_digest).not.toBe(token);return Response.json(snap);}});
 expect((await handler(req())).status).toBe(401);expect(calls).toBe(0);
 const res=await handler(req({Authorization:`Bearer ${token}`}));const data=await res.json();
 expect(data.rows[0]).toEqual({...row,photo:undefined,image_url:null,image_key:null,image_expires_at:null});
 expect(JSON.stringify(data)).not.toContain("private");expect(calls).toBe(1);
});
test("PIM accepts only known photo hosts and does not fetch external image bytes",async()=>{
 for(const value of ["http://cdn.shopify.com/p.jpg","https://cdn.shopify.com.evil.com/p.jpg","https://user:pass@cdn.shopify.com/p.jpg","https://cdn.shopify.com:443/p.jpg","https://127.0.0.1/p.jpg"])expect(safePhotoUrl(value)).toBeNull();
 let calls=0;
 const handler=createCatalogHandler({serviceKey:"private",fetcher:async()=>{calls++;return Response.json({...snap,rows:[{...row,photo:{kind:"external",source_id:"image",url:"https://cdn.shopify.com/a.jpg"}}]});}});
 const data=await(await handler(req({Authorization:`Bearer ${token}`}))).json();expect(data.rows[0].image_url).toBe("https://cdn.shopify.com/a.jpg");expect(calls).toBe(1);
});
test("private photos are signed only for the current product and their location is not exported",async()=>{
 const path=`${row.product_id}/picture.jpg`;
 const handler=createCatalogHandler({serviceKey:"private",fetcher:async(url)=>String(url).includes("/rpc/")?Response.json({...snap,rows:[{...row,photo:{kind:"storage",bucket:"product-images",path,source_id:"image"}}]}):Response.json({signedURL:`/object/sign/product-images/${path}?token=synthetic`})});
 const data=await(await handler(req({Authorization:`Bearer ${token}`}))).json();expect(data.rows[0].image_url).toBe(`${source}/storage/v1/object/sign/product-images/${path}?token=synthetic`);expect(data.rows[0].photo).toBeUndefined();
 const bad=createCatalogHandler({serviceKey:"private",fetcher:async()=>Response.json({...snap,rows:[{...row,photo:{kind:"storage",bucket:"product-images",path:"other-user/private.jpg",source_id:"image"}}]})});
 expect((await bad(req({Authorization:`Bearer ${token}`}))).status).toBe(503);
});
test("sync claims before reading the pinned PIM feed and commits only a complete successful response",async()=>{
 const calls:string[]=[];
 const handler=createPimSyncHandler({url:"https://manufacturing.invalid",serviceKey:"own-key",fetcher:async(url,init)=>{
  calls.push(String(url));if(String(url).endsWith("pim_sync_begin"))return Response.json({lease:"lease",source_token:token});
  if(String(url).includes("manufacturing-catalog")){expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`);return Response.json(snap);}
  expect(JSON.parse(String(init?.body))).toEqual({p_lease:"lease",p_snapshot:snap});return Response.json({added:1});
 }});
 expect((await handler(req())).status).toBe(401);expect(calls).toHaveLength(0);
 expect(await(await handler(req({"x-sync-key":token}))).json()).toEqual({added:1});
 expect(calls).toEqual(["https://manufacturing.invalid/rest/v1/rpc/pim_sync_begin",`${source}/functions/v1/manufacturing-catalog`,"https://manufacturing.invalid/rest/v1/rpc/pim_sync_finish"]);
});
test("source failures and oversized responses never commit and release the lease for retry",async()=>{
 for(const response of [()=>new Response("private upstream failure",{status:500}),()=>new Response('"'+"x".repeat(4_000_001)+'"')]){
  const calls:string[]=[];
  const handler=createPimSyncHandler({url:"https://manufacturing.invalid",serviceKey:"own-key",fetcher:async(url)=>{
   calls.push(String(url));if(String(url).endsWith("pim_sync_begin"))return Response.json({lease:"lease",source_token:token});if(String(url).endsWith("pim_sync_fail"))return Response.json(null);return response();
  }});
  const res=await handler(req({"x-sync-key":token}));expect(res.status).toBe(503);expect(await res.text()).not.toContain("private upstream");expect(calls.some(c=>c.endsWith("pim_sync_finish"))).toBe(false);expect(calls.at(-1)).toContain("pim_sync_fail");
 }
});
test("source SQL scopes to earrings, includes unavailable SKUs, prefers variant photos, and protects its token",async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
 create table products(id uuid primary key,name text,status text,product_type_code text);
 create table variants(id uuid primary key,product_id uuid,sku text,name text,status text);
 create table product_assets(id uuid,product_id uuid,variant_id uuid,archived boolean,category text,storage_path text,external_url text,created_at timestamptz);
 create table product_images(id uuid,product_id uuid,position int,created_at timestamptz,storage_path text);
 create table marketplace_listings(id uuid,product_id uuid,variant_id uuid,created_at timestamptz,photos jsonb);`);
 await db.exec(readFileSync("integrations/pim/migrations/20261106073204_manufacturing_catalog_feed.sql","utf8"));
 await db.exec(`insert into private.manufacturing_catalog_access(token_digest) values(repeat('a',64));
 insert into products values('${row.product_id}','Earring','active','E'),('c3000000-0000-4000-8000-000000000001','Ornament','active','O');
 insert into variants values('${row.variant_id}','${row.product_id}','E-HP-WD-0001','Default Title','archived'),('c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','O-RB-WD-0002','','active');
 insert into product_assets values(gen_random_uuid(),'${row.product_id}',null,false,'white_background',null,'https://cdn.shopify.com/generic.jpg',now()),(gen_random_uuid(),'${row.product_id}','${row.variant_id}',false,'worn',null,'https://cdn.shopify.com/variant.jpg',now());`);
 await expect(db.query("select public.manufacturing_catalog_snapshot('bad')")).rejects.toThrow("Catalog access denied");
 const result=await db.query<{data:{rows:typeof row[]}}>("select public.manufacturing_catalog_snapshot(repeat('a',64)) as data");
 expect(result.rows[0].data.rows).toHaveLength(1);expect(result.rows[0].data.rows[0].available).toBe(false);expect(result.rows[0].data.rows[0].name).toBe("Earring");expect(result.rows[0].data.rows[0].photo).toMatchObject({url:"https://cdn.shopify.com/variant.jpg"});
 await expect(db.query("select public.manufacturing_catalog_snapshot(repeat('a',64))")).rejects.toThrow("Try again shortly");
 const grants=await db.query("select has_function_privilege('anon','public.manufacturing_catalog_snapshot(text)','execute') as anon,has_function_privilege('authenticated','public.manufacturing_catalog_snapshot(text)','execute') as employee");expect(grants.rows).toEqual([{anon:false,employee:false}]);await db.close();
});

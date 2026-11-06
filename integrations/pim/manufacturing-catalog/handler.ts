const SOURCE = "https://caikfzxvlyzmqvgpvgye.supabase.co";
const photoHosts = new Set(["cdn.shopify.com", "cdn.faire.com", "i.etsystatic.com", "square-production.s3.amazonaws.com", "items-images-production.s3.us-west-2.amazonaws.com"]);
export const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2,"0")).join("");
export async function boundedJson(response: Response, max = 4_000_000): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw Error("Missing body");
  const chunks: Uint8Array[] = []; let size=0;
  while (true) {const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>max){await reader.cancel();throw Error("Response too large");} chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function safePhotoUrl(value: unknown) {
  if(typeof value!=="string"||value.length>8192||/[\s\u0000-\u001f\u007f]/.test(value))return null;
  try{const u=new URL(value); return u.protocol==="https:"&&!u.username&&!u.password&&!u.hash&&/^https:\/\/([^/?#]+)/i.exec(value)?.[1]===u.hostname&&photoHosts.has(u.hostname)?value:null;}catch{return null;}
}
export type SourceRow = {product_id:string;variant_id:string;sku:string;name:string;available:boolean;photo:null|{kind:string;url?:string;bucket?:string;path?:string;source_id:string}};
export function createCatalogHandler({serviceKey,fetcher=fetch}:{serviceKey:string;fetcher?:typeof fetch}) {
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
 return async(request:Request)=>{
  if(request.method!=="POST")return reply(405,{error:"Use POST."});
  const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("Authorization")??"")?.[1];
  if(!token)return reply(401,{error:"Catalog access denied."});
  const headers={apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,"Content-Type":"application/json"};
  try{
   const res=await fetcher(`${SOURCE}/rest/v1/rpc/manufacturing_catalog_snapshot`,{method:"POST",headers,body:JSON.stringify({p_digest:await digest(token)}),redirect:"error",signal:AbortSignal.timeout(25000)});
   if(!res.ok){const err=await boundedJson(res,10000) as {code?:string};return reply(err.code==="42501"?401:err.code==="53300"?429:503,{error:"Catalog is unavailable. Try again shortly."});}
   const data=await boundedJson(res) as {schema_version:number;rows:SourceRow[]};
   if(data.schema_version!==1||!Array.isArray(data.rows)||data.rows.length>5000)throw Error("Invalid snapshot");
   const rows=[];
   for(let start=0;start<data.rows.length;start+=5)rows.push(...await Promise.all(data.rows.slice(start,start+5).map(async(row)=>{
    const {photo,...fields}=row;let image_url:string|null=null,image_expires_at:string|null=null;
    const image_key=photo?await digest(JSON.stringify(photo)):null;
    if(photo?.kind==="external")image_url=safePhotoUrl(photo.url);
    if(photo?.kind==="storage"){
     const path=photo.path??"";
     if(!["studio-assets","product-images"].includes(photo.bucket??"")||!path.startsWith(row.product_id+"/")||path.length>500||/[\\\u0000-\u001f\u007f]/.test(path)||path.split("/").some(p=>!p||p==="."||p===".."))throw Error("Invalid photo reference");
     const object=`${photo.bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
     const signed=await fetcher(`${SOURCE}/storage/v1/object/sign/${object}`,{method:"POST",headers,body:JSON.stringify({expiresIn:86400}),redirect:"error",signal:AbortSignal.timeout(15000)});
     if(!signed.ok)throw Error("Photo unavailable");
     const body=await boundedJson(signed,20000) as {signedURL?:string;signedUrl?:string};
     const raw=body.signedURL??body.signedUrl??"";
     const url=new URL(raw.startsWith("/object/")?"/storage/v1"+raw:raw,SOURCE);
     if(url.origin!==SOURCE||url.pathname!==`/storage/v1/object/sign/${object}`||!url.searchParams.has("token"))throw Error("Invalid signed URL");
     image_url=url.href;image_expires_at=new Date(Date.now()+86400000).toISOString();
    }
    return {...fields,image_url,image_key,image_expires_at};
   })));
   return reply(200,{...data,rows});
  }catch{return reply(503,{error:"Catalog could not be read. The saved Manufacturing catalog remains available."});}
 };
}

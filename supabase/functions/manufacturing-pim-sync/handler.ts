import { boundedJson, digest } from "../../../integrations/pim/manufacturing-catalog/handler.ts";
const FEED="https://caikfzxvlyzmqvgpvgye.supabase.co/functions/v1/manufacturing-catalog";
export function createPimSyncHandler({url,serviceKey,fetcher=fetch}:{url:string;serviceKey:string;fetcher?:typeof fetch}){
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
 const rpc=async(name:string,args:unknown)=>{
  const r=await fetcher(`${url}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,"Content-Type":"application/json"},body:JSON.stringify(args),redirect:"error",signal:AbortSignal.timeout(25000)});
  const data=await boundedJson(r);if(!r.ok)throw Object.assign(Error("Sync unavailable"),{code:(data as {code?:string}).code});return data;
 };
 return async(request:Request)=>{
  if(request.method!=="POST")return reply(405,{error:"Use POST."});
  const token=request.headers.get("x-sync-key")??"";if(!/^[a-f0-9]{64}$/.test(token))return reply(401,{error:"Sync access denied."});
  let lease:string|undefined;
  try{
   const claim=await rpc("pim_sync_begin",{p_digest:await digest(token)}) as {lease:string;source_token:string}|null;
   if(!claim)return reply(200,{status:"busy_or_paused"});lease=claim.lease;
   const response=await fetcher(FEED,{method:"POST",headers:{Authorization:`Bearer ${claim.source_token}`,"Content-Type":"application/json"},body:"{}",redirect:"error",signal:AbortSignal.timeout(90000)});
   if(!response.ok)throw Error("Source unavailable");
   const snapshot=await boundedJson(response);
   const result=await rpc("pim_sync_finish",{p_lease:lease,p_snapshot:snapshot});
   return reply(200,result);
  }catch(e){
   if(lease)try{await rpc("pim_sync_fail",{p_lease:lease});}catch{/* Lease expiry permits a later retry; no credentials or provider body are logged. */}
   return reply((e as {code?:string}).code==="42501"?401:503,{error:"Product refresh could not finish. Saved products are unchanged; automatic refresh will retry."});
  }
 };
}

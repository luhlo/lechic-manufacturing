"use client";
import {useEffect,useRef,useState} from "react";
import {message,type Api} from "@/lib/manufacturing/api";
import {DesignSheet} from "./design-sheet";
export interface CatalogStatus {
 enabled:boolean;last_sync:string|null;last_attempt:string|null;syncing:boolean;requested?:boolean;
 last_error:string|null;result:{added:number;updated:number;unchanged:number;total:number}|null;
}
export function DesignCatalog({api,refresh}:{api:Api;refresh:()=>Promise<void>}){
 const [status,setStatus]=useState<CatalogStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const refreshRef=useRef(refresh);
 useEffect(()=>{refreshRef.current=refresh;},[refresh]);
 const lastSync=useRef<string|null>(null),mounted=useRef(false),pendingSince=useRef(0);
 useEffect(()=>{
  mounted.current=true;let reading=false;
  const check=async()=>{
   if(reading||!navigator.onLine)return;reading=true;
   try{
    const next=await api.rpc<CatalogStatus>("pim_catalog");if(!mounted.current)return;
    setStatus(next);setError("");
    if(next.last_sync&&(lastSync.current||pendingSince.current)&&next.last_sync!==lastSync.current)await refreshRef.current();
    const changed=next.last_sync!==lastSync.current;lastSync.current=next.last_sync;
    if(pendingSince.current&&(changed||next.last_error||Date.now()-pendingSince.current>120000)){pendingSince.current=0;setBusy(false);}
   }catch(e){if(mounted.current)setError(message(e));}finally{reading=false;}
  };
  void check();const interval=window.setInterval(()=>void check(),5000);
  window.addEventListener("online",check);window.addEventListener("focus",check);
  return()=>{mounted.current=false;clearInterval(interval);window.removeEventListener("online",check);window.removeEventListener("focus",check);};
 },[api]);
 async function run(){
  setBusy(true);setError("");pendingSince.current=Date.now();
  try{const next=await api.rpc<CatalogStatus>("pim_catalog",{p_action:"refresh"});if(mounted.current){setStatus(next);if(!next.requested&&!next.syncing){await refreshRef.current();setBusy(false);pendingSince.current=0;}}}
  catch(e){if(mounted.current){setError(message(e));setBusy(false);pendingSince.current=0;}}
 }
 if(status&&!status.enabled)return <><p className="notice">020 SKU database is not connected yet.</p><DesignSheet api={api} refresh={refresh}/></>;
 return <section className="settings-card design-sheet" aria-label="Product source">
  <h2>020 SKU database {status?.enabled ? "· Connected" : ""}</h2>
  <p className="muted">Earring products refresh automatically every 5 minutes. Update names, SKUs and photos in the SKU database. Previously saved products remain available offline.</p>
  <div className="actions"><a className="button secondary" href="https://le-chic-pim.lechic-miami.workers.dev/" target="_blank" rel="noreferrer">Open SKU database</a>
   <button className="button primary" disabled={busy||!status?.enabled||(typeof navigator!=="undefined"&&!navigator.onLine)} onClick={()=>void run()}>{busy||status?.syncing?"Refreshing products…":"Refresh products"}</button></div>
  <p className="muted tiny" role="status">{status?.last_sync?`Last refresh: ${new Date(status.last_sync).toLocaleString()}. ${status.result?.total??0} linked variants. ${status.result?.added??0} added, ${status.result?.updated??0} updated.`:"Waiting for the first product refresh."}</p>
  {(error||status?.last_error)&&<p className="notice error" role="alert">{error||status?.last_error}</p>}
 </section>;
}

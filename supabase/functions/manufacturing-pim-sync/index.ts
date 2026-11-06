import {createPimSyncHandler} from "./handler.ts";
Deno.serve(createPimSyncHandler({url:Deno.env.get("SUPABASE_URL")!,serviceKey:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}));

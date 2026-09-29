import { createDesignSyncHandler } from "./handler.ts";
Deno.serve(createDesignSyncHandler({
  url: Deno.env.get("SUPABASE_URL")!,
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
}));

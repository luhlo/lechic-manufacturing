import { createCatalogHandler } from "./handler.ts";
Deno.serve(createCatalogHandler({serviceKey:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}));

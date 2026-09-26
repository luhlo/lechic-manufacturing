import { createLoginHandler } from "./handler.ts";
const env = Deno.env;
Deno.serve(
  createLoginHandler({
    url: env.get("SUPABASE_URL")!,
    serviceKey: env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    anonKey: env.get("SUPABASE_ANON_KEY")!,
  }),
);

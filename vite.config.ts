import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { deploymentBase } from "./build/base-path.mjs";
import { publicConfiguration } from "./build/public-env";

export default defineConfig(({ command, mode }) => {
  const config = publicConfiguration(
    loadEnv(mode, process.cwd(), "NEXT_PUBLIC_"),
    command === "build",
  );
  return {
    base: deploymentBase(process.env.BASE_PATH ?? "/"),
    plugins: [react()],
    resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
    // Only these two public values enter the bundle; never expose process.env.
    envPrefix: [],
    define: {
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(config.url),
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(config.key),
    },
    build: { outDir: "dist", emptyOutDir: true },
    server: { host: "127.0.0.1", port: 5173 },
    preview: { host: "127.0.0.1", port: 5174 },
  };
});

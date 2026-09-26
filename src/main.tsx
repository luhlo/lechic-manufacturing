import { createRoot } from "react-dom/client";
import { ManufacturingApp } from "@/components/manufacturing/app";
import "@/app/globals.css";

createRoot(document.getElementById("root")!).render(
  <ManufacturingApp
    url={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}
    publishableKey={process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""}
  />,
);

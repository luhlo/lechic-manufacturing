"use client";
import { useState } from "react";

export function DesignImage({ url, name, large = false }: { url?: string | null; name: string; large?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = url?.trim();
  // Blank or unavailable images occupy no space; the design remains usable.
  if (!src || !src.startsWith("https://") || failed === src) return null;
  return <img className={`design-image${large ? " design-image-large" : ""}`}
    src={src} alt={name} loading="lazy" decoding="async" referrerPolicy="no-referrer"
    onError={() => setFailed(src)} />;
}

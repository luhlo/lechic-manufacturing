const projectUrl = "https://bbbgrxvidrlmrrezfmil.supabase.co";

export function publicConfiguration(
  env: Record<string, string | undefined>,
  required = true,
) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!required && !url && !key) return { url, key };
  if (!url || !key)
    throw Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY before building.");
  if (url.replace(/\/$/, "") !== projectUrl)
    throw Error("Deployment must use the existing Le Chic Manufacturing Supabase project (bbbgrxvidrlmrrezfmil).");
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && !key.includes("REPLACE");
  if (!publicKey && key.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
      publicKey = payload.role === "anon" && payload.ref === "bbbgrxvidrlmrrezfmil";
    } catch { /* Invalid JWTs are rejected without logging their contents. */ }
  }
  if (!publicKey)
    throw Error("Use a Supabase publishable key or this project's legacy anon key. Secret and service-role keys are forbidden.");
  return { url: projectUrl, key };
}

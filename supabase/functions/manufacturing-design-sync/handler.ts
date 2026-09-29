type Config = { url: string; serviceKey: string; fetcher?: typeof fetch };
export function createDesignSyncHandler(config: Config) {
  const fetcher = config.fetcher ?? fetch;
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  return async (request: Request) => {
    if (request.method !== "POST") return reply(405, { error: "Use POST." });
    try {
      // Bound the stream too; Content-Length alone is not trustworthy.
      const reader = request.body?.getReader();
      if (!reader) return reply(400, { error: "Missing request body." });
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) { await reader.cancel(); return reply(413, { error: "Sheet exceeds the 2 MB sync limit." }); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token))
        return reply(401, { error: "The sheet connection is unavailable. Generate a new setup script in Designs." });
      if (typeof body.spreadsheet_id !== "string" || !Array.isArray(body.rows) || body.rows.length > 5000)
        return reply(400, { error: "Send a spreadsheet ID and at most 5,000 design rows." });
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.token))))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      const response = await fetcher(`${config.url}/rest/v1/rpc/import_sheet_designs`, {
        method: "POST", signal: AbortSignal.timeout(25000),
        headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_digest: digest, p_spreadsheet_id: body.spreadsheet_id, p_rows: body.rows }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "42501") return reply(401, { error: "The sheet connection is unavailable. Generate a new setup script in Designs." });
        if (result.code === "22023") return reply(400, { error: result.message });
        return reply(503, { error: "Sync could not finish. Existing designs are unchanged; try again shortly." });
      }
      return reply(200, result);
    } catch (e) {
      return e instanceof SyntaxError ? reply(400, { error: "Invalid JSON." }) :
        reply(503, { error: "Sync could not finish. Try again shortly." });
    }
  };
}

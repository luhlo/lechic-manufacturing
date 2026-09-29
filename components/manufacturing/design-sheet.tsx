"use client";
import { useEffect, useState } from "react";
import { message, type Api } from "@/lib/manufacturing/api";
import { parseSheetLink, sheetScript, type SheetConnection } from "@/lib/manufacturing/sheet-sync";

export function DesignSheet({ api, refresh }: { api: Api; refresh: () => Promise<void> }) {
  const [connection, setConnection] = useState<SheetConnection | null>(null);
  const [link, setLink] = useState("");
  const [script, setScript] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    api.rpc<SheetConnection | null>("design_sheet").then((c) => {
      if (current) setConnection(c);
    }).catch((e) => { if (current) setError(message(e)); });
    return () => { current = false; };
  }, [api]);
  async function run(action: "connect" | "status" | "disconnect") {
    setBusy(true); setError("");
    try {
      const args = action === "connect" ? parseSheetLink(link) : {};
      const c = await api.rpc<SheetConnection | null>("design_sheet", { p: { action, ...args } });
      if (action === "connect" && c?.token) {
        setScript(sheetScript(c, `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manufacturing-design-sync`));
      } else if (action === "disconnect") setScript("");
      // The connection secret lives only in this mounted setup form.
      setConnection(c ? { ...c, token: undefined } : null);
      if (action === "status") await refresh();
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <details className="settings-card design-sheet">
    <summary>Google Sheet {connection?.enabled ? "· Connected" : "· Set up"}</summary>
    <p className="muted">Keep your sheet private. Use Name, SKU, and optional Image URL columns. A blank image link shows no image.</p>
    {connection?.enabled && <>
      <a href={`https://docs.google.com/spreadsheets/d/${connection.spreadsheet_id}/edit#gid=${connection.sheet_id}`} target="_blank" rel="noreferrer">Open connected sheet</a>
      <p role="status">{connection.last_sync ? `Last sync: ${new Date(connection.last_sync).toLocaleString()}. ${connection.result?.added ?? 0} added, ${connection.result?.updated ?? 0} updated, ${connection.result?.unchanged ?? 0} unchanged. ${connection.result?.skipped ?? 0} waiting for Name or SKU.` : "Waiting for the first sync. Finish setup in Google to begin."}</p>
      <div className="actions"><button className="button secondary" disabled={busy} onClick={() => void run("status")}>Check sync status</button><button className="button secondary" disabled={busy} onClick={() => void run("disconnect")}>Disconnect sheet</button></div>
    </>}
    <form onSubmit={(e) => { e.preventDefault(); void run("connect"); }}>
      <label className="field">Google Sheet link<input type="url" required value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
      <button className="button secondary" disabled={busy}>{busy ? "Working…" : connection?.enabled ? "Replace connection & generate script" : "Generate setup script"}</button>
      {connection?.enabled && <p className="muted tiny">Replacing the connection stops the previous script until you install the new one. Existing designs stay in the app.</p>}
    </form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {script && <>
      <ol><li>Open the Google Sheet, then Extensions → Apps Script. For an Excel file, first use File → Save as Google Sheets.</li><li>Paste this script into a new script file and save it. Keep this script private.</li><li>Select <strong>installLeChicSync</strong>, click Run, and authorize it with Google.</li></ol>
      <p className="muted">It syncs about every 5 minutes. To sync immediately, run syncLeChicDesigns in Apps Script. Existing designs match by SKU; removing a sheet row never deletes a design or work history.</p>
      <button className="button secondary" onClick={() => void navigator.clipboard.writeText(script).catch(() => setError("Select and copy the script below."))}>Copy setup script</button>
      <label className="field">Private setup script<textarea readOnly rows={10} value={script} spellCheck={false} /></label>
    </>}
  </details>;
}

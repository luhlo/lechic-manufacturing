export interface SheetConnection {
  enabled: boolean;
  spreadsheet_id: string;
  sheet_id: string;
  last_sync: string | null;
  result: { added: number; updated: number; unchanged: number; skipped: number } | null;
  token?: string;
}
export function parseSheetLink(link: string) {
  const url = new URL(link);
  const id = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)\/?.*$/)?.[1];
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !id)
    throw Error("Paste a Google Sheets link.");
  const sheetId = new URLSearchParams(url.hash.slice(1)).get("gid") ?? url.searchParams.get("gid") ?? "";
  if (sheetId && !/^\d+$/.test(sheetId)) throw Error("This sheet tab link is invalid.");
  return { spreadsheet_id: id, sheet_id: sheetId };
}
export function sheetScript(connection: SheetConnection, endpoint: string) {
  return `/** @OnlyCurrentDoc */
// Only Name, SKU and optional Image URL from this tab go to Le Chic Manufacturing.
const LE_CHIC = ${JSON.stringify({ endpoint, spreadsheetId: connection.spreadsheet_id, sheetId: connection.sheet_id, token: connection.token ?? "PASTE_SETUP_TOKEN_HERE" }, null, 2)};

function syncLeChicDesigns() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (book.getId() !== LE_CHIC.spreadsheetId) throw new Error('This script belongs to a different spreadsheet.');
  const sheet = LE_CHIC.sheetId ? book.getSheets().find(s => String(s.getSheetId()) === LE_CHIC.sheetId) : book.getSheets()[0];
  if (!sheet) throw new Error('The connected tab no longer exists. Reconnect it from Designs.');
  if (sheet.getLastRow() > 5001) throw new Error('Keep the design tab to 5,000 rows or fewer.');
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.shift().map(h => h.trim().toLowerCase().replace(/\\s+/g, ' '));
  const name = headers.indexOf('name'), sku = headers.indexOf('sku'), image = headers.indexOf('image url');
  if (name < 0 || sku < 0) throw new Error('Row 1 must include Name and SKU. Image URL is optional.');
  if (headers.filter(h => h === 'name').length !== 1 || headers.filter(h => h === 'sku').length !== 1 || headers.filter(h => h === 'image url').length > 1) throw new Error('Use each column heading only once.');
  const rows = values.map((r, i) => ({ name: r[name].trim(), sku: r[sku].trim(), row: i + 2, ...(image >= 0 ? { image_url: r[image].trim() } : {}) }))
    .filter(r => r.name || r.sku || r.image_url);
  const response = UrlFetchApp.fetch(LE_CHIC.endpoint, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ token: LE_CHIC.token, spreadsheet_id: book.getId(), rows }) });
  const result = JSON.parse(response.getContentText());
  if (response.getResponseCode() !== 200) throw new Error(result.error || 'Design sync failed.');
  console.log('Design sync: ' + result.added + ' added, ' + result.updated + ' updated, ' + result.unchanged + ' unchanged, ' + result.skipped + ' waiting for Name or SKU.');
  return result;
}

function installLeChicSync() {
  syncLeChicDesigns();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncLeChicDesigns').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncLeChicDesigns').timeBased().everyMinutes(5).create();
}
`;
}

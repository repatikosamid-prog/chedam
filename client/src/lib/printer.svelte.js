// This device's receipt printer (P1 step 5, FR-1.11/3.13). The hub prints: the till asks it to print a
// sale, a till report or open the drawer for a no-sale. Without the hub or a printer the browser's own
// print is the fallback.
import { api, isHubDown } from "./api.js";

export const pr = $state({ mine: null, options: { auto_print: true, full_receipt_cents: 15000 }, loaded: false });

export async function loadPrinter() {
  if (isHubDown()) return pr;
  const r = await api("GET", "/api/chedam/printers");
  if (r.ok) { pr.mine = r.json.mine; pr.options = r.json.options; pr.loaded = true; }
  return pr;
}

const down = { printed: false, error: "The hub is not answering, so the receipt printer cannot be reached. Print on this device instead." };

// body: {reprint, buyer, kick}. Returns {printed, error, printer, copy, drawer, no_printer}
export async function printSale(id, body) {
  if (isHubDown()) return down;
  const r = await api("POST", `/api/chedam/sales/${id}/print`, body, { timeout: 15000 });
  if (r.status === 0) return down;
  return r.ok ? r.json : { printed: false, error: r.message };
}

export async function printTill(id) {
  if (isHubDown()) return down;
  const r = await api("POST", `/api/chedam/tills/${id}/print`, {}, { timeout: 15000 });
  return r.ok ? r.json : { printed: false, error: r.status === 0 ? down.error : r.message };
}

export async function openDrawerNoSale(movement) {
  const r = await api("POST", "/api/chedam/drawer/no-sale", { movement }, { timeout: 15000 });
  return r.ok ? r.json : { opened: false, error: r.message };
}

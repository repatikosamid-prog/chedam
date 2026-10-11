// Card refunds through the linked processor (P5 step 3, DL-221..223). The hub sends the refund to the processor
// (Interac: on the terminal, the customer taps the card); this waits until each refund is accepted, then the
// return or void names them. Refunds already made for the same return or void are given back by the hub.
import { api } from "./api.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// {sale, ref, purpose: "return"|"void", amount_cents}; onStatus(text) while waiting. Returns {ok, items, message}.
export async function refundLinked(body, onStatus = () => {}) {
  const r = await api("POST", "/api/chedam/terminal/refunds", body, { quiet: true, timeout: 20000 });
  if (!r.ok) return { ok: false, message: r.status === 0 ? "The hub did not answer." : r.message, refusal: r };
  let items = r.json.items;
  for (let i = 0; i < 150 && items.some((x) => !x.accepted); i++) {
    const w = items.find((x) => !x.accepted);
    if (["rejected", "failed", "cancelled"].includes(w.status)) return { ok: false, message: "The processor did not take the refund (" + w.status + ").", items };
    onStatus(w.on_terminal ? `Customer: tap or insert the card on ${w.terminal} to get ${(w.amount_cents / 100).toFixed(2)} back.` : "Sending the refund…");
    await sleep(2000);
    const p = await api("GET", `/api/chedam/terminal/refunds/${w.id}`, null, { quiet: true, timeout: 15000 });
    if (p.ok) items = items.map((x) => (x.id === p.json.id ? p.json : x));
  }
  if (items.some((x) => !x.accepted)) return { ok: false, message: "The refund did not go through in time. Try again (nothing is refunded twice).", items };
  onStatus("");
  return { ok: true, items };
}

// Refunds already accepted for this return or void (the till lost them: a reload, a refused return)
export async function acceptedFor(ref) {
  const r = await api("GET", `/api/chedam/terminal/refunds?ref=${encodeURIComponent(ref)}`, null, { quiet: true });
  return r.ok ? r.json.items : [];
}

// Before voiding a sale paid on the linked terminal: its card payments go back first. Returns the refund ids
// for the void, [] when there is nothing linked, or null when it did not work (onError(message)).
export async function voidRefunds(sale, onStatus, onError) {
  const linked = (sale.payments || []).filter((p) => p.method === "card" && p.status === "approved" && p.linked);
  if (!linked.length) return [];
  const amount = linked.reduce((a, p) => a + p.amount_cents, 0);
  if (!confirm(`${(amount / 100).toFixed(2)} goes back to the card through the processor before the void. Go ahead?`)) return null;
  const res = await refundLinked({ sale: sale.id, ref: sale.id, purpose: "void", amount_cents: amount }, onStatus);
  if (!res.ok) { onError(res.message); return null; }
  return res.items.map((x) => x.id);
}

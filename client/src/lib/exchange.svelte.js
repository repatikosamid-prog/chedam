// An exchange in progress (FR-4.13): the Returns screen chooses what comes back, then Sell rings up the
// new items. The hub records both together (POST /api/chedam/returns with `exchange`). Kept on this
// device so a reload does not lose it.
const KEY = "chedam.exchange";

function read() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }

// draft: {id, body: {sale, lines, reason, restocking_fee, approval}, credit_cents, receipt, card_max_cents, label}
export const ex = $state({ draft: read() });

export function startExchange(draft) {
  ex.draft = draft;
  try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch { /* private mode */ }
}

export function endExchange() {
  ex.draft = null;
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

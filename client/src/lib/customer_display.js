// Customer-facing display (P2 step 5, FR-3.14): the till's side. Sell builds what its customer should see
// (items, savings, total, the member's points, "thank you") and publish() sends it:
//   - to a display window on this same device (a second monitor), through a BroadcastChannel: works offline;
//   - to the hub, for a display device linked to this till (only when the device manager says one is),
//     a moment after the last change, without the "Saved" pop-up.
import { api, isHubDown } from "./api.js";

const CHANNEL = "chedam-display";
let bc = null;
try { bc = new BroadcastChannel(CHANNEL); } catch { bc = null; }
let last = "", timer = null, toHub = false;

// A display window that just opened asks for what is on now.
if (bc) bc.onmessage = (e) => { if (e.data && e.data.ask && last) bc.postMessage(JSON.parse(last)); };

export function useHub(on) { toHub = !!on; }

export function publish(state) {
  const text = JSON.stringify(state);
  if (text === last) return;
  last = text;
  try { if (bc) bc.postMessage(state); } catch { /* closed */ }
  clearTimeout(timer);
  if (toHub) timer = setTimeout(() => { if (!isHubDown()) api("POST", "/api/chedam/display", { state }, { quiet: true }); }, 200);
}

// Opens the display in its own window, to drag onto the monitor facing the customer.
export function openWindow() {
  window.open("./#customer-display", "chedam-customer-display", "popup,width=1024,height=768");
}

export { CHANNEL };

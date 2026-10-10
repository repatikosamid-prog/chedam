// P2 step 5: customer-facing display (FR-3.14). A device paired as a customer display, linked to one till
// by a manager, shows what that till sends (no sign-in); only a till's signed-in seller can send; nothing is
// written to the database; a silent display gets {same: true}; another till's sale never shows.
// Usage: PB_BIN='C:\Tools\pocketbase.exe' node hub/tests/step25-customer-display.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub, HUB } from "./lib/hub.mjs";

const t = new TestHub({ port: 8118 });
const check = t.check.bind(t);
const seed = readFileSync(join(HUB, "pb_migrations_dev", "1791200101_dev_sample_pins.js"), "utf8");
const PIN = Object.fromEntries([...seed.matchAll(/"([^"]+)":\s*"(\d+)"/g)].map((m) => [m[1], m[2]]));

let err = null;
try {
  await t.start();
  const people = Object.fromEntries((await t.list("users")).items.map((u) => [u.name, u.id]));
  const tillA = await t.pair("Till A"), tillB = await t.pair("Till B");
  const signIn = async (n, dev) => (await t.api("POST", "/api/chedam/auth/pin", { user: people[n], pin: PIN[n] }, { device: dev })).json.token;
  const cashier = await signIn("Cal Cashier", tillA), manager = await signIn("Mira Manager", tillB);
  const screen = await t.pair("Counter screen", "customer_display");
  const D = (v = 0) => t.api("GET", "/api/chedam/display" + (v ? "?v=" + v : ""), null, { device: screen });
  const send = (tok, state) => t.api("POST", "/api/chedam/display", { state }, { token: tok });
  const sale = { kind: "sale", lines: [{ name: "Chips", qty: 2, price_cents: 199, total_cents: 398, promo_label: "Snack week 10% off" }], total_cents: 425, savings_cents: 40, customer: { first_name: "Ana", points: 120 } };

  console.log("Linking (device manager)");
  check("a display that is not linked shows the logo", (await D()).json.linked === false && (await D()).json.state.kind === "idle");
  check("only a customer display can be linked", (await t.api("POST", `/api/chedam/devices/${tillB.id}/display`, { till: tillA.id }, { token: manager })).status === 400);
  check("a display cannot show another display", (await t.api("POST", `/api/chedam/devices/${screen.id}/display`, { till: screen.id }, { token: manager })).status === 400);
  check("a cashier cannot link it", (await t.api("POST", `/api/chedam/devices/${screen.id}/display`, { till: tillA.id }, { token: cashier })).status === 403);
  const ln = await t.api("POST", `/api/chedam/devices/${screen.id}/display`, { till: tillA.id }, { token: manager });
  check("a manager links it to Till A", ln.status === 200 && ln.json.display_for === tillA.id, JSON.stringify(ln.json));
  const me = (await t.api("GET", "/api/chedam/devices/me", null, { device: tillA })).json;
  check("Till A knows a display shows its sales", Array.isArray(me.displays) && me.displays.includes("Counter screen"), JSON.stringify(me.displays));

  console.log("Showing the sale");
  const d0 = (await D()).json;
  check("linked, nothing sent yet: the logo (idle), with the store name", d0.linked === true && d0.till === "Till A" && d0.state.kind === "idle" && typeof d0.brand.name === "string", JSON.stringify(d0));
  const events0 = (await t.list("events", "table_name != 'devices'")).totalItems;
  const p1 = await send(cashier, sale);
  check("the till sends its sale", p1.status === 200 && p1.json.v >= 1);
  const d1 = (await D()).json;
  check("the display shows it", d1.state.kind === "sale" && d1.state.lines[0].name === "Chips" && d1.state.total_cents === 425 && d1.state.customer.first_name === "Ana", JSON.stringify(d1));
  check("asked again with the same version: nothing new", (await D(d1.v)).json.same === true);
  await send(manager, { kind: "sale", lines: [{ name: "Secret", qty: 1, total_cents: 1 }], total_cents: 1 });
  check("Till B's sale never shows on Till A's display", (await D()).json.state.lines[0].name === "Chips");
  await send(cashier, { kind: "done", total_cents: 425, paid_cents: 500, change_cents: 75 });
  const d2 = (await D(d1.v)).json;
  check("after payment: thank you and the change", d2.state.kind === "done" && d2.state.change_cents === 75 && d2.v > d1.v);
  check("nothing written to the database (no event log rows)", (await t.list("events", "table_name != 'devices'")).totalItems === events0, String((await t.list("events", "table_name != 'devices'")).totalItems - events0));

  console.log("Refused");
  check("an unknown kind is refused", (await send(cashier, { kind: "ads" })).status === 400);
  check("too much is refused", (await send(cashier, { kind: "sale", lines: Array.from({ length: 2000 }, (_, i) => ({ name: "Item " + i + " with a long name for testing" })) })).status === 400);
  check("without a sign-in nothing can be sent", (await t.api("POST", "/api/chedam/display", { state: sale }, { device: tillA })).status === 401);
  check("a till cannot read a display's screen", (await t.api("GET", "/api/chedam/display", null, { token: cashier })).status === 403);
  check("an unpaired browser cannot read it", (await t.api("GET", "/api/chedam/display")).status === 400);
  const un = await t.api("POST", `/api/chedam/devices/${screen.id}/display`, { till: "" }, { token: manager });
  check("unlinking: back to the logo", un.status === 200 && (await D()).json.linked === false);
} catch (e) { err = e; }
await t.finish(err);

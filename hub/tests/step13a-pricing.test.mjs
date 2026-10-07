// P1 step 3: sale arithmetic (lib/pricing_core.js), worked by hand. BR-16 cash rounding, BR-21 cart
// discount spread before tax, BR-22 tax per type per receipt rounded once, FR-4.04 tax-included prices.
// No hub needed. Usage: node hub/tests/step13a-pricing.test.mjs
import { createRequire } from "node:module";
import { join } from "node:path";
import { HUB } from "./lib/hub.mjs";

const core = createRequire(import.meta.url)(join(HUB, "pb_hooks", "lib", "pricing_core.js"));
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) { passed++; console.log("  ok   " + name); } else { failed++; console.log("  FAIL " + name + " " + detail); } };

const GST = { code: "GST", label: "GST", rate: 5 }, PST = { code: "PST", label: "PST", rate: 7 };
const cart = () => [
  { key: "cola", gross_cents: 298, rates: [GST, PST], deposit_cents: 20, deposit_rates: [] },   // 2 x $1.49, 2 x 10 c deposit
  { key: "chips", gross_cents: 399, rates: [GST] },                                            // GST only
  { key: "bananas", gross_cents: 215, rates: [] },                                             // 1.235 kg x $1.74 = 214.89 -> 215, zero-rated
];
const tax = (r, code) => (r.taxes.find((t) => t.code === code) || {}).tax_cents;

console.log("Tax added, one rounding per type (BR-22)");
let r = core.compute(cart(), { mode: "tax_added" });
check("GST on 6.97 = 0.3485 -> 35 c", tax(r, "GST") === 35, JSON.stringify(r.taxes));
check("PST on 2.98 = 0.2086 -> 21 c", tax(r, "PST") === 21);
check("total 9.12 + 0.56 tax + 0.20 deposits = 9.88", r.total_cents === 988 && r.deposit_cents === 20, JSON.stringify(r));
check("line tax shares add up to the receipt tax", ["GST", "PST"].every((c) => r.lines.reduce((a, l) => a + l.taxes.filter((t) => t.code === c).reduce((b, t) => b + t.tax_cents, 0), 0) === tax(r, c)));
check("cash: 9.88 -> 9.90 (BR-16)", core.cashRound(988) === 990);

console.log("Cart discount spread before tax (BR-21)");
r = core.compute(cart(), { mode: "tax_added", cart_discount_cents: 100 });
const share = Object.fromEntries(r.lines.map((l) => [l.key, l.cart_discount_cents]));
check("$1.00 spread by amount: cola 33, chips 44, bananas 23 (largest remainder)", share.cola === 33 && share.chips === 44 && share.bananas === 23, JSON.stringify(share));
check("GST on 6.20 = 31 c; PST on 2.65 = 0.1855 -> 19 c", tax(r, "GST") === 31 && tax(r, "PST") === 19, JSON.stringify(r.taxes));
check("total 8.12 + 0.50 + 0.20 = 8.82; discount 1.00", r.total_cents === 882 && r.discount_cents === 100);
check("deposit is never discounted", r.deposit_cents === 20);
r = core.compute([{ key: "a", gross_cents: 500, line_discount_cents: 50, rates: [GST] }], { mode: "tax_added", cart_discount_cents: 999 });
check("line discount first; cart discount capped at what is left", r.discount_cents === 500 && r.total_cents === 0, JSON.stringify(r));

console.log("Tax included (FR-4.04)");
r = core.compute([{ key: "x", gross_cents: 112, rates: [GST, PST] }], { mode: "tax_included" });
check("$1.12 including 12%: GST 5 c + PST 7 c, total stays 1.12", tax(r, "GST") === 5 && tax(r, "PST") === 7 && r.total_cents === 112, JSON.stringify(r));
r = core.compute([{ key: "x", gross_cents: 149, rates: [GST, PST] }, { key: "y", gross_cents: 149, rates: [GST, PST] }], { mode: "tax_included" });
check("2 x $1.49 incl.: GST 13.30 -> 13 c, PST 18.63 -> 19 c, total 2.98", tax(r, "GST") === 13 && tax(r, "PST") === 19 && r.total_cents === 298, JSON.stringify(r.taxes));

console.log("Rounding helpers");
check("cash rounding: 1,2 down; 3,4 up; 5 stays", [1, 2, 3, 4, 5, 6, 7, 8, 9].map(core.cashRound).join() === "0,0,5,5,5,5,5,10,10");
check("spread: 10 over 1:1:1 = 4,3,3", core.spread(10, [1, 1, 1]).join() === "4,3,3");
check("spread: nothing over zero weights", core.spread(10, [0, 0]).join() === "0,0");
check("half up: 0.5 -> 1, 34.85 -> 35, 18.49 -> 18", core.roundHalfUp(0.5) === 1 && core.roundHalfUp(34.85) === 35 && core.roundHalfUp(18.49) === 18);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

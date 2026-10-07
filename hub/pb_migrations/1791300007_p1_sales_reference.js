/// <reference path="../../pb_data/types.d.ts" />
// P1 step 3 reference data: selling permissions (given to the role templates) and till/payment settings
// (FR-1.12). Limits marked * in Section 9 are owner-editable here. Tax exemption reasons stay pending
// the accountant (Q1). Down removes exactly these rows.

// [code, area, label, owner_only, sensitive]
const PERMISSIONS = [
  ["sales.sell", "sell", "Sell at the till; open and close their own till", false, false],
  ["sales.discount", "sell", "Give discounts within the store's limit", false, false],
  ["sales.tax_exempt", "sell", "Make a tax-exempt sale (with reason and reference)", false, false],
  ["sales.approve", "sell", "Approve with PIN: overrides, discounts above the limit, voids, expired stock", false, true],
  ["sales.void", "sell", "Void a completed sale", false, true],
  ["sales.view", "sell", "See sales and till reports", false, false],
  ["till.manage", "sell", "Manage every till: close, cash drops, pay-outs, Z reports", false, true],
];

const GRANTS = {
  manager: ["sales.sell", "sales.discount", "sales.tax_exempt", "sales.approve", "sales.void", "sales.view", "till.manage"],
  cashier: ["sales.sell", "sales.discount", "sales.tax_exempt"],
  accountant: ["sales.view"],
};

const CAD = [10000, 5000, 2000, 1000, 500, 200, 100, 25, 10, 5];

const SETTINGS = [
  ["sales.payment_methods", ["cash", "card", "usd_cash"], "Payment methods offered at the till (FR-1.12, FR-3.08)"],
  ["sales.cash_rounding", true, "Round cash totals to the nearest 5 cents (BR-16)"],
  ["sales.usd_rate", 1.35, "Canadian dollars given for 1 US dollar in cash; change is in CAD"],
  ["sales.discount_limit_pct", 10, "Largest discount a cashier gives without a manager PIN (%)"],
  ["sales.override_limit_pct", 10, "Price lowered by more than this needs a manager PIN (%, BR-18)"],
  ["sales.soft_hold", { units: 3, minutes: 5 }, "Hold low-stock items in open carts (BR-13)"],
  ["sales.exempt_reasons", {
    first_nations: { label: "First Nations status card", types: ["GST", "PST"] },
    pst_resale: { label: "PST exemption: resale or wholesale", types: ["PST"] },
    other: { label: "Other exemption", types: ["GST", "PST"] },
  }, "Tax-exempt sale reasons and the taxes each removes (FR-4.05; pending accountant review, Q1)"],
  ["sales.next_number", { sale: 1, training: 1, till: 1 }, "Next receipt and till numbers"],
  ["till.float_default_cents", 20000, "Default opening float (FR-1.12)"],
  ["till.denominations", CAD, "Coins and notes counted at open and close (cents)"],
  ["till.variance_task_cents", 500, "A till closed this far over or short raises a task"],
];

migrate((app) => {
  const ids = {};
  PERMISSIONS.forEach(([code, area, label, ownerOnly, sensitive]) => {
    const p = new Record(app.findCollectionByNameOrId("permissions"));
    p.load({ code: code, area: area, label: label, owner_only: ownerOnly, sensitive: sensitive });
    p.set("created_by", "system"); p.set("updated_by", "system");
    app.save(p);
    ids[code] = p.id;
  });
  Object.keys(GRANTS).forEach((roleCode) => {
    const role = app.findFirstRecordByData("roles", "code", roleCode);
    role.set("permissions", role.get("permissions").concat(GRANTS[roleCode].map((c) => ids[c])));
    role.set("updated_by", "system");
    app.save(role);
  });
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => {
    try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* already gone */ }
  });
  const ids = PERMISSIONS.map(([code]) => {
    try { return app.findFirstRecordByData("permissions", "code", code).id; } catch (_) { return ""; }
  });
  Object.keys(GRANTS).forEach((roleCode) => {
    const role = app.findFirstRecordByData("roles", "code", roleCode);
    role.set("permissions", role.get("permissions").filter((id) => ids.indexOf(id) < 0));
    role.set("updated_by", "system");
    app.save(role);
  });
  ids.forEach((id) => { if (id) app.delete(app.findRecordById("permissions", id)); });
});

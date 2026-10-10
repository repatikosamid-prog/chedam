/// <reference path="../../pb_data/types.d.ts" />
// P4 step 7: card fees, platform payouts, vendor statements (FR-10.05, 8.10, 10.04). The card type on card
// payments (chosen at the till, optional) and the processor's rates per type (setting cards.fees) for the
// estimated fee; delivery-platform payout statements checked against the orders Chedam recorded; vendor
// statements checked against the bills. Down drops exactly what up adds.

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];
function base(app, name, fields, indexes) {
  const c = new Collection({ type: "base", name: name, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: fields.concat(COMMON()), indexes: indexes || [] });
  app.save(c);
  return c;
}
const SETTINGS = [
  ["cards.fees", { visa: { pct: 1.6, fixed_cents: 0 }, mastercard: { pct: 1.6, fixed_cents: 0 }, amex: { pct: 2.6, fixed_cents: 0 }, interac: { pct: 0, fixed_cents: 8 }, discover: { pct: 1.8, fixed_cents: 0 }, other: { pct: 1.8, fixed_cents: 0 } },
    "Card processing rates by card type (FR-10.05): % of the amount plus a fixed fee per payment, from the processor's statement; used to estimate fees until the bank shows the real ones"],
];
const CARD_TYPES = ["visa", "mastercard", "amex", "interac", "discover", "other"];

migrate((app) => {
  const pay = app.findCollectionByNameOrId("payments");
  pay.fields.add(new Field({ name: "card_type", type: "select", maxSelect: 1, values: CARD_TYPES }));
  app.save(pay);
  const parties = app.findCollectionByNameOrId("parties");
  base(app, "platform_payouts", [
    { name: "platform", type: "text", required: true, max: 40 },
    { name: "period_from", type: "text", required: true, max: 10 },
    { name: "period_to", type: "text", required: true, max: 10 },
    { name: "day", type: "text", max: 10 },                                    // when the platform pays it
    { name: "gross_cents", type: "number", onlyInt: true },                    // the orders, as the platform counts them
    { name: "commission_cents", type: "number", onlyInt: true },
    { name: "fees_cents", type: "number", onlyInt: true },
    { name: "adjustments_cents", type: "number", onlyInt: true },              // refunds, error charges (+/−)
    { name: "payout_cents", type: "number", onlyInt: true },
    { name: "orders", type: "json", maxSize: 100000 },                         // [{number, amount_cents}] from the statement
    { name: "check", type: "json", maxSize: 100000 },                          // the comparison with Chedam's orders
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["expected", "matched", "cancelled"] },
    { name: "bank_line", type: "text", max: 15 },
    { name: "note", type: "text", max: 300 },
  ], ["CREATE INDEX idx_payouts_platform ON platform_payouts (platform, period_from)"]);
  base(app, "vendor_statements", [
    { name: "party", type: "relation", required: true, collectionId: parties.id, maxSelect: 1, cascadeDelete: false },
    { name: "statement_date", type: "text", required: true, max: 10 },
    { name: "closing_balance_cents", type: "number", onlyInt: true },          // in the vendor's currency
    { name: "lines", type: "json", maxSize: 100000 },                          // [{ref, day, amount_cents, kind}]
    { name: "check", type: "json", maxSize: 100000 },
    { name: "difference_cents", type: "number", onlyInt: true },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["differences", "agreed"] },
    { name: "note", type: "text", max: 300 },
    { name: "by_name", type: "text", max: 80 },
  ], ["CREATE INDEX idx_vstatements_party ON vendor_statements (party, statement_date)"]);
  SETTINGS.forEach(([key, value, description]) => {
    const r = new Record(app.findCollectionByNameOrId("settings"));
    r.load({ key: key, value: value, description: description });
    r.set("created_by", "system"); r.set("updated_by", "system");
    app.save(r);
  });
}, (app) => {
  SETTINGS.forEach(([key]) => { try { app.delete(app.findFirstRecordByData("settings", "key", key)); } catch (_) { /* gone */ } });
  ["vendor_statements", "platform_payouts"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
  const pay = app.findCollectionByNameOrId("payments");
  pay.fields.removeByName("card_type");
  app.save(pay);
});

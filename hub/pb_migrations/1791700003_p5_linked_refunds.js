/// <reference path="../../pb_data/types.d.ts" />
// P5 step 3: card refunds through the linked processor (FR-4.14 stage 2), processor fees and payouts (FR-10.05).
// Each refund sent to the processor is kept with its status and what it was for (a return, a void, or a paid
// checkout no sale took); a refund line of a return names it. The processor's payouts are kept for matching
// the bank by hand. Down drops exactly what up adds.

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];

migrate((app) => {
  const procs = app.findCollectionByNameOrId("payment_processors");
  app.save(new Collection({ type: "base", name: "processor_refunds", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "processor", type: "relation", required: true, collectionId: procs.id, maxSelect: 1, cascadeDelete: false },
      { name: "sale", type: "text", max: 15 },                                 // the sale paid by the card ("" for a checkout no sale took)
      { name: "payment", type: "text", max: 15 },                              // Chedam's payment record
      { name: "checkout", type: "text", max: 15 },
      { name: "processor_payment", type: "text", max: 120 },
      { name: "ref", type: "text", required: true, max: 15 },                  // the return id, the voided sale's id, or the checkout id
      { name: "purpose", type: "select", required: true, maxSelect: 1, values: ["return", "void", "unused"] },
      { name: "amount_cents", type: "number", onlyInt: true },
      { name: "refund_id", type: "text", max: 120 },
      { name: "on_terminal", type: "bool" },
      { name: "terminal_name", type: "text", max: 60 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "completed", "rejected", "failed", "cancelled"] },
      { name: "card_type", type: "text", max: 20 },
      { name: "last4", type: "text", max: 4 },
      { name: "used_by", type: "text", max: 15 },                              // the return (or voided sale) that took it
      { name: "by_name", type: "text", max: 80 },
    ].concat(COMMON()),
    indexes: ["CREATE INDEX idx_prf_payment ON processor_refunds (payment, status)", "CREATE INDEX idx_prf_ref ON processor_refunds (ref)"] }));
  app.save(new Collection({ type: "base", name: "processor_payouts", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "processor", type: "relation", required: true, collectionId: procs.id, maxSelect: 1, cascadeDelete: false },
      { name: "payout_id", type: "text", required: true, max: 120 },
      { name: "status", type: "text", max: 20 },
      { name: "amount_cents", type: "number", onlyInt: true },
      { name: "arrival_date", type: "text", max: 10 },
    ].concat(COMMON()),
    indexes: ["CREATE UNIQUE INDEX idx_ppo_id ON processor_payouts (payout_id)"] }));
  const tco = app.findCollectionByNameOrId("terminal_checkouts");
  tco.fields.add(new Field({ name: "refund", type: "text", max: 15 }));         // the refund of a paid checkout no sale took
  app.save(tco);
  const rf = app.findCollectionByNameOrId("refunds");
  rf.fields.add(new Field({ name: "processor_refund", type: "text", max: 15 }));
  app.save(rf);
}, (app) => {
  const rf = app.findCollectionByNameOrId("refunds");
  rf.fields.removeByName("processor_refund");
  app.save(rf);
  const tco = app.findCollectionByNameOrId("terminal_checkouts");
  tco.fields.removeByName("refund");
  app.save(tco);
  ["processor_payouts", "processor_refunds"].forEach((n) => app.delete(app.findCollectionByNameOrId(n)));
});

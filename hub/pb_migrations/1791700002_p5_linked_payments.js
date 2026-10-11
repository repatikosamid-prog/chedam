/// <reference path="../../pb_data/types.d.ts" />
// P5 step 2: linked card payments at the till (FR-3.21, P5-b, P5-d). Each amount sent to a terminal is a
// checkout kept on the hub with what the processor answered (card type, last 4, its payment id, the fee); a
// card payment of a sale names the checkout it came from. Down drops exactly what up adds.

const COMMON = () => [
  { name: "created_at", type: "autodate", onCreate: true, onUpdate: false },
  { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
  { name: "created_by", type: "text", max: 64 },
  { name: "updated_by", type: "text", max: 64 },
  { name: "device_id", type: "text", max: 64 },
  { name: "deleted_at", type: "date" },
];

migrate((app) => {
  const procs = app.findCollectionByNameOrId("payment_processors"), terms = app.findCollectionByNameOrId("card_terminals");
  app.save(new Collection({ type: "base", name: "terminal_checkouts", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "processor", type: "relation", required: true, collectionId: procs.id, maxSelect: 1, cascadeDelete: false },
      { name: "terminal", type: "relation", required: true, collectionId: terms.id, maxSelect: 1, cascadeDelete: false },
      { name: "terminal_name", type: "text", max: 60 },
      { name: "till_device", type: "text", max: 15 },
      { name: "sale_id", type: "text", required: true, max: 15 },               // the sale being paid (the till's id)
      { name: "amount_cents", type: "number", onlyInt: true },
      { name: "checkout_id", type: "text", max: 120 },                         // the processor's checkout
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "in_progress", "cancel_requested", "completed", "cancelled", "failed"] },
      { name: "cancel_reason", type: "text", max: 60 },
      { name: "payment_id", type: "text", max: 120 },                          // the processor's payment when approved
      { name: "card_type", type: "text", max: 20 },
      { name: "last4", type: "text", max: 4 },
      { name: "fee_cents", type: "number", onlyInt: true },
      { name: "fee_known", type: "bool" },
      { name: "used_sale", type: "text", max: 15 },                            // the saved sale that took it
      { name: "started_by", type: "text", max: 80 },
      { name: "completed_at", type: "date" },
    ].concat(COMMON()),
    indexes: ["CREATE INDEX idx_tco_terminal ON terminal_checkouts (terminal, status)", "CREATE INDEX idx_tco_sale ON terminal_checkouts (sale_id)",
      "CREATE INDEX idx_tco_payment ON terminal_checkouts (payment_id)"] }));
  const pay = app.findCollectionByNameOrId("payments");
  pay.fields.add(new Field({ name: "checkout", type: "text", max: 15 }));
  pay.fields.add(new Field({ name: "processor_payment", type: "text", max: 120 }));
  app.save(pay);
}, (app) => {
  const pay = app.findCollectionByNameOrId("payments");
  pay.fields.removeByName("checkout");
  pay.fields.removeByName("processor_payment");
  app.save(pay);
  app.delete(app.findCollectionByNameOrId("terminal_checkouts"));
});

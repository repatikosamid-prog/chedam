/// <reference path="../../pb_data/types.d.ts" />
// DEV ONLY (sample data): vendors and a client with contacts, and a USD exchange rate (P3 step 1).

const TAG = "system:sample";
const PARTIES = [
  { kind: "vendor", name: "Fresh Fields Produce", code: "FRESH", currency: "CAD", payment_terms_days: 14, tax_id: "812345678RT0001", phone: "604-555-0110", email: "orders@freshfields.example", city: "Surrey", province: "BC",
    contacts: [["Priya Singh", "Sales rep", "priya@freshfields.example", "604-555-0111", true]] },
  { kind: "vendor", name: "Coastal Beverages Ltd.", code: "COAST", currency: "CAD", payment_terms_days: 30, terms_text: "2% 10, net 30", tax_id: "823456789RT0001", city: "Burnaby", province: "BC",
    contacts: [["Tom Chen", "Accounts receivable", "ar@coastal.example", "604-555-0120", true]] },
  { kind: "vendor", name: "Maple Snacks Wholesale", code: "MAPLE", currency: "USD", payment_terms_days: 30, importer: true, city: "Blaine", province: "WA", country: "US",
    contacts: [["Dana Ruiz", "Account manager", "dana@maplesnacks.example", "+1 360-555-0130", true]] },
  { kind: "client", name: "Cafe Luna", code: "LUNA", currency: "CAD", payment_terms_days: 30, credit_limit_cents: 50000, city: "Vancouver", province: "BC",
    contacts: [["Marco Bellini", "Owner", "marco@cafeluna.example", "604-555-0140", true]] },
];

migrate((app) => {
  PARTIES.forEach((x) => {
    const p = new Record(app.findCollectionByNameOrId("parties"));
    const f = Object.assign({ active: true, country: "CA" }, x);
    delete f.contacts;
    p.load(f); p.set("created_by", TAG); p.set("updated_by", TAG);
    app.save(p);
    x.contacts.forEach(([name, role, email, phone, primary]) => {
      const c = new Record(app.findCollectionByNameOrId("party_contacts"));
      c.load({ party: p.id, name: name, role: role, email: email, phone: phone, primary: primary });
      c.set("created_by", TAG); c.set("updated_by", TAG);
      app.save(c);
    });
  });
  const d = new Date(), day = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  const r = new Record(app.findCollectionByNameOrId("fx_rates"));
  r.load({ currency: "USD", day: day, rate: 1.37, source: "sample" });
  r.set("created_by", TAG); r.set("updated_by", TAG);
  app.save(r);
}, (app) => {
  ["fx_rates", "party_contacts", "parties"].forEach((n) => app.findRecordsByFilter(n, "created_by = 'system:sample'", "", 0, 0).forEach((r) => app.delete(r)));
});

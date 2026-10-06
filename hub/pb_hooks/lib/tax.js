// Tax tables (P1 step 1): FR-4.01, 4.02, 12.03; DL-68. Rates are rows with effective dates, so a
// tax-table update switches on by itself at its date. The tax engine for sales comes in step 3.

function forbid(msg) { throw new BadRequestError(msg); }

function province(app) {
  return require(`${__hooks}/lib/auth.js`).setting(app, "store.province", "BC");
}

// "2026-10-06 12:00:00.000Z" style, as PocketBase stores dates (sortable as text).
function dbTime(iso) {
  return new Date(iso).toISOString().replace("T", " ");
}

// The rates a tax class charges at a moment: [{code, label, rate, rate_id, pending_review}].
// Zero-rated and exempt classes charge nothing. A type with no rate in this province is skipped.
function ratesFor(app, classId, prov, atIso) {
  const cls = app.findRecordById("tax_classes", classId);
  if (cls.getString("treatment") !== "taxable") return [];
  const at = dbTime(atIso || new Date().toISOString());
  const p = prov === undefined ? province(app) : prov;
  const out = [];
  app.findRecordsByIds("tax_types", cls.get("tax_types")).forEach((t) => {
    const rows = app.findRecordsByFilter("tax_rates",
      "tax_type = {:t} && deleted_at = '' && (province = '' || province = {:p}) && effective_from <= {:at} && (effective_to = '' || effective_to > {:at})",
      "-province,-effective_from", 1, 0, { t: t.id, p: p, at: at });
    if (!rows.length) return;
    out.push({ code: t.getString("code"), label: t.getString("receipt_label") || t.getString("code"), rate: rows[0].getFloat("rate"),
      rate_id: rows[0].id, pending_review: rows[0].getBool("pending_review") });
  });
  return out.sort((a, b) => a.code < b.code ? -1 : 1);
}

function threeDecimals(n) { return Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6; }

function beforeWrite(app, record, action) {
  if (action === "delete") return;
  const name = record.collection().name;
  if (name === "tax_rates") {
    if (!threeDecimals(record.getFloat("rate"))) forbid("A tax rate has at most 3 decimals (BR-04).");
    const from = record.getString("effective_from"), to = record.getString("effective_to");
    if (to && to <= from) forbid("The end date must be after the start date.");
  }
  if (name === "tax_classes") {
    const n = (record.get("tax_types") || []).length;
    if (record.getString("treatment") === "taxable" && !n) forbid("A taxable class needs at least one tax type.");
    if (record.getString("treatment") !== "taxable" && n) forbid("Zero-rated and exempt classes charge no tax types.");
    if (!record.isNew() && record.original().getString("code") !== record.getString("code") && !record.original().getBool("is_custom")) {
      forbid("The code of a standard tax class cannot change.");
    }
  }
}

function afterWrite() { /* nothing yet */ }

module.exports = { ratesFor, province, beforeWrite, afterWrite };

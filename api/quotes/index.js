const { randomUUID } = require("crypto");
const { getTableClient } = require("../shared/table");

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json" },
    body
  };
}

function safeDateKey(iso) {
  const d = iso ? new Date(iso) : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRow(row = {}) {
  return {
    provider: row.provider || "",
    cpt: row.cpt || "",
    modifier: row.modifier || "",
    desc: row.desc || "",
    qty: num(row.qty || 1),
    billed: num(row.billed || 0),
    allowed: num(row.allowed ?? row.fee ?? 0),
    adjPct: num(row.adjPct || 0),
    adjAllowed: num(row.adjAllowed || 0),
    lineTotal: num(row.lineTotal || 0)
  };
}

function normalizeQuote(body) {
  const now = new Date().toISOString();
  return {
    id: body.id || randomUUID(),
    savedAt: body.savedAt || now,
    quoteDate: body.quoteDate || now.slice(0, 10),
    estimateType: body.estimateType === "orthotics" ? "orthotics" : "surgical",
    orthoticBasis: body.orthoticBasis === "selfPay" ? "selfPay" : (body.orthoticBasis === "insurance" ? "insurance" : ""),
    orthoticPayer: body.orthoticPayer || "",
    orthoticAllowableEach: num(body.orthoticAllowableEach || 0),
    orthoticSelfPayEach: num(body.orthoticSelfPayEach || 0),
    patientName: body.patientName || "",
    insurancePlan: body.insurancePlan || "",
    preparedBy: body.preparedBy || "",
    clinic: body.clinic || "",
    provider: body.provider || "",
    copay: num(body.copay || 0),
    dedRem: num(body.dedRem || 0),
    coinsPct: num(body.coinsPct || 0),
    oopRem: num(body.oopRem || 0),
    totalAllowed: num(body.totalAllowed || 0),
    dedApplied: num(body.dedApplied || 0),
    coinsAmt: num(body.coinsAmt || 0),
    estimatedDue: num(body.estimatedDue || 0),
    insuranceResponsibility: num(body.insuranceResponsibility || 0),
    recommendedDeposit: num(body.recommendedDeposit || 0),
    rows: Array.isArray(body.rows) ? body.rows.map(normalizeRow) : []
  };
}

function parseRows(rowsJson) {
  try {
    const rows = JSON.parse(rowsJson || "[]");
    return Array.isArray(rows) ? rows.map(normalizeRow) : [];
  } catch {
    return [];
  }
}

module.exports = async function (context, req) {
  try {
    const method = (req.method || "GET").toUpperCase();
    const table = getTableClient("quotes");

    if (method === "POST") {
      const quote = normalizeQuote(req.body || {});
      const partitionKey = safeDateKey(quote.savedAt);
      const rowKey = quote.id;

      await table.upsertEntity({
        partitionKey,
        rowKey,
        savedAt: quote.savedAt,
        quoteDate: quote.quoteDate,
        estimateType: quote.estimateType,
        orthoticBasis: quote.orthoticBasis,
        orthoticPayer: quote.orthoticPayer,
        orthoticAllowableEach: quote.orthoticAllowableEach,
        orthoticSelfPayEach: quote.orthoticSelfPayEach,
        patientName: quote.patientName,
        insurancePlan: quote.insurancePlan,
        preparedBy: quote.preparedBy,
        clinic: quote.clinic,
        provider: quote.provider,
        copay: quote.copay,
        dedRem: quote.dedRem,
        coinsPct: quote.coinsPct,
        oopRem: quote.oopRem,
        totalAllowed: quote.totalAllowed,
        dedApplied: quote.dedApplied,
        coinsAmt: quote.coinsAmt,
        estimatedDue: quote.estimatedDue,
        insuranceResponsibility: quote.insuranceResponsibility,
        recommendedDeposit: quote.recommendedDeposit,
        rowsJson: JSON.stringify(quote.rows)
      });

      return json(context, 200, { ok: true, id: quote.id });
    }

    if (method === "GET") {
      const take = Math.max(1, Math.min(5000, parseInt(req.query.take || "50", 10)));
      const items = [];

      for await (const entity of table.listEntities()) {
        items.push({
          id: entity.rowKey,
          savedAt: entity.savedAt,
          quoteDate: entity.quoteDate,
          estimateType: entity.estimateType || "surgical",
          orthoticBasis: entity.orthoticBasis || "",
          orthoticPayer: entity.orthoticPayer || "",
          orthoticAllowableEach: num(entity.orthoticAllowableEach || 0),
          orthoticSelfPayEach: num(entity.orthoticSelfPayEach || 0),
          patientName: entity.patientName,
          insurancePlan: entity.insurancePlan,
          preparedBy: entity.preparedBy,
          clinic: entity.clinic,
          provider: entity.provider,
          copay: num(entity.copay || 0),
          dedRem: num(entity.dedRem || 0),
          coinsPct: num(entity.coinsPct || 0),
          oopRem: num(entity.oopRem || 0),
          totalAllowed: num(entity.totalAllowed || 0),
          dedApplied: num(entity.dedApplied || 0),
          coinsAmt: num(entity.coinsAmt || 0),
          estimatedDue: num(entity.estimatedDue || 0),
          insuranceResponsibility: num(entity.insuranceResponsibility || 0),
          recommendedDeposit: num(entity.recommendedDeposit || 0),
          rows: parseRows(entity.rowsJson)
        });
      }

      items.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));

      return json(context, 200, {
        count: items.length,
        items: items.slice(0, take)
      });
    }

    return json(context, 405, { error: "Method not allowed" });
  } catch (err) {
    context.log("quotes error:", err);
    return json(context, 500, {
      error: "Quotes API failed",
      details: String(err?.message || err)
    });
  }
};

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

function normalizeQuote(body) {
  const now = new Date().toISOString();
  return {
    id: body.id || crypto.randomUUID(),
    savedAt: body.savedAt || now,
    quoteDate: body.quoteDate || now.slice(0, 10),
    patientName: body.patientName || "",
    insurancePlan: body.insurancePlan || "",
    preparedBy: body.preparedBy || "",
    clinic: body.clinic || "",
    provider: body.provider || "",
    copay: Number(body.copay || 0),
    dedRem: Number(body.dedRem || 0),
    coinsPct: Number(body.coinsPct || 0),
    oopRem: Number(body.oopRem || 0),
    totalAllowed: Number(body.totalAllowed || 0),
    dedApplied: Number(body.dedApplied || 0),
    coinsAmt: Number(body.coinsAmt || 0),
    estimatedDue: Number(body.estimatedDue || 0),
    recommendedDeposit: Number(body.recommendedDeposit || 0),
    rows: Array.isArray(body.rows) ? body.rows : []
  };
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
          patientName: entity.patientName,
          insurancePlan: entity.insurancePlan,
          preparedBy: entity.preparedBy,
          clinic: entity.clinic,
          provider: entity.provider,
          copay: Number(entity.copay || 0),
          dedRem: Number(entity.dedRem || 0),
          coinsPct: Number(entity.coinsPct || 0),
          oopRem: Number(entity.oopRem || 0),
          totalAllowed: Number(entity.totalAllowed || 0),
          dedApplied: Number(entity.dedApplied || 0),
          coinsAmt: Number(entity.coinsAmt || 0),
          estimatedDue: Number(entity.estimatedDue || 0),
          recommendedDeposit: Number(entity.recommendedDeposit || 0),
          rows: (() => {
            try {
              return JSON.parse(entity.rowsJson || "[]");
            } catch {
              return [];
            }
          })()
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
    return json(context, 500, { error: "Quotes API failed", details: String(err?.message || err) });
  }
};

const { v4: uuidv4 } = require("uuid");
const { getUserFromSwa, jsonResponse, getClient, ymdCompact, isoNow } = require("../shared/table");

function compact(ymd) {
  return String(ymd || "").replaceAll("-", "");
}
function localTimeString(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso || ""; }
}

module.exports = async function (context, req) {
  const user = getUserFromSwa(req);
  if (!user) return jsonResponse(context, 401, { ok: false, error: "Not authenticated" });

  // ROUTE: GET /api/quotes  -> list (history)
  if ((req.method || "").toUpperCase() === "GET") {
    const take = Math.min(parseInt(req.query.take || "50", 10) || 50, 200);
    const from = compact(req.query.from || "");
    const to = compact(req.query.to || "");
    const staff = String(req.query.staff || "").trim().toLowerCase();
    const clinic = String(req.query.clinic || "").trim().toLowerCase();
    const provider = String(req.query.provider || "").trim().toLowerCase();
    const q = String(req.query.q || "").trim().toLowerCase();

    try {
      const client = getClient();

      let filter = "";
      if (from && to) filter = `PartitionKey ge '${from}' and PartitionKey le '${to}'`;
      else if (from) filter = `PartitionKey ge '${from}'`;
      else if (to) filter = `PartitionKey le '${to}'`;

      const items = [];
      for await (const e of client.listEntities({ queryOptions: { filter: filter || undefined } })) {
        items.push({
          quoteId: e.quoteId,
          partitionKey: e.partitionKey,
          createdAt: e.createdAt,
          createdAtLocal: localTimeString(e.createdAt),
          createdBy: e.createdBy,
          patientName: e.patientName,
          provider: e.provider,
          clinic: e.clinic,
          recommendedDeposit: e.recommendedDeposit,
          estimatedOwes: e.estimatedOwes,
          rowKey: e.rowKey
        });
        if (items.length > 5000) break;
      }

      let filtered = items;
      if (staff) filtered = filtered.filter(x => String(x.createdBy || "").toLowerCase().includes(staff));
      if (clinic) filtered = filtered.filter(x => String(x.clinic || "").toLowerCase().includes(clinic));
      if (provider) filtered = filtered.filter(x => String(x.provider || "").toLowerCase().includes(provider));
      if (q) filtered = filtered.filter(x => String(x.patientName || "").toLowerCase().includes(q));

      filtered.sort((a, b) => String(b.rowKey || "").localeCompare(String(a.rowKey || "")));
      filtered = filtered.slice(0, take);

      return jsonResponse(context, 200, { ok: true, items: filtered });
    } catch (err) {
      return jsonResponse(context, 500, { ok: false, error: err.message || "Failed to list quotes" });
    }
  }

  // ROUTE: POST /api/quotes -> create/save
  try {
    const payload = req.body || {};
    const quoteId = uuidv4();

    const now = new Date();
    const partitionKey = ymdCompact(now);
    const rowKey = `${now.getTime()}_${quoteId}`;

    const createdAt = isoNow();
    const createdBy = user.userDetails || "unknown";

    const totals = payload.totals || {};
    const patientName = String(payload.patientName || "").slice(0, 200);
    const clinic = String(payload.clinic || "").slice(0, 200);
    const provider = String(payload.provider || "").slice(0, 200);

    const entity = {
      partitionKey,
      rowKey,

      quoteId,
      createdAt,
      createdBy,

      patientName,
      clinic,
      provider,

      recommendedDeposit: Number(totals.recommendedDeposit || 0),
      estimatedOwes: Number(totals.estimatedOwes || 0),

      payload: JSON.stringify(payload)
    };

    const client = getClient();
    try { await client.createTable(); } catch {}
    await client.createEntity(entity);

    return jsonResponse(context, 200, {
      ok: true,
      quoteId,
      partitionKey,
      createdAt,
      createdBy
    });
  } catch (err) {
    return jsonResponse(context, 500, { ok: false, error: err.message || "Failed to save quote" });
  }
};

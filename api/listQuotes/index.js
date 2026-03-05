const { getUserFromSwa, jsonResponse, getClient } = require("../shared/table");

function compact(ymd){
  return String(ymd || "").replaceAll("-", "");
}
function localTimeString(iso){
  try{ return new Date(iso).toLocaleString(); } catch { return iso || ""; }
}

module.exports = async function (context, req) {
  const user = getUserFromSwa(req);
  if (!user) return jsonResponse(context, 401, { error: "Not authenticated" });

  const take = Math.min(parseInt(req.query.take || "50", 10) || 50, 200);
  const from = compact(req.query.from || "");
  const to = compact(req.query.to || "");
  const staff = String(req.query.staff || "").trim().toLowerCase();
  const clinic = String(req.query.clinic || "").trim().toLowerCase();
  const provider = String(req.query.provider || "").trim().toLowerCase();
  const q = String(req.query.q || "").trim().toLowerCase();

  try{
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
      if (items.length > 2000) break;
    }

    let filtered = items;

    if (staff) filtered = filtered.filter(x => String(x.createdBy || "").toLowerCase().includes(staff));
    if (clinic) filtered = filtered.filter(x => String(x.clinic || "").toLowerCase().includes(clinic));
    if (provider) filtered = filtered.filter(x => String(x.provider || "").toLowerCase().includes(provider));
    if (q) filtered = filtered.filter(x => String(x.patientName || "").toLowerCase().includes(q));

    filtered.sort((a,b) => String(b.rowKey || "").localeCompare(String(a.rowKey || "")));
    filtered = filtered.slice(0, take);

    return jsonResponse(context, 200, { ok:true, items: filtered });
  } catch (err){
    return jsonResponse(context, 500, { error: err.message || "Failed to list quotes" });
  }
};

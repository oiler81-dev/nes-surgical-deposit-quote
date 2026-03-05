// api/reportSummary/index.js
const { getUserFromSwa, jsonResponse, getClient } = require("../shared/table");

function compact(ymd) {
  return String(ymd || "").replaceAll("-", "");
}

function ymdFromPartition(pk) {
  if (!pk || String(pk).length !== 8) return String(pk || "");
  const s = String(pk);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function addAgg(map, key, dep, due) {
  const k = key || "(blank)";
  if (!map.has(k)) map.set(k, { key: k, quotes: 0, deposits: 0, due: 0 });
  const obj = map.get(k);
  obj.quotes += 1;
  obj.deposits += Number(dep || 0);
  obj.due += Number(due || 0);
}

module.exports = async function (context, req) {
  const user = getUserFromSwa(req);
  if (!user) return jsonResponse(context, 401, { error: "Not authenticated" });

  const from = compact(req.query.from || "");
  const to = compact(req.query.to || "");
  const clinicFilter = String(req.query.clinic || "").trim().toLowerCase();
  const providerFilter = String(req.query.provider || "").trim().toLowerCase();

  try {
    const client = getClient();

    let filter = "";
    if (from && to) filter = `PartitionKey ge '${from}' and PartitionKey le '${to}'`;
    else if (from) filter = `PartitionKey ge '${from}'`;
    else if (to) filter = `PartitionKey le '${to}'`;

    const summary = { quotes: 0, deposits: 0, due: 0 };

    const staffAgg = new Map();
    const clinicAgg = new Map();
    const providerAgg = new Map();
    const dateAgg = new Map();
    const exportItems = [];

    for await (const e of client.listEntities({ queryOptions: { filter: filter || undefined } })) {
      const clinic = String(e.clinic || "");
      const provider = String(e.provider || "");

      if (clinicFilter && !clinic.toLowerCase().includes(clinicFilter)) continue;
      if (providerFilter && !provider.toLowerCase().includes(providerFilter)) continue;

      const dep = Number(e.recommendedDeposit || 0);
      const due = Number(e.estimatedOwes || 0);

      summary.quotes += 1;
      summary.deposits += dep;
      summary.due += due;

      addAgg(staffAgg, e.createdBy, dep, due);
      addAgg(clinicAgg, clinic, dep, due);
      addAgg(providerAgg, provider, dep, due);
      addAgg(dateAgg, ymdFromPartition(e.partitionKey), dep, due);

      exportItems.push({
        date: ymdFromPartition(e.partitionKey),
        createdAt: e.createdAt,
        patientName: e.patientName,
        provider,
        clinic,
        createdBy: e.createdBy,
        recommendedDeposit: dep,
        estimatedOwes: due,
        quoteId: e.quoteId
      });

      if (exportItems.length > 10000) break;
    }

    const toArray = (map, label) =>
      Array.from(map.values())
        .map((v) => {
          const out = { quotes: v.quotes, deposits: v.deposits, due: v.due };
          out[label] = v.key;
          return out;
        })
        .sort((a, b) => b.quotes - a.quotes);

    const byStaff = toArray(staffAgg, "staff");
    const byClinic = toArray(clinicAgg, "clinic");
    const byProvider = toArray(providerAgg, "provider");
    const byDate = toArray(dateAgg, "date").sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return jsonResponse(context, 200, {
      ok: true,
      summary,
      byStaff,
      byClinic,
      byProvider,
      byDate,
      exportItems
    });
  } catch (err) {
    return jsonResponse(context, 500, { error: err.message || "Failed to build report" });
  }
};

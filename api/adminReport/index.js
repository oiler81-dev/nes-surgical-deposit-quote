const { getUserFromSwa, jsonResponse, getTableClient } = require("../shared/table");

function compact(ymd) {
  return String(ymd || "").replaceAll("-", "");
}

function ymdFromPartition(pk) {
  if (!pk || String(pk).length !== 8) return String(pk || "");
  const s = String(pk);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function addAgg(map, key, dep, due, insurance, type, basis) {
  const k = key || "(blank)";
  if (!map.has(k)) {
    map.set(k, {
      key: k,
      quotes: 0,
      deposits: 0,
      due: 0,
      insurance: 0,
      surgical: 0,
      orthotics: 0,
      orthoticsInsurance: 0,
      orthoticsSelfPay: 0
    });
  }

  const obj = map.get(k);
  obj.quotes += 1;
  obj.deposits += dep;
  obj.due += due;
  obj.insurance += insurance;

  if (type === "orthotics") {
    obj.orthotics += 1;
    if (basis === "selfPay") obj.orthoticsSelfPay += 1;
    else obj.orthoticsInsurance += 1;
  } else {
    obj.surgical += 1;
  }
}

function parseRows(rowsJson) {
  try {
    const rows = JSON.parse(rowsJson || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

module.exports = async function (context, req) {
  const user = getUserFromSwa(req);
  if (!user) {
    return jsonResponse(context, 401, { ok: false, error: "Not authenticated" });
  }

  const from = compact(req.query.from || "");
  const to = compact(req.query.to || "");
  const clinicFilter = String(req.query.clinic || "").trim().toLowerCase();
  const providerFilter = String(req.query.provider || "").trim().toLowerCase();
  const staffFilter = String(req.query.staff || "").trim().toLowerCase();
  const patientFilter = String(req.query.patient || "").trim().toLowerCase();
  const typeFilter = String(req.query.type || "").trim().toLowerCase();
  const basisFilter = String(req.query.basis || "").trim().toLowerCase();
  const orthoticPayerFilter = String(req.query.orthoticPayer || "").trim().toLowerCase();

  try {
    const client = getTableClient("quotes");

    let filter = "";
    if (from && to) filter = `PartitionKey ge '${from}' and PartitionKey le '${to}'`;
    else if (from) filter = `PartitionKey ge '${from}'`;
    else if (to) filter = `PartitionKey le '${to}'`;

    const summary = {
      quotes: 0,
      deposits: 0,
      due: 0,
      insurance: 0,
      surgicalQuotes: 0,
      orthoticsQuotes: 0,
      orthoticsInsuranceQuotes: 0,
      orthoticsSelfPayQuotes: 0
    };

    const staffAgg = new Map();
    const clinicAgg = new Map();
    const providerAgg = new Map();
    const dateAgg = new Map();
    const typeAgg = new Map();
    const payerAgg = new Map();

    const exportItems = [];

    for await (const e of client.listEntities({ queryOptions: { filter: filter || undefined } })) {
      const clinic = String(e.clinic || "");
      const provider = String(e.provider || "");
      const preparedBy = String(e.preparedBy || "");
      const patientName = String(e.patientName || "");
      const estimateType = String(e.estimateType || "surgical");
      const orthoticBasis = String(e.orthoticBasis || "");
      const orthoticPayer = String(e.orthoticPayer || "");

      if (clinicFilter && !clinic.toLowerCase().includes(clinicFilter)) continue;
      if (providerFilter && !provider.toLowerCase().includes(providerFilter)) continue;
      if (staffFilter && !preparedBy.toLowerCase().includes(staffFilter)) continue;
      if (patientFilter && !patientName.toLowerCase().includes(patientFilter)) continue;
      if (typeFilter && estimateType.toLowerCase() !== typeFilter) continue;
      if (basisFilter && orthoticBasis.toLowerCase() !== basisFilter) continue;
      if (orthoticPayerFilter && !orthoticPayer.toLowerCase().includes(orthoticPayerFilter)) continue;

      const dep = num(e.recommendedDeposit || 0);
      const due = num(e.estimatedDue || 0);
      const insurance = num(e.insuranceResponsibility || 0);

      summary.quotes += 1;
      summary.deposits += dep;
      summary.due += due;
      summary.insurance += insurance;

      if (estimateType === "orthotics") {
        summary.orthoticsQuotes += 1;
        if (orthoticBasis === "selfPay") summary.orthoticsSelfPayQuotes += 1;
        else summary.orthoticsInsuranceQuotes += 1;
      } else {
        summary.surgicalQuotes += 1;
      }

      addAgg(staffAgg, preparedBy, dep, due, insurance, estimateType, orthoticBasis);
      addAgg(clinicAgg, clinic, dep, due, insurance, estimateType, orthoticBasis);
      addAgg(providerAgg, provider, dep, due, insurance, estimateType, orthoticBasis);
      addAgg(dateAgg, ymdFromPartition(e.partitionKey), dep, due, insurance, estimateType, orthoticBasis);
      addAgg(typeAgg, estimateType || "surgical", dep, due, insurance, estimateType, orthoticBasis);

      if (orthoticPayer) {
        addAgg(payerAgg, orthoticPayer, dep, due, insurance, estimateType, orthoticBasis);
      }

      const rows = parseRows(e.rowsJson);

      exportItems.push({
        id: e.rowKey,
        date: ymdFromPartition(e.partitionKey),
        savedAt: e.savedAt || "",
        quoteDate: e.quoteDate || "",
        estimateType,
        orthoticBasis,
        orthoticPayer,
        orthoticAllowableEach: num(e.orthoticAllowableEach || 0),
        orthoticSelfPayEach: num(e.orthoticSelfPayEach || 0),
        patientName,
        insurancePlan: String(e.insurancePlan || ""),
        provider,
        clinic,
        preparedBy,
        copay: num(e.copay || 0),
        dedRem: num(e.dedRem || 0),
        coinsPct: num(e.coinsPct || 0),
        oopRem: num(e.oopRem || 0),
        totalAllowed: num(e.totalAllowed || 0),
        dedApplied: num(e.dedApplied || 0),
        coinsAmt: num(e.coinsAmt || 0),
        estimatedDue: due,
        insuranceResponsibility: insurance,
        recommendedDeposit: dep,
        rows
      });

      if (exportItems.length > 10000) break;
    }

    const toArray = (map, label) =>
      Array.from(map.values())
        .map(v => {
          const out = {
            quotes: v.quotes,
            deposits: v.deposits,
            due: v.due,
            insurance: v.insurance,
            surgical: v.surgical,
            orthotics: v.orthotics,
            orthoticsInsurance: v.orthoticsInsurance,
            orthoticsSelfPay: v.orthoticsSelfPay
          };
          out[label] = v.key;
          return out;
        })
        .sort((a, b) => b.quotes - a.quotes);

    const byStaff = toArray(staffAgg, "staff");
    const byClinic = toArray(clinicAgg, "clinic");
    const byProvider = toArray(providerAgg, "provider");
    const byType = toArray(typeAgg, "type");
    const byOrthoticPayer = toArray(payerAgg, "orthoticPayer");
    const byDate = toArray(dateAgg, "date").sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    );

    return jsonResponse(context, 200, {
      ok: true,
      summary,
      byStaff,
      byClinic,
      byProvider,
      byType,
      byOrthoticPayer,
      byDate,
      exportItems
    });
  } catch (err) {
    return jsonResponse(context, 500, {
      ok: false,
      error: err.message || "Failed to build report"
    });
  }
};

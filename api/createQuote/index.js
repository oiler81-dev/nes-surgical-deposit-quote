const { v4: uuidv4 } = require("uuid");
const { getUserFromSwa, jsonResponse, getClient, ymdCompact, isoNow } = require("../shared/table");

module.exports = async function (context, req) {
  const user = getUserFromSwa(req);
  if (!user) return jsonResponse(context, 401, { error: "Not authenticated" });

  const payload = req.body || {};
  const quoteId = uuidv4();

  const now = new Date();
  const partitionKey = ymdCompact(now); // YYYYMMDD
  const rowKey = `${now.getTime()}_${quoteId}`; // sort newest

  const createdAt = isoNow();
  const createdBy = user.userDetails || "unknown";

  const totals = payload.totals || {};
  const patientName = String(payload.patientName || "").slice(0, 200);
  const clinic = String(payload.clinic || "").slice(0, 200);

  const entity = {
    partitionKey,
    rowKey,

    quoteId,
    createdAt,
    createdBy,

    patientName,
    clinic,

    recommendedDeposit: Number(totals.recommendedDeposit || 0),
    estimatedOwes: Number(totals.estimatedOwes || 0),

    payload: JSON.stringify(payload)
  };

  try{
    const client = getClient();
    try{ await client.createTable(); } catch {}
    await client.createEntity(entity);

    return jsonResponse(context, 200, {
      ok:true,
      quoteId,
      partitionKey,
      createdAt,
      createdBy
    });
  } catch (err){
    return jsonResponse(context, 500, { error: err.message || "Failed to save quote" });
  }
};

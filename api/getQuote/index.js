const { TableClient } = require("@azure/data-tables");

function getUserFromSwa(req) {
  const b64 = req.headers["x-ms-client-principal"];
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function json(res, status, body) {
  res.status = status;
  res.headers = { "Content-Type": "application/json" };
  res.body = body;
  return res;
}

module.exports = async function (context, req) {
  const user = getUserFromSwa(req);
  if (!user) {
    context.res = json(context.res, 401, { error: "Not authenticated" });
    return;
  }

  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const tableName = process.env.QUOTES_TABLE_NAME || "SurgicalDepositQuotes";
  if (!conn) {
    context.res = json(context.res, 500, { error: "Missing AZURE_STORAGE_CONNECTION_STRING" });
    return;
  }

  const { partitionKey, quoteId } = context.bindingData;
  const client = TableClient.fromConnectionString(conn, tableName);

  try {
    // rowKey is quoteId
    const entity = await client.getEntity(partitionKey, quoteId);

    context.res = json(context.res, 200, {
      ok: true,
      quoteId: entity.quoteId,
      partitionKey: entity.partitionKey,
      createdAt: entity.createdAt,
      createdBy: entity.createdBy,
      payload: JSON.parse(entity.payload || "{}")
    });
  } catch (err) {
    context.res = json(context.res, 404, { error: "Quote not found" });
  }
};

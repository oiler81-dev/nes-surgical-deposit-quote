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

  const client = TableClient.fromConnectionString(conn, tableName);

  const take = Math.min(parseInt(req.query.take || "20", 10) || 20, 100);
  const partitionKey = req.query.date || null; // optional: YYYY-MM-DD

  try {
    const items = [];
    const filter = partitionKey ? `PartitionKey eq '${partitionKey}'` : undefined;

    let count = 0;
    for await (const e of client.listEntities({ queryOptions: { filter } })) {
      items.push({
        quoteId: e.quoteId,
        createdAt: e.createdAt,
        createdBy: e.createdBy,
        partitionKey: e.partitionKey
      });
      count++;
      if (count >= take) break;
    }

    // Sort newest first (createdAt is ISO)
    items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    context.res = json(context.res, 200, { ok: true, items });
  } catch (err) {
    context.res = json(context.res, 500, { error: err.message || "Failed to list quotes" });
  }
};

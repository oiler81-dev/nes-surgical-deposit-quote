const { TableClient } = require("@azure/data-tables");
const { v4: uuidv4 } = require("uuid");

function getUserFromSwa(req) {
  // SWA sends user info in this header to the API
  const b64 = req.headers["x-ms-client-principal"];
  if (!b64) return null;
  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
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

  const body = req.body || {};
  const quoteId = uuidv4();

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const partitionKey = `${yyyy}-${mm}-${dd}`; // daily partition (fast list by day)

  const rowKey = quoteId;

  const entity = {
    partitionKey,
    rowKey,

    quoteId,
    createdAt: now.toISOString(),
    createdBy: user.userDetails || "unknown",
    identityProvider: user.identityProvider || "aad",

    // Store the full quote payload as JSON
    payload: JSON.stringify(body)
  };

  const client = TableClient.fromConnectionString(conn, tableName);

  try {
    // Ensure table exists (safe to call; if it exists, it throws sometimes depending on permissions)
    try { await client.createTable(); } catch {}

    await client.createEntity(entity);

    context.res = json(context.res, 200, {
      ok: true,
      quoteId,
      partitionKey,
      createdAt: entity.createdAt,
      createdBy: entity.createdBy
    });
  } catch (err) {
    context.res = json(context.res, 500, { error: err.message || "Failed to save quote" });
  }
};

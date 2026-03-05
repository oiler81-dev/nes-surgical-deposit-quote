const { TableClient } = require("@azure/data-tables");

function getUserFromSwa(req) {
  const b64 =
    (req.headers && (req.headers["x-ms-client-principal"] || req.headers["X-MS-CLIENT-PRINCIPAL"])) ||
    null;

  if (!b64) return null;

  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function jsonResponse(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json" },
    body
  };
}

function getStorageConnectionString() {
  return (
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage ||
    process.env.AZUREWEBJOBSSTORAGE
  );
}

function getClient() {
  const conn = getStorageConnectionString();
  const tableName = process.env.QUOTES_TABLE_NAME || "SurgicalDepositQuotes";

  if (!conn) {
    throw new Error(
      "Missing storage connection string. Set AzureWebJobsStorage (recommended) or AZURE_STORAGE_CONNECTION_STRING in SWA Environment Variables."
    );
  }

  return TableClient.fromConnectionString(conn, tableName);
}

function ymdCompact(dateObj) {
  const yyyy = dateObj.getUTCFullYear();
  const mm = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function isoNow() {
  return new Date().toISOString();
}

module.exports = { getUserFromSwa, jsonResponse, getClient, ymdCompact, isoNow };

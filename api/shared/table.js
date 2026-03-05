// api/shared/table.js
const { TableClient } = require("@azure/data-tables");

/**
 * Read the SWA user principal from the request headers.
 * Returns parsed principal object or null.
 */
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

/**
 * Standard JSON response helper
 */
function jsonResponse(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json" },
    body
  };
}

/**
 * Storage connection resolution:
 * - Prefer AZURE_STORAGE_CONNECTION_STRING (your custom var)
 * - Fallback to AzureWebJobsStorage (standard Functions var)
 */
function getStorageConnectionString() {
  return (
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage || // standard Functions setting
    process.env.AZUREWEBJOBSSTORAGE // just in case of odd casing
  );
}

/**
 * Gets a TableClient for quotes table.
 * Requires a storage connection string in either:
 * - AZURE_STORAGE_CONNECTION_STRING
 * - AzureWebJobsStorage
 */
function getClient() {
  const conn = getStorageConnectionString();
  const tableName = process.env.QUOTES_TABLE_NAME || "SurgicalDepositQuotes";

  if (!conn) {
    throw new Error(
      "Missing storage connection string. Set AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage in Static Web App Environment Variables."
    );
  }

  return TableClient.fromConnectionString(conn, tableName);
}

/**
 * YYYYMMDD (UTC), string-sortable
 */
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

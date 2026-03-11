const { TableClient } = require("@azure/data-tables");

function getConnectionString() {
  const connectionString =
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage;

  if (!connectionString) {
    throw new Error("Missing AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage.");
  }

  return connectionString;
}

function getTableClient(tableName) {
  const client = TableClient.fromConnectionString(getConnectionString(), tableName);

  return {
    async ensureTable() {
      await client.createTable().catch(() => {});
    },

    async upsertEntity(entity) {
      await client.createTable().catch(() => {});
      return client.upsertEntity(entity, "Merge");
    },

    async getEntity(partitionKey, rowKey) {
      await client.createTable().catch(() => {});
      return client.getEntity(partitionKey, rowKey);
    },

    async *listEntities(options = {}) {
      await client.createTable().catch(() => {});
      for await (const entity of client.listEntities(options)) {
        yield entity;
      }
    }
  };
}

function jsonResponse(context, status, body) {
  context.res = {
    status,
    headers: {
      "Content-Type": "application/json"
    },
    body
  };
  return context.res;
}

function getUserFromSwa(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;

  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

module.exports = {
  getTableClient,
  jsonResponse,
  getUserFromSwa
};

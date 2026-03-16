const { TableClient } = require("@azure/data-tables");

function getTableClient(tableName) {
  const connectionString =
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage;

  if (!connectionString) {
    throw new Error("Missing AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage.");
  }

  const client = TableClient.fromConnectionString(connectionString, tableName);

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

    listEntities(options = {}) {
      return client.listEntities(options);
    }
  };
}

function getUserFromSwa(req) {
  const principal = req.headers["x-ms-client-principal"];

  if (!principal) {
    return {
      authenticated: false,
      userDetails: null,
      userId: null,
      roles: ["anonymous"]
    };
  }

  const decoded = JSON.parse(Buffer.from(principal, "base64").toString("utf8"));

  return {
    authenticated: true,
    userDetails: decoded.userDetails || null,
    userId: decoded.userId || null,
    roles: Array.isArray(decoded.userRoles) ? decoded.userRoles : ["authenticated"]
  };
}

function jsonResponse(context, body, status = 200) {
  context.res = {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body
  };
}

module.exports = {
  getTableClient,
  getUserFromSwa,
  jsonResponse
};

const { TableClient } = require("@azure/data-tables");

function getClient(tableName) {
  const connectionString =
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage;

  if (!connectionString) {
    throw new Error("Missing storage connection string.");
  }

  return TableClient.fromConnectionString(connectionString, tableName);
}

function getTableClient(tableName) {
  const client = getClient(tableName);

  return {
    async upsertEntity(entity) {
      await client.createTable().catch(() => {});
      return client.upsertEntity(entity, "Merge");
    },

    async getEntity(partitionKey, rowKey) {
      return client.getEntity(partitionKey, rowKey);
    },

    async *listEntities() {
      await client.createTable().catch(() => {});
      for await (const entity of client.listEntities()) {
        yield entity;
      }
    }
  };
}

function getUserFromSwa(req) {
  const principal = req.headers["x-ms-client-principal"];

  if (!principal) {
    return {
      authenticated: false,
      userDetails: null,
      roles: ["anonymous"]
    };
  }

  const decoded = JSON.parse(
    Buffer.from(principal, "base64").toString("utf8")
  );

  return {
    authenticated: true,
    userDetails: decoded.userDetails,
    roles: decoded.userRoles || []
  };
}

function jsonResponse(context, body, status = 200) {
  context.res = {
    status,
    headers: {
      "Content-Type": "application/json"
    },
    body
  };
}

module.exports = {
  getTableClient,
  getUserFromSwa,
  jsonResponse
};

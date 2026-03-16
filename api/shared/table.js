const { TableClient } = require("@azure/data-tables");

function getTableClient(tableName) {
  const connectionString =
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    process.env.AzureWebJobsStorage;

  if (!connectionString) {
    throw new Error("Missing AZURE_STORAGE_CONNECTION_STRING or AzureWebJobsStorage.");
  }

  const client = TableClient.fromConnectionString(connectionString, tableName);

  async function ensureTable() {
    try {
      await client.createTable();
    } catch (err) {
      const code = err?.statusCode || err?.code;
      if (code !== 409 && code !== "TableAlreadyExists") {
        throw err;
      }
    }
  }

  return {
    raw: client,

    async upsertEntity(entity, mode = "Merge") {
      await ensureTable();
      return client.upsertEntity(entity, mode);
    },

    async getEntity(partitionKey, rowKey) {
      await ensureTable();
      try {
        return await client.getEntity(partitionKey, rowKey);
      } catch (err) {
        const code = err?.statusCode || err?.code;
        if (code === 404 || code === "ResourceNotFound") return null;
        throw err;
      }
    },

    async deleteEntity(partitionKey, rowKey) {
      await ensureTable();
      try {
        return await client.deleteEntity(partitionKey, rowKey);
      } catch (err) {
        const code = err?.statusCode || err?.code;
        if (code === 404 || code === "ResourceNotFound") return null;
        throw err;
      }
    },

    async *listEntities(queryOptions = {}) {
      await ensureTable();
      for await (const entity of client.listEntities(queryOptions)) {
        yield entity;
      }
    }
  };
}

module.exports = { getTableClient };

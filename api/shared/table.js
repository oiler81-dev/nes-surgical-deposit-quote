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
    async upsertEntity(entity) {
      await client.createTable().catch(() => {});
      return client.upsertEntity(entity, "Merge");
    },

    async *listEntities() {
      await client.createTable().catch(() => {});
      for await (const entity of client.listEntities()) {
        yield entity;
      }
    }
  };
}

module.exports = { getTableClient };

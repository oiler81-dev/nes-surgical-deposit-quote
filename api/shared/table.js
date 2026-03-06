const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

function getTableClient(tableName) {
  const account = process.env.STORAGE_ACCOUNT_NAME;
  const key = process.env.STORAGE_ACCOUNT_KEY;

  if (!account || !key) {
    throw new Error("Missing STORAGE_ACCOUNT_NAME or STORAGE_ACCOUNT_KEY app settings.");
  }

  const credential = new AzureNamedKeyCredential(account, key);
  const client = new TableClient(
    `https://${account}.table.core.windows.net`,
    tableName,
    credential
  );

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

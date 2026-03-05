const { getUserFromSwa, jsonResponse, getClient } = require("../shared/table");

module.exports = async function (context, req) {
  const user = getUserFromSwa(req);
  if (!user) return jsonResponse(context, 401, { error: "Not authenticated" });

  const { partitionKey, quoteId } = context.bindingData;
  try{
    const client = getClient();

    // We used rowKey = timestamp_uuid, so we can’t fetch by quoteId directly.
    // We scan partition and find the entity with quoteId.
    const filter = `PartitionKey eq '${partitionKey}'`;
    for await (const e of client.listEntities({ queryOptions: { filter } })) {
      if (String(e.quoteId) === String(quoteId)){
        return jsonResponse(context, 200, {
          ok:true,
          quoteId: e.quoteId,
          partitionKey: e.partitionKey,
          createdAt: e.createdAt,
          createdBy: e.createdBy,
          payload: JSON.parse(e.payload || "{}")
        });
      }
    }

    return jsonResponse(context, 404, { error: "Quote not found" });
  } catch (err){
    return jsonResponse(context, 500, { error: err.message || "Failed to get quote" });
  }
};

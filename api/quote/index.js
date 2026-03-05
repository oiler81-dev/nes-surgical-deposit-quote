const { getUserFromSwa, jsonResponse, getClient } = require("../shared/table");

module.exports = async function (context, req) {
  const user = getUserFromSwa(req);
  if (!user) return jsonResponse(context, 401, { ok: false, error: "Not authenticated" });

  const quoteId = String((context.bindingData || {}).quoteId || "").trim();
  if (!quoteId) return jsonResponse(context, 400, { ok: false, error: "Missing quoteId" });

  try {
    const client = getClient();

    // Table Storage has no "search by non-key" index.
    // So we scan and stop when found. (OK for small-to-medium usage)
    for await (const e of client.listEntities()) {
      if (String(e.quoteId || "") === quoteId) {
        let payload = null;
        try { payload = JSON.parse(e.payload || "{}"); } catch { payload = null; }

        return jsonResponse(context, 200, {
          ok: true,
          quote: {
            quoteId: e.quoteId,
            createdAt: e.createdAt,
            createdBy: e.createdBy,
            patientName: e.patientName,
            clinic: e.clinic,
            provider: e.provider,
            recommendedDeposit: e.recommendedDeposit,
            estimatedOwes: e.estimatedOwes,
            payload
          }
        });
      }
    }

    return jsonResponse(context, 404, { ok: false, error: "Quote not found" });
  } catch (err) {
    return jsonResponse(context, 500, { ok: false, error: err.message || "Failed to get quote" });
  }
};

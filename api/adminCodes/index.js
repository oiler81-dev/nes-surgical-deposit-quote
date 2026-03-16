const { getTableClient, getUserFromSwa, jsonResponse } = require("../shared/table");

function cleanCode(v) {
  return String(v || "").trim().toUpperCase();
}

function cleanText(v) {
  return String(v || "").trim();
}

function cleanMoney(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function cleanBool(v, fallback = true) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return fallback;
}

function isAdmin(user) {
  return !!(user && Array.isArray(user.roles) && user.roles.includes("admin"));
}

function mapEntity(e) {
  return {
    cpt: e.RowKey,
    description: e.description || "",
    allowed: Number(e.allowed || 0),
    active: e.active !== false,
    updatedBy: e.updatedBy || "",
    updatedAt: e.updatedAt || ""
  };
}

module.exports = async function (context, req) {
  try {
    const user = getUserFromSwa(req);
    const table = getTableClient("FeeSchedule");
    const method = String(req.method || "GET").toUpperCase();

    if (method === "GET") {
      const items = [];
      for await (const entity of table.listEntities()) {
        if (entity.PartitionKey !== "CPT") continue;
        items.push(mapEntity(entity));
      }

      items.sort((a, b) => a.cpt.localeCompare(b.cpt));

      return jsonResponse(context, {
        ok: true,
        items,
        user: {
          authenticated: user.authenticated,
          userDetails: user.userDetails,
          roles: user.roles || []
        }
      });
    }

    if (!user.authenticated) {
      return jsonResponse(context, { ok: false, error: "Not signed in." }, 401);
    }

    if (!isAdmin(user)) {
      return jsonResponse(context, { ok: false, error: "Admin role required." }, 403);
    }

    const body = req.body || {};

    if (method === "POST") {
      const cpt = cleanCode(body.cpt);
      const description = cleanText(body.description);
      const allowed = cleanMoney(body.allowed);
      const active = cleanBool(body.active, true);

      if (!cpt) {
        return jsonResponse(context, { ok: false, error: "CPT is required." }, 400);
      }

      const now = new Date().toISOString();

      await table.upsertEntity({
        PartitionKey: "CPT",
        RowKey: cpt,
        cpt,
        description,
        allowed,
        active,
        updatedBy: user.userDetails || "",
        updatedAt: now
      });

      return jsonResponse(context, { ok: true });
    }

    if (method === "PUT") {
      const cpt = cleanCode(body.cpt);
      const description = cleanText(body.description);
      const allowed = cleanMoney(body.allowed);
      const active = cleanBool(body.active, true);

      if (!cpt) {
        return jsonResponse(context, { ok: false, error: "CPT is required." }, 400);
      }

      const now = new Date().toISOString();

      await table.upsertEntity({
        PartitionKey: "CPT",
        RowKey: cpt,
        cpt,
        description,
        allowed,
        active,
        updatedBy: user.userDetails || "",
        updatedAt: now
      });

      return jsonResponse(context, { ok: true });
    }

    if (method === "DELETE") {
      const cpt = cleanCode(req.query?.cpt || body.cpt);

      if (!cpt) {
        return jsonResponse(context, { ok: false, error: "CPT is required." }, 400);
      }

      let existing;
      try {
        existing = await table.getEntity("CPT", cpt);
      } catch {
        existing = null;
      }

      if (!existing) {
        return jsonResponse(context, { ok: false, error: "Code not found." }, 404);
      }

      await table.upsertEntity({
        ...existing,
        PartitionKey: "CPT",
        RowKey: cpt,
        active: false,
        updatedBy: user.userDetails || "",
        updatedAt: new Date().toISOString()
      });

      return jsonResponse(context, { ok: true });
    }

    return jsonResponse(context, { ok: false, error: "Method not allowed." }, 405);
  } catch (err) {
    return jsonResponse(
      context,
      {
        ok: false,
        error: err?.message || "Unexpected server error."
      },
      500
    );
  }
};

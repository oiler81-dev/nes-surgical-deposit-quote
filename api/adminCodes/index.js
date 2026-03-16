const { getTableClient } = require("../shared/table");

const TABLE_NAME = "FeeSchedule";
const PARTITION_KEY = "CPT";

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json" },
    body
  };
}

function parsePrincipal(req) {
  const raw = req.headers["x-ms-client-principal"];
  if (!raw) return null;

  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    return decoded || null;
  } catch {
    return null;
  }
}

function getRoles(principal) {
  return Array.isArray(principal?.userRoles) ? principal.userRoles : [];
}

function isAdmin(principal) {
  return getRoles(principal).some(r => String(r).toLowerCase() === "admin");
}

function normalizeCpt(value) {
  return String(value || "").trim().toUpperCase();
}

function toBool(value, defaultValue = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(v)) return true;
    if (["false", "0", "no", "n"].includes(v)) return false;
  }
  return defaultValue;
}

function parseAllowed(value) {
  const n = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function mapEntity(entity) {
  return {
    cpt: entity.RowKey,
    description: entity.description || "",
    allowed: Number(entity.allowed || 0),
    active: entity.active !== false,
    updatedBy: entity.updatedBy || "",
    updatedAt: entity.updatedAt || "",
    createdBy: entity.createdBy || "",
    createdAt: entity.createdAt || ""
  };
}

module.exports = async function (context, req) {
  const principal = parsePrincipal(req);
  const method = String(req.method || "GET").toUpperCase();
  const table = getTableClient(TABLE_NAME);

  try {
    if (method === "GET") {
      const activeOnly = toBool(req.query.activeOnly, false);
      const items = [];

      for await (const entity of table.listEntities({
        queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` }
      })) {
        const item = mapEntity(entity);
        if (activeOnly && !item.active) continue;
        items.push(item);
      }

      items.sort((a, b) => a.cpt.localeCompare(b.cpt));
      return json(context, 200, { ok: true, items });
    }

    if (!principal) {
      return json(context, 401, { ok: false, error: "Authentication required." });
    }

    if (!isAdmin(principal)) {
      return json(context, 403, { ok: false, error: "Admin role required." });
    }

    const body = req.body || {};
    const now = new Date().toISOString();
    const user = principal.userDetails || principal.userId || "admin";

    if (method === "POST") {
      const cpt = normalizeCpt(body.cpt);
      const description = String(body.description || "").trim();
      const allowed = parseAllowed(body.allowed);
      const active = toBool(body.active, true);

      if (!cpt) return json(context, 400, { ok: false, error: "CPT is required." });

      const existing = await table.getEntity(PARTITION_KEY, cpt);
      if (existing) {
        return json(context, 409, { ok: false, error: "That CPT already exists." });
      }

      const entity = {
        partitionKey: PARTITION_KEY,
        rowKey: cpt,
        description,
        allowed,
        active,
        createdBy: user,
        createdAt: now,
        updatedBy: user,
        updatedAt: now
      };

      await table.upsertEntity(entity, "Replace");
      return json(context, 200, { ok: true, item: mapEntity({ PartitionKey: PARTITION_KEY, RowKey: cpt, ...entity }) });
    }

    if (method === "PUT") {
      const cpt = normalizeCpt(body.cpt);
      if (!cpt) return json(context, 400, { ok: false, error: "CPT is required." });

      const existing = await table.getEntity(PARTITION_KEY, cpt);
      if (!existing) {
        return json(context, 404, { ok: false, error: "CPT not found." });
      }

      const entity = {
        partitionKey: PARTITION_KEY,
        rowKey: cpt,
        description: typeof body.description === "undefined" ? (existing.description || "") : String(body.description || "").trim(),
        allowed: typeof body.allowed === "undefined" ? Number(existing.allowed || 0) : parseAllowed(body.allowed),
        active: typeof body.active === "undefined" ? (existing.active !== false) : toBool(body.active, true),
        createdBy: existing.createdBy || user,
        createdAt: existing.createdAt || now,
        updatedBy: user,
        updatedAt: now
      };

      await table.upsertEntity(entity, "Replace");
      return json(context, 200, { ok: true, item: mapEntity({ PartitionKey: PARTITION_KEY, RowKey: cpt, ...entity }) });
    }

    if (method === "DELETE") {
      const cpt = normalizeCpt(req.query.cpt || body.cpt);
      const hardDelete = toBool(req.query.hardDelete || body.hardDelete, false);

      if (!cpt) return json(context, 400, { ok: false, error: "CPT is required." });

      const existing = await table.getEntity(PARTITION_KEY, cpt);
      if (!existing) {
        return json(context, 404, { ok: false, error: "CPT not found." });
      }

      if (hardDelete) {
        await table.deleteEntity(PARTITION_KEY, cpt);
        return json(context, 200, { ok: true, deleted: true, cpt });
      }

      const entity = {
        partitionKey: PARTITION_KEY,
        rowKey: cpt,
        description: existing.description || "",
        allowed: Number(existing.allowed || 0),
        active: false,
        createdBy: existing.createdBy || user,
        createdAt: existing.createdAt || now,
        updatedBy: user,
        updatedAt: now
      };

      await table.upsertEntity(entity, "Replace");
      return json(context, 200, { ok: true, deleted: false, item: mapEntity({ PartitionKey: PARTITION_KEY, RowKey: cpt, ...entity }) });
    }

    return json(context, 405, { ok: false, error: "Method not allowed." });
  } catch (err) {
    return json(context, 500, { ok: false, error: err?.message || String(err) });
  }
};

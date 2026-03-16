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

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseFeeCsv(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter(line => line.trim().length);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());

  const cptIdx = headers.findIndex(h => h === "cpt");
  const descIdx = headers.findIndex(h => h === "description" || h === "desc");
  const allowedIdx = headers.findIndex(h =>
    h === "allowed" ||
    h === "allowedamount" ||
    h === "allowable" ||
    h === "fee"
  );

  if (cptIdx === -1 || allowedIdx === -1) return [];

  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const cpt = cleanCode(cols[cptIdx]);
    const desc = descIdx >= 0 ? cleanText(cols[descIdx]) : "";
    const allowed = cleanMoney(cols[allowedIdx]);

    if (!cpt) continue;
    out.push({ cpt, description: desc, allowed });
  }

  return out;
}

function mapEntity(entity) {
  return {
    cpt: entity.rowKey || "",
    description: entity.description || "",
    allowed: Number(entity.allowed || 0),
    active: entity.active !== false,
    updatedBy: entity.updatedBy || "",
    updatedAt: entity.updatedAt || ""
  };
}

module.exports = async function (context, req) {
  try {
    const user = getUserFromSwa(req);
    const table = getTableClient("FeeSchedule");
    const method = String(req.method || "GET").toUpperCase();

    await table.ensureTable();

    if (method === "GET") {
      const items = [];
      const entities = table.listEntities({
        queryOptions: {
          filter: "PartitionKey eq 'CPT'"
        }
      });

      for await (const entity of entities) {
        items.push(mapEntity(entity));
      }

      items.sort((a, b) => String(a.cpt || "").localeCompare(String(b.cpt || "")));

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

    if (method === "POST" && body.mode === "bulkImportCsv") {
      const csvText = String(body.csvText || "");
      const replaceExisting = body.replaceExisting !== false;
      const parsed = parseFeeCsv(csvText);

      if (!parsed.length) {
        return jsonResponse(context, { ok: false, error: "Could not read valid CPT rows from CSV." }, 400);
      }

      const now = new Date().toISOString();
      let existingCount = 0;

      if (replaceExisting) {
        const existing = table.listEntities({
          queryOptions: {
            filter: "PartitionKey eq 'CPT'"
          }
        });

        for await (const entity of existing) {
          existingCount++;
          await table.upsertEntity({
            partitionKey: "CPT",
            rowKey: entity.rowKey,
            description: entity.description || "",
            allowed: Number(entity.allowed || 0),
            active: false,
            updatedBy: user.userDetails || "",
            updatedAt: now
          });
        }
      }

      let imported = 0;

      for (const row of parsed) {
        await table.upsertEntity({
          partitionKey: "CPT",
          rowKey: row.cpt,
          description: row.description,
          allowed: row.allowed,
          active: true,
          updatedBy: user.userDetails || "",
          updatedAt: now
        });
        imported++;
      }

      return jsonResponse(context, {
        ok: true,
        imported,
        existingCount,
        replaceExisting
      });
    }

    if (method === "POST" || method === "PUT") {
      const cpt = cleanCode(body.cpt);
      const description = cleanText(body.description);
      const allowed = cleanMoney(body.allowed);
      const active = cleanBool(body.active, true);

      if (!cpt) {
        return jsonResponse(context, { ok: false, error: "CPT is required." }, 400);
      }

      const now = new Date().toISOString();

      await table.upsertEntity({
        partitionKey: "CPT",
        rowKey: cpt,
        description,
        allowed,
        active,
        updatedBy: user.userDetails || "",
        updatedAt: now
      });

      return jsonResponse(context, { ok: true });
    }

    if (method === "DELETE") {
      const cpt = cleanCode((req.query && req.query.cpt) || body.cpt);

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
        partitionKey: "CPT",
        rowKey: cpt,
        description: existing.description || "",
        allowed: Number(existing.allowed || 0),
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
        error: err?.message || "Unexpected server error.",
        stack: String(err?.stack || "").split("\n").slice(0, 6)
      },
      500
    );
  }
};

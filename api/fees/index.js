// api/fees/index.js
const fs = require("fs");
const path = require("path");

function parseCsvLine(line) {
  // Basic CSV parser that supports quoted fields with commas.
  // Example: 12345,"Some desc, with comma",150
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"' ) {
      // Handle escaped quotes ""
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
  return out.map(s => String(s ?? "").trim());
}

module.exports = async function (context, req) {
  try {
    // If you renamed it, change this to "feeSchedule.csv"
    const filename = "feeSchedule.sample.csv"; // or "feeSchedule.csv"

    // __dirname = /api/fees
    // go up two levels to repo root: /api/fees -> /api -> /
    const filePath = path.join(__dirname, "..", "..", filename);

    if (!fs.existsSync(filePath)) {
      context.res = {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: {
          error: "Fee schedule CSV not found",
          expectedPath: filePath,
          fix: `Place ${filename} at repo root (same level as /api).`
        }
      };
      return;
    }

    const csv = fs.readFileSync(filePath, "utf8");

    // Normalize line endings and split
    const lines = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (lines.length < 2) {
      context.res = {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: { error: "Fee schedule CSV is empty or missing data rows." }
      };
      return;
    }

    // Expect header: CPT,Description,AllowedAmount
    const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
    const cptIdx = header.indexOf("cpt");
    const descIdx = header.indexOf("description");
    const amtIdx = header.indexOf("allowedamount");

    if (cptIdx === -1 || descIdx === -1 || amtIdx === -1) {
      context.res = {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: {
          error: "CSV header mismatch",
          expected: ["CPT", "Description", "AllowedAmount"],
          got: lines[0]
        }
      };
      return;
    }

    const fees = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = parseCsvLine(line);
      const cpt = (cols[cptIdx] || "").trim();
      const desc = (cols[descIdx] || "").trim();
      const fee = parseFloat((cols[amtIdx] || "").trim());

      if (!cpt || !Number.isFinite(fee)) continue;

      fees.push({ cpt, desc, fee });
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: fees
    };
  } catch (err) {
    context.log("fees error:", err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: "Could not load fee schedule", details: String(err?.message || err) }
    };
  }
};

/* =========================
   STATE
   ========================= */
const state = {
  feeMap: new Map(),
  providers: [],
  rows: [],
  maxRows: 10,
  history: [],
  me: null
};

const $ = (id) => document.getElementById(id);

function money(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function parseNum(x) {
  const v = parseFloat(String(x ?? "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
}

function pct(n) {
  const v = Number.isFinite(n) ? n : 0;
  return `${(v * 100).toFixed(0)}%`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfWeekYmd() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function safeJson(res) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function apiGet(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return await safeJson(res);
  } catch {
    return null;
  }
}

async function apiPost(path, body) {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let text = "";
      try { text = await res.text(); } catch {}
      return { ok: false, status: res.status, errorText: text };
    }

    const json = await safeJson(res);
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, status: 0, errorText: String(err?.message || err) };
  }
}

async function loadMe() {
  const data = await apiGet("/.auth/me");
  const principal = Array.isArray(data) ? data[0] : null;
  state.me = principal || null;

  const whoAmI = $("whoAmI");
  const adminLink = $("adminLink");

  if (whoAmI) {
    if (!principal || !principal.clientPrincipal) {
      whoAmI.textContent = "Signed in";
    } else {
      const cp = principal.clientPrincipal;
      whoAmI.textContent = cp.userDetails || cp.userId || "Signed in";
    }
  }

  if (adminLink) {
    adminLink.style.display = "inline-flex";
  }
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
    const cpt = String(cols[cptIdx] || "").trim();
    const desc = descIdx >= 0 ? String(cols[descIdx] || "").trim() : "";
    const fee = parseNum(cols[allowedIdx]);

    if (!cpt || !Number.isFinite(fee)) continue;
    out.push({ cpt, desc, fee });
  }

  return out;
}

async function loadFeesFromRootCsv() {
  const candidatePaths = [
    "/feeSchedule.sample.csv",
    "./feeSchedule.sample.csv",
    "feeSchedule.sample.csv",
    "/feeSchedule.csv",
    "./feeSchedule.csv",
    "feeSchedule.csv"
  ];

  for (const path of candidatePaths) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) continue;

      const text = await res.text();
      const parsed = parseFeeCsv(text);
      if (!parsed.length) continue;

      state.feeMap.clear();
      parsed.forEach(x => {
        state.feeMap.set(String(x.cpt).trim(), {
          desc: String(x.desc || "").trim(),
          fee: parseNum(x.fee)
        });
      });

      renderFeePreview();
      populateCptDatalist();
      return true;
    } catch {}
  }

  return false;
}

function populateCptDatalist() {
  const host = $("cptList");
  if (!host) return;

  const codes = Array.from(state.feeMap.keys()).sort((a, b) => a.localeCompare(b));
  host.innerHTML = codes.map(cpt => `<option value="${escapeHtml(cpt)}"></option>`).join("");
  if ($("feeCount")) $("feeCount").textContent = String(codes.length);
}

function renderFeePreview() {
  const table = $("feePreview");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  const rows = Array.from(state.feeMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 100);

  tbody.innerHTML = rows.map(([cpt, info]) => `
    <tr>
      <td>${escapeHtml(cpt)}</td>
      <td>${escapeHtml(info.desc || "")}</td>
      <td class="num">${money(parseNum(info.fee))}</td>
    </tr>
  `).join("");
}

async function loadProviders() {
  const data = await apiGet("/api/providers");
  if (data && Array.isArray(data.providers)) {
    state.providers = data.providers.filter(Boolean);
  } else {
    state.providers = [];
  }
  mergeProviderDatalist();
}

function mergeProviderDatalist() {
  const host = $("providerList");
  if (!host) return;

  const existing = Array.from(host.querySelectorAll("option"))
    .map(o => (o.value || "").trim())
    .filter(Boolean);

  const merged = Array.from(new Set([...existing, ...state.providers]))
    .sort((a, b) => a.localeCompare(b));

  host.innerHTML = merged.map(p => `<option value="${escapeHtml(p)}"></option>`).join("");
}

function createEmptyRow() {
  return {
    id: crypto.randomUUID(),
    cpt: "",
    desc: "",
    qty: 1,
    allowed: 0
  };
}

function ensureRows(minCount = 3) {
  while (state.rows.length < minCount && state.rows.length < state.maxRows) {
    state.rows.push(createEmptyRow());
  }
}

function addRow() {
  if (state.rows.length >= state.maxRows) return;
  state.rows.push(createEmptyRow());
  renderProcedureRows();
  recalcAll();
}

function removeRow(id) {
  state.rows = state.rows.filter(r => r.id !== id);
  if (!state.rows.length) ensureRows(1);
  renderProcedureRows();
  recalcAll();
}

function getRowAdjPct(index) {
  return index === 0 ? 1 : 0.5;
}

function renderProcedureRows() {
  const host = $("procTbody");
  if (!host) return;

  host.innerHTML = "";

  state.rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const adjPct = getRowAdjPct(index);
    const adjAllowed = parseNum(row.allowed) * adjPct;
    const lineTotal = adjAllowed * Math.max(1, parseNum(row.qty));

    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>
        <input class="rowCpt" list="cptList" type="text" placeholder="CPT" value="${escapeHtml(row.cpt)}" />
      </td>
      <td>
        <input class="rowDesc" type="text" placeholder="Description" value="${escapeHtml(row.desc)}" />
      </td>
      <td class="num">
        <input class="rowQty" type="number" min="1" step="1" value="${Math.max(1, parseNum(row.qty))}" />
      </td>
      <td class="num">
        <input class="rowAllowed" type="number" min="0" step="0.01" value="${parseNum(row.allowed)}" />
      </td>
      <td class="num rowAdjPct">${(adjPct * 100).toFixed(0)}%</td>
      <td class="num rowAdjAllowed">${money(adjAllowed)}</td>
      <td class="num rowLineTotal">${money(lineTotal)}</td>
      <td>
        <button class="btn btn--ghost btnRemoveRow" type="button">Remove</button>
      </td>
    `;

    const cptInput = tr.querySelector(".rowCpt");
    const descInput = tr.querySelector(".rowDesc");
    const qtyInput = tr.querySelector(".rowQty");
    const allowedInput = tr.querySelector(".rowAllowed");
    const removeBtn = tr.querySelector(".btnRemoveRow");

    cptInput.addEventListener("change", () => {
      row.cpt = String(cptInput.value || "").trim();
      const hit = state.feeMap.get(row.cpt);
      if (hit) {
        row.desc = hit.desc || "";
        row.allowed = parseNum(hit.fee);
        descInput.value = row.desc;
        allowedInput.value = String(row.allowed);
      }
      recalcAll();
      renderProcedureRows();
    });

    cptInput.addEventListener("input", () => {
      row.cpt = String(cptInput.value || "").trim();
    });

    descInput.addEventListener("input", () => {
      row.desc = String(descInput.value || "").trim();
    });

    qtyInput.addEventListener("input", () => {
      row.qty = Math.max(1, Math.floor(parseNum(qtyInput.value)));
      qtyInput.value = String(row.qty);
      recalcAll();
      renderProcedureRows();
    });

    allowedInput.addEventListener("input", () => {
      row.allowed = Math.max(0, parseNum(allowedInput.value));
      recalcAll();
      renderProcedureRows();
    });

    removeBtn.addEventListener("click", () => removeRow(row.id));

    host.appendChild(tr);
  });

  if (state.rows.length < state.maxRows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td colspan="9">
        <button id="btnAddProcedureRow" class="btn btn--ghost" type="button">Add Procedure Row</button>
      </td>
    `;
    host.appendChild(tr);
    tr.querySelector("#btnAddProcedureRow").addEventListener("click", addRow);
  }
}

function getCalcSnapshot() {
  const dedRem = Math.max(0, parseNum($("dedRem")?.value));
  const coinsPct = Math.max(0, parseNum($("coinsPct")?.value));
  const oopRem = Math.max(0, parseNum($("oopRem")?.value));
  const copay = Math.max(0, parseNum($("copay")?.value));

  const activeRows = state.rows.filter(r => r.cpt || r.desc || parseNum(r.allowed) > 0);

  let totalAllowed = 0;
  const lineRows = activeRows.map((r, idx) => {
    const adjPct = getRowAdjPct(idx);
    const qty = Math.max(1, Math.floor(parseNum(r.qty)));
    const allowed = Math.max(0, parseNum(r.allowed));
    const adjAllowed = allowed * adjPct;
    const lineTotal = adjAllowed * qty;
    totalAllowed += lineTotal;

    return {
      ...r,
      qty,
      allowed,
      adjPct,
      adjAllowed,
      lineTotal
    };
  });

  const dedApplied = Math.min(dedRem, totalAllowed);
  const remainingAfterDed = Math.max(0, totalAllowed - dedApplied);
  const coinsAmt = remainingAfterDed * coinsPct;
  const preCapOwes = dedApplied + coinsAmt + copay;
  const estOwes = Math.min(oopRem, preCapOwes);
  const recDeposit = estOwes;

  return {
    lineRows,
    totalAllowed,
    dedRem,
    coinsPct,
    oopRem,
    copay,
    dedApplied,
    coinsAmt,
    estOwes,
    recDeposit
  };
}

function recalcAll() {
  const s = getCalcSnapshot();

  if ($("totalAllowed")) $("totalAllowed").textContent = money(s.totalAllowed);
  if ($("dedApplied")) $("dedApplied").textContent = money(s.dedApplied);
  if ($("coinsAmt")) $("coinsAmt").textContent = money(s.coinsAmt);
  if ($("copayOut")) $("copayOut").textContent = money(s.copay);
  if ($("estOwes")) $("estOwes").textContent = money(s.estOwes);
  if ($("recDeposit")) $("recDeposit").textContent = money(s.recDeposit);

  syncPrintView(s);
}

function syncPrintView(snapshot = null) {
  const s = snapshot || getCalcSnapshot();

  if ($("printEstOwes")) $("printEstOwes").textContent = money(s.estOwes);
  if ($("printRecDeposit")) $("printRecDeposit").textContent = money(s.recDeposit);
  if ($("printDate")) $("printDate").textContent = new Date().toLocaleDateString();
  if ($("printPreparedBy")) $("printPreparedBy").textContent = $("preparedBy")?.value || "";
  if ($("printPatient")) $("printPatient").textContent = $("patientName")?.value || "";
  if ($("printInsurance")) $("printInsurance").textContent = $("insurancePlan")?.value || "";
  if ($("printClinic")) $("printClinic").textContent = $("clinic")?.value || "";
  if ($("printProvider")) $("printProvider").textContent = $("provider")?.value || "";
  if ($("printTotalAllowed")) $("printTotalAllowed").textContent = money(s.totalAllowed);
  if ($("printDedApplied")) $("printDedApplied").textContent = money(s.dedApplied);
  if ($("printCoinsAmt")) $("printCoinsAmt").textContent = money(s.coinsAmt);
  if ($("printCopay")) $("printCopay").textContent = money(s.copay);
  if ($("printEstOwes2")) $("printEstOwes2").textContent = money(s.estOwes);
  if ($("printDedRem")) $("printDedRem").textContent = money(s.dedRem);
  if ($("printCoinsPct")) $("printCoinsPct").textContent = pct(s.coinsPct);
  if ($("printOopRem")) $("printOopRem").textContent = money(s.oopRem);

  const host = $("printProcTbody");
  if (host) {
    host.innerHTML = s.lineRows.map(r => `
      <tr>
        <td>${escapeHtml(r.cpt)}</td>
        <td>${escapeHtml(r.desc || "")}</td>
        <td class="num">${r.qty}</td>
        <td class="num">${money(r.adjAllowed)}</td>
        <td class="num">${money(r.lineTotal)}</td>
      </tr>
    `).join("");
  }
}

function loadLocalHistory() {
  try {
    return JSON.parse(localStorage.getItem("nes_estimate_history_v3") || "[]");
  } catch {
    return [];
  }
}

function saveLocalHistory(items) {
  localStorage.setItem("nes_estimate_history_v3", JSON.stringify(items));
}

function getHistoryFilters() {
  return {
    from: $("historyFrom")?.value || "",
    to: $("historyTo")?.value || "",
    take: Math.max(1, Math.min(200, Math.floor(parseNum($("historyTake")?.value || 50)) || 50)),
    search: ($("historySearch")?.value || "").trim().toLowerCase(),
    staff: ($("historyStaff")?.value || "").trim().toLowerCase(),
    clinic: ($("historyClinic")?.value || "").trim().toLowerCase(),
    provider: ($("historyProvider")?.value || "").trim().toLowerCase()
  };
}

function itemDateYmd(q) {
  const raw = q.quoteDate || q.savedAt;
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function applyHistoryFilters(items) {
  const f = getHistoryFilters();

  return items.filter(q => {
    const ymd = itemDateYmd(q);
    const patient = String(q.patientName || "").toLowerCase();
    const staff = String(q.preparedBy || "").toLowerCase();
    const clinic = String(q.clinic || "").toLowerCase();
    const provider = String(q.provider || q.rows?.[0]?.provider || "").toLowerCase();

    if (f.from && ymd && ymd < f.from) return false;
    if (f.to && ymd && ymd > f.to) return false;
    if (f.search && !patient.includes(f.search)) return false;
    if (f.staff && !staff.includes(f.staff)) return false;
    if (f.clinic && !clinic.includes(f.clinic)) return false;
    if (f.provider && !provider.includes(f.provider)) return false;

    return true;
  }).slice(0, f.take);
}

async function loadHistory() {
  const take = Math.max(1, Math.min(200, Math.floor(parseNum($("historyTake")?.value || 50)) || 50));
  const api = await apiGet(`/api/quotes?take=${take}`);
  if (api && Array.isArray(api.items)) {
    state.history = api.items;
    return;
  }
  state.history = loadLocalHistory();
}

function renderHistory() {
  const host = $("historyTbody");
  if (!host) return;

  const items = applyHistoryFilters(state.history);

  if (!items.length) {
    host.innerHTML = `<tr><td colspan="8">No data yet.</td></tr>`;
    return;
  }

  host.innerHTML = items.map((q, idx) => {
    const provider = q.provider || q.rows?.[0]?.provider || "";
    const total = parseNum(q.recommendedDeposit || q.recDeposit || q.summary?.recDeposit || q.total || 0);
    const estDue = parseNum(q.estimatedDue || q.estOwes || q.summary?.estOwes || q.total || 0);
    const dt = q.savedAt ? new Date(q.savedAt).toLocaleString() : "";

    return `
      <tr>
        <td>${escapeHtml(dt)}</td>
        <td>${escapeHtml(q.patientName || "")}</td>
        <td>${escapeHtml(provider)}</td>
        <td>${escapeHtml(q.clinic || "")}</td>
        <td>${escapeHtml(q.preparedBy || "")}</td>
        <td class="num">${money(total)}</td>
        <td class="num">${money(estDue)}</td>
        <td><button class="btn btn--ghost btnOpenHistory" type="button" data-idx="${idx}">Open</button></td>
      </tr>
    `;
  }).join("");

  host.querySelectorAll(".btnOpenHistory").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      const item = items[idx];
      if (item) openHistoryItem(item);
    });
  });
}

function openHistoryItem(q) {
  $("patientName").value = q.patientName || "";
  $("insurancePlan").value = q.insurancePlan || "";
  $("preparedBy").value = q.preparedBy || "";
  $("clinic").value = q.clinic || "";
  $("provider").value = q.provider || q.rows?.[0]?.provider || "";
  $("copay").value = parseNum(q.copay || 0);
  $("dedRem").value = parseNum(q.dedRem || 0);
  $("coinsPct").value = parseNum(q.coinsPct || 0.2);
  $("oopRem").value = parseNum(q.oopRem || 999999);

  const rows = Array.isArray(q.rows) ? q.rows : [];
  state.rows = rows.length
    ? rows.map(r => ({
        id: crypto.randomUUID(),
        cpt: r.cpt || "",
        desc: r.desc || "",
        qty: Math.max(1, parseNum(r.qty || 1)),
        allowed: parseNum(r.allowed ?? r.fee ?? 0)
      }))
    : [createEmptyRow(), createEmptyRow(), createEmptyRow()];

  ensureRows(3);
  renderProcedureRows();
  recalcAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function refreshHistory() {
  await loadHistory();
  renderHistory();
}

function exportHistoryCSV() {
  const items = applyHistoryFilters(state.history);
  if (!items.length) {
    alert("No history to export.");
    return;
  }

  const out = [];
  out.push([
    "SavedAt",
    "PatientName",
    "InsurancePlan",
    "PreparedBy",
    "Clinic",
    "Provider",
    "Copay",
    "DedRem",
    "CoinsPct",
    "OopRem",
    "CPT",
    "Description",
    "Qty",
    "Allowed",
    "RecommendedDeposit",
    "EstimatedDue"
  ]);

  items.forEach(q => {
    const recDeposit = parseNum(q.recommendedDeposit || q.recDeposit || q.summary?.recDeposit || q.total || 0);
    const estDue = parseNum(q.estimatedDue || q.estOwes || q.summary?.estOwes || q.total || 0);

    (q.rows || []).forEach(r => {
      out.push([
        q.savedAt || "",
        q.patientName || "",
        q.insurancePlan || "",
        q.preparedBy || "",
        q.clinic || "",
        q.provider || r.provider || "",
        parseNum(q.copay || 0),
        parseNum(q.dedRem || 0),
        parseNum(q.coinsPct || 0),
        parseNum(q.oopRem || 0),
        r.cpt || "",
        r.desc || "",
        parseNum(r.qty || 1),
        parseNum(r.allowed ?? r.fee ?? 0),
        recDeposit,
        estDue
      ]);
    });
  });

  const csv = out.map(row => row.map(csvCell).join(",")).join("\n");
  download(`quote_history_${todayYmd()}.csv`, csv, "text/csv");
}

function buildQuotePayload() {
  const snapshot = getCalcSnapshot();
  const activeRows = snapshot.lineRows;

  return {
    savedAt: new Date().toISOString(),
    quoteDate: todayYmd(),
    patientName: $("patientName")?.value.trim() || "",
    insurancePlan: $("insurancePlan")?.value.trim() || "",
    preparedBy: $("preparedBy")?.value.trim() || "",
    clinic: $("clinic")?.value.trim() || "",
    provider: $("provider")?.value.trim() || "",
    copay: Math.max(0, parseNum($("copay")?.value)),
    dedRem: Math.max(0, parseNum($("dedRem")?.value)),
    coinsPct: Math.max(0, parseNum($("coinsPct")?.value)),
    oopRem: Math.max(0, parseNum($("oopRem")?.value)),
    totalAllowed: snapshot.totalAllowed,
    dedApplied: snapshot.dedApplied,
    coinsAmt: snapshot.coinsAmt,
    estimatedDue: snapshot.estOwes,
    recommendedDeposit: snapshot.recDeposit,
    rows: activeRows.map(r => ({
      provider: $("provider")?.value.trim() || "",
      cpt: r.cpt || "",
      desc: r.desc || "",
      qty: r.qty,
      allowed: r.allowed,
      adjPct: r.adjPct,
      adjAllowed: r.adjAllowed,
      lineTotal: r.lineTotal
    }))
  };
}

async function saveQuote() {
  const payload = buildQuotePayload();

  if (!payload.patientName) {
    alert("Enter the patient name.");
    return;
  }

  if (!payload.rows.length) {
    alert("Add at least one CPT line.");
    return;
  }

  const apiSaved = await apiPost("/api/quotes", payload);
  if (apiSaved?.ok) {
    await refreshHistory();
    alert("Quote saved.");
    return;
  }

  const items = loadLocalHistory();
  items.unshift(payload);
  saveLocalHistory(items.slice(0, 200));
  state.history = items.slice(0, 200);
  renderHistory();

  console.error("Quotes API failed:", apiSaved);
  alert("Quote saved locally only. /api/quotes failed, so it will not appear in other browsers until the API storage is fixed.");
}

function clearQuote() {
  if (!confirm("Reset the current quote?")) return;

  $("patientName").value = "";
  $("insurancePlan").value = "";
  $("preparedBy").value = "";
  $("clinic").value = "";
  $("provider").value = "";
  $("copay").value = "0";
  $("dedRem").value = "0";
  $("coinsPct").value = "0.20";
  $("oopRem").value = "999999";

  state.rows = [];
  ensureRows(3);
  renderProcedureRows();
  recalcAll();
}

function setHistoryToday() {
  const ymd = todayYmd();
  $("historyFrom").value = ymd;
  $("historyTo").value = ymd;
  renderHistory();
}

function setHistoryThisWeek() {
  $("historyFrom").value = startOfWeekYmd();
  $("historyTo").value = todayYmd();
  renderHistory();
}

function csvCell(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function wireInputs() {
  [
    "patientName",
    "insurancePlan",
    "preparedBy",
    "clinic",
    "provider",
    "copay",
    "dedRem",
    "coinsPct",
    "oopRem"
  ].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      recalcAll();
      syncPrintView();
    });
  });

  $("btnSaveQuote")?.addEventListener("click", saveQuote);
  $("btnPrint")?.addEventListener("click", () => {
    syncPrintView();
    window.print();
  });
  $("btnReset")?.addEventListener("click", clearQuote);

  $("btnToday")?.addEventListener("click", setHistoryToday);
  $("btnThisWeek")?.addEventListener("click", setHistoryThisWeek);
  $("btnHistoryRefresh")?.addEventListener("click", refreshHistory);
  $("btnHistoryExport")?.addEventListener("click", exportHistoryCSV);

  [
    "historyFrom",
    "historyTo",
    "historyTake",
    "historySearch",
    "historyStaff",
    "historyClinic",
    "historyProvider"
  ].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", renderHistory);
  });

  const feeFile = $("feeFile");
  if (feeFile) {
    feeFile.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const text = await file.text();
      const parsed = parseFeeCsv(text);

      if (!parsed.length) {
        alert("Could not read CPTs from that CSV.");
        return;
      }

      state.feeMap.clear();
      parsed.forEach(x => {
        state.feeMap.set(x.cpt, { desc: x.desc, fee: x.fee });
      });

      renderFeePreview();
      populateCptDatalist();
      renderProcedureRows();
      recalcAll();
    });
  }
}

async function init() {
  await loadMe();
  await loadProviders();

  const feesOk = await loadFeesFromRootCsv();
  if (!feesOk) {
    alert("Could not load the fee schedule from the site root. You can still upload the fee CSV manually.");
  }

  state.rows = [];
  ensureRows(3);
  renderProcedureRows();
  recalcAll();

  if ($("historyTake")) $("historyTake").value = "50";
  await loadHistory();
  renderHistory();

  wireInputs();
  syncPrintView();
}

document.addEventListener("DOMContentLoaded", init);

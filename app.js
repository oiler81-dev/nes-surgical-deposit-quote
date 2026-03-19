/* =========================
   CONFIG
   ========================= */
const ORTHOTIC_BILLED_EACH = 680;
const ORTHOTIC_SELF_PAY_PAIR = 480;

const ORTHOTIC_ALLOWABLES = {
  "BCBS - REGENCE BCBS": 406.35,
  "Cigna": 154.23,
  "PROVIDENCE 3125": 360.75,
  "United Health Care 30555": 198.11,
  "Aetna": 268.12,
  "MODA": 360.75,
  "Sedgwick WC": 422.61
};

/* =========================
   STATE
   ========================= */
const state = {
  feeMap: new Map(),
  providers: [],
  rows: [],
  maxRows: 10,
  history: [],
  me: null,
  estimateType: "surgical",
  historyLoaded: false
};

const $ = (id) => document.getElementById(id);

/* =========================
   HELPERS
   ========================= */
function money(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function parseNum(x) {
  const v = parseFloat(String(x ?? "").replace(/,/g, "").trim());
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

function safeText(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function getEstimateType() {
  const checked = document.querySelector('input[name="estimateType"]:checked');
  return checked?.value === "orthotics" ? "orthotics" : "surgical";
}

function getOrthoticBasis() {
  return $("orthoticBasis")?.value === "selfPay" ? "selfPay" : "insurance";
}

function isOrthotics() {
  return state.estimateType === "orthotics";
}

function isOrthoticsSelfPay() {
  return isOrthotics() && getOrthoticBasis() === "selfPay";
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

    const data = await safeJson(res);

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        errorText: data?.error || `HTTP ${res.status}`
      };
    }

    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorText: String(err?.message || err)
    };
  }
}

/* =========================
   AUTH / PROFILE
   ========================= */
async function loadMe() {
  const data = await apiGet("/.auth/me");
  const principal = Array.isArray(data) ? data[0]?.clientPrincipal : data?.clientPrincipal || null;
  state.me = principal || null;

  const whoAmI = $("whoAmI");
  if (whoAmI) {
    whoAmI.textContent = principal?.userDetails || "Signed in";
  }

  const adminLink = $("adminLink");
  if (adminLink) {
    adminLink.style.display = "inline-flex";
  }
}

/* =========================
   CSV PARSING
   ========================= */
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

/* =========================
   FEES
   ========================= */
async function loadFeesFromApi() {
  try {
    const data = await apiGet("/api/fees");
    if (!data || !data.ok || !Array.isArray(data.items) || !data.items.length) {
      return false;
    }

    state.feeMap.clear();

    data.items.forEach(item => {
      const cpt = String(item.cpt || "").trim();
      if (!cpt) return;
      if (item.active === false) return;

      state.feeMap.set(cpt, {
        desc: safeText(item.description),
        fee: parseNum(item.allowed)
      });
    });

    renderFeePreview();
    populateCptDatalist();
    return true;
  } catch {
    return false;
  }
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

/* =========================
   PROVIDERS
   ========================= */
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

/* =========================
   ORTHOTICS
   ========================= */
function populateOrthoticPayers() {
  const select = $("orthoticPayer");
  if (!select) return;

  const payers = Object.keys(ORTHOTIC_ALLOWABLES).sort((a, b) => a.localeCompare(b));
  select.innerHTML =
    `<option value="">Select payer</option>` +
    payers.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
}

function applyOrthoticPayerSelection() {
  const payer = $("orthoticPayer")?.value || "";
  const allowable = ORTHOTIC_ALLOWABLES[payer];
  if ($("orthoticAllowableEach") && Number.isFinite(allowable)) {
    $("orthoticAllowableEach").value = String(allowable);
  }
  recalcAll();
}

function updateOrthoticBasisUI() {
  const basis = getOrthoticBasis();

  document.querySelectorAll(".orthotic-insurance-only").forEach(el => {
    el.classList.toggle("hiddenBlock", basis !== "insurance");
  });

  document.querySelectorAll(".orthotic-selfpay-only").forEach(el => {
    el.classList.toggle("hiddenBlock", basis !== "selfPay");
  });

  const selfPayInput = $("orthoticSelfPayEach");
  if (selfPayInput) {
    if (basis === "selfPay") {
      selfPayInput.value = String(ORTHOTIC_SELF_PAY_PAIR);
      selfPayInput.disabled = true;
      selfPayInput.readOnly = true;
    } else {
      selfPayInput.disabled = false;
      selfPayInput.readOnly = false;
    }
  }

  const totalAllowedLabel = $("totalAllowedLabel");
  const estOwesLabel = $("estOwesLabel");
  const printTotalAllowedLabel = $("printTotalAllowedLabel");
  const printEstOwesLabel = $("printEstOwesLabel");

  if (basis === "selfPay") {
    if (totalAllowedLabel) totalAllowedLabel.textContent = "Self-Pay Total";
    if (estOwesLabel) estOwesLabel.textContent = "Estimated Amount Due";
    if (printTotalAllowedLabel) printTotalAllowedLabel.textContent = "Self-Pay Total";
    if (printEstOwesLabel) printEstOwesLabel.textContent = "Estimated Amount Due";
  } else {
    if (totalAllowedLabel) totalAllowedLabel.textContent = "Total Allowed";
    if (estOwesLabel) estOwesLabel.textContent = "Estimated Amount Due (OOP capped)";
    if (printTotalAllowedLabel) printTotalAllowedLabel.textContent = "Total Allowed";
    if (printEstOwesLabel) printEstOwesLabel.textContent = "Estimated Amount Due (OOP capped)";
  }

  renderOrthoticsPreview();
  syncPrintView();
}

function getOrthoticLines() {
  const basis = getOrthoticBasis();

  if (basis === "selfPay") {
    const pairTotal = ORTHOTIC_SELF_PAY_PAIR;
    const each = pairTotal / 2;

    if ($("orthoticSelfPayEach")) {
      $("orthoticSelfPayEach").value = String(ORTHOTIC_SELF_PAY_PAIR);
    }

    return [
      {
        code: "L3000",
        modifier: "RT",
        desc: "Foot insert, removable, molded to patient model, longitudinal/metatarsal support, each",
        billed: ORTHOTIC_BILLED_EACH,
        allowed: each,
        lineTotal: each
      },
      {
        code: "L3000",
        modifier: "LT",
        desc: "Foot insert, removable, molded to patient model, longitudinal/metatarsal support, each",
        billed: ORTHOTIC_BILLED_EACH,
        allowed: each,
        lineTotal: each
      }
    ];
  }

  const allowableEach = parseNum($("orthoticAllowableEach")?.value || 0);

  return [
    {
      code: "L3000",
      modifier: "RT",
      desc: "Foot insert, removable, molded to patient model, longitudinal/metatarsal support, each",
      billed: ORTHOTIC_BILLED_EACH,
      allowed: allowableEach,
      lineTotal: allowableEach
    },
    {
      code: "L3000",
      modifier: "LT",
      desc: "Foot insert, removable, molded to patient model, longitudinal/metatarsal support, each",
      billed: ORTHOTIC_BILLED_EACH,
      allowed: allowableEach,
      lineTotal: allowableEach
    }
  ];
}

function renderOrthoticsPreview() {
  const host = $("orthoticsTbody");
  if (!host) return;

  const lines = getOrthoticLines();
  host.innerHTML = lines.map((line, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(line.code)}</td>
      <td>${escapeHtml(line.modifier)}</td>
      <td>${escapeHtml(line.desc)}</td>
      <td class="num">${money(line.billed)}</td>
      <td class="num">${money(line.allowed)}</td>
      <td class="num">${money(line.lineTotal)}</td>
    </tr>
  `).join("");
}

/* =========================
   PROCEDURES
   ========================= */
function createEmptyRow() {
  return {
    id: makeId(),
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

function getActiveProcedureRows() {
  return state.rows.filter(r => safeText(r.cpt) || safeText(r.desc) || parseNum(r.allowed) > 0);
}

function renderProcedureRows() {
  const host = $("procTbody");
  if (!host) return;

  host.innerHTML = "";

  state.rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const adjPct = getRowAdjPct(index);
    const adjAllowed = parseNum(row.allowed) * adjPct;
    const qty = Math.max(1, parseInt(row.qty || 1, 10) || 1);
    const lineTotal = adjAllowed * qty;

    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>
        <input class="rowCpt input" list="cptList" type="text" placeholder="CPT" value="${escapeHtml(row.cpt)}" />
      </td>
      <td>
        <input class="rowDesc input" type="text" placeholder="Description" value="${escapeHtml(row.desc)}" />
      </td>
      <td class="num">
        <input class="rowQty input" type="number" min="1" step="1" value="${qty}" />
      </td>
      <td class="num">
        <input class="rowAllowed input" type="number" min="0" step="0.01" value="${parseNum(row.allowed)}" />
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
      row.cpt = safeText(cptInput.value).toUpperCase();
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
      row.cpt = safeText(cptInput.value).toUpperCase();
    });

    descInput.addEventListener("input", () => {
      row.desc = safeText(descInput.value);
    });

    qtyInput.addEventListener("input", () => {
      row.qty = Math.max(1, Math.floor(parseNum(qtyInput.value) || 1));
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

  const addTr = document.createElement("tr");
  addTr.innerHTML = `
    <td colspan="9">
      <button id="btnAddRow" class="btn btn--ghost" type="button">Add Procedure Row</button>
    </td>
  `;
  host.appendChild(addTr);

  $("btnAddRow")?.addEventListener("click", addRow);
}

/* =========================
   MODE SWITCHING
   ========================= */
function setEstimateType(type) {
  state.estimateType = type === "orthotics" ? "orthotics" : "surgical";

  const surgicalOnly = document.querySelectorAll(".surgical-only");
  const orthoticsOnly = document.querySelectorAll(".orthotics-only");
  const modePill = $("modePill");
  const quoteInputsTitle = $("quoteInputsTitle");
  const printSummaryTitle = $("printSummaryTitle");
  const printTitle = $("printTitle");
  const printSubtitle = $("printSubtitle");
  const printTopRight = $("printTopRight");
  const printDisclaimer = $("printDisclaimer");
  const appTitle = $("appTitle");
  const appSubtitle = $("appSubtitle");

  surgicalOnly.forEach(el => el.classList.toggle("hiddenBlock", state.estimateType !== "surgical"));
  orthoticsOnly.forEach(el => el.classList.toggle("hiddenBlock", state.estimateType !== "orthotics"));

  if (modePill) {
    modePill.textContent = state.estimateType === "orthotics"
      ? "Mode: Orthotics"
      : "Mode: Surgical / Procedure";
  }

  if (quoteInputsTitle) {
    quoteInputsTitle.textContent = "3) Quote Inputs";
  }

  if (printSummaryTitle) {
    printSummaryTitle.textContent = state.estimateType === "orthotics"
      ? "Orthotics Summary"
      : "Procedure Summary";
  }

  if (printTitle) {
    printTitle.textContent = state.estimateType === "orthotics"
      ? "NES Orthotics Estimate"
      : "NES Surgical Deposit Estimate";
  }

  if (printSubtitle) {
    printSubtitle.textContent = "Estimate only. Final responsibility may change after insurance adjudication.";
  }

  if (printTopRight) {
    printTopRight.textContent = state.estimateType === "orthotics"
      ? "NES Orthotics Estimate"
      : "NES Estimate Quote";
  }

  if (printDisclaimer) {
    printDisclaimer.textContent = state.estimateType === "orthotics"
      ? "This is an estimate only for orthotics charges. Final responsibility may be different after claim processing."
      : "This is an estimate only for physician charges. Anesthesia and facility charges will be billed separately. Final responsibility may be different after claim processing.";
  }

  if (appTitle) appTitle.textContent = "NES Estimate Tool";
  if (appSubtitle) {
    appSubtitle.textContent = state.estimateType === "orthotics"
      ? "Orthotics"
      : "Surgical / Procedure and Orthotics";
  }

  updateOrthoticBasisUI();
  recalcAll();
  syncPrintView();
}

function wireEstimateType() {
  document.querySelectorAll('input[name="estimateType"]').forEach(radio => {
    radio.addEventListener("change", () => {
      setEstimateType(getEstimateType());
    });
  });
}

/* =========================
   CALCULATIONS
   ========================= */
function getInputValues() {
  return {
    patientName: safeText($("patientName")?.value),
    insurancePlan: safeText($("insurancePlan")?.value),
    preparedBy: safeText($("preparedBy")?.value),
    clinic: safeText($("clinic")?.value),
    provider: safeText($("provider")?.value),
    copay: Math.max(0, parseNum($("copay")?.value)),
    dedRem: Math.max(0, parseNum($("dedRem")?.value)),
    coinsPct: Math.max(0, parseNum($("coinsPct")?.value)),
    oopRem: Math.max(0, parseNum($("oopRem")?.value))
  };
}

function calculateSurgicalTotals() {
  const inputs = getInputValues();
  const activeRows = getActiveProcedureRows();

  let totalAllowed = 0;

  activeRows.forEach((row, index) => {
    const qty = Math.max(1, parseInt(row.qty || 1, 10) || 1);
    const allowed = Math.max(0, parseNum(row.allowed));
    const adjPct = getRowAdjPct(index);
    const adjAllowed = allowed * adjPct;
    totalAllowed += adjAllowed * qty;
  });

  const dedApplied = Math.min(inputs.dedRem, totalAllowed);
  const remainingAfterDed = Math.max(0, totalAllowed - dedApplied);
  const coinsAmt = remainingAfterDed * inputs.coinsPct;
  const rawPatient = dedApplied + coinsAmt + inputs.copay;
  const estOwes = Math.min(rawPatient, inputs.oopRem > 0 ? inputs.oopRem : rawPatient);
  const insResp = Math.max(0, totalAllowed - estOwes);
  const recDeposit = estOwes;

  return {
    totalAllowed,
    dedApplied,
    coinsAmt,
    copay: inputs.copay,
    estOwes,
    insResp,
    recDeposit
  };
}

function calculateOrthoticsTotals() {
  const inputs = getInputValues();
  const lines = getOrthoticLines();
  const totalAllowed = lines.reduce((sum, x) => sum + parseNum(x.lineTotal), 0);

  if (isOrthoticsSelfPay()) {
    const estOwes = ORTHOTIC_SELF_PAY_PAIR;
    return {
      totalAllowed: ORTHOTIC_SELF_PAY_PAIR,
      dedApplied: 0,
      coinsAmt: 0,
      copay: 0,
      estOwes,
      insResp: 0,
      recDeposit: estOwes
    };
  }

  const dedApplied = Math.min(inputs.dedRem, totalAllowed);
  const remainingAfterDed = Math.max(0, totalAllowed - dedApplied);
  const coinsAmt = remainingAfterDed * inputs.coinsPct;
  const rawPatient = dedApplied + coinsAmt + inputs.copay;
  const estOwes = Math.min(rawPatient, inputs.oopRem > 0 ? inputs.oopRem : rawPatient);
  const insResp = Math.max(0, totalAllowed - estOwes);
  const recDeposit = estOwes;

  return {
    totalAllowed,
    dedApplied,
    coinsAmt,
    copay: inputs.copay,
    estOwes,
    insResp,
    recDeposit
  };
}

function recalcAll() {
  if (isOrthoticsSelfPay() && $("orthoticSelfPayEach")) {
    $("orthoticSelfPayEach").value = String(ORTHOTIC_SELF_PAY_PAIR);
  }

  const totals = isOrthotics() ? calculateOrthoticsTotals() : calculateSurgicalTotals();

  if ($("totalAllowed")) $("totalAllowed").textContent = money(totals.totalAllowed);
  if ($("dedApplied")) $("dedApplied").textContent = money(totals.dedApplied);
  if ($("coinsAmt")) $("coinsAmt").textContent = money(totals.coinsAmt);
  if ($("copayOut")) $("copayOut").textContent = money(totals.copay);
  if ($("estOwes")) $("estOwes").textContent = money(totals.estOwes);
  if ($("insResp")) $("insResp").textContent = money(totals.insResp);
  if ($("recDeposit")) $("recDeposit").textContent = money(totals.recDeposit);

  syncPrintView();
  return totals;
}

/* =========================
   PRINT
   ========================= */
function getPrintableLines() {
  if (isOrthotics()) {
    return getOrthoticLines().map(line => ({
      code: line.code,
      modifier: line.modifier,
      desc: line.desc,
      qty: 1,
      billed: line.billed,
      adjAllowed: line.allowed,
      lineTotal: line.lineTotal
    }));
  }

  return getActiveProcedureRows().map((row, index) => {
    const qty = Math.max(1, parseInt(row.qty || 1, 10) || 1);
    const allowed = Math.max(0, parseNum(row.allowed));
    const adjPct = getRowAdjPct(index);
    const adjAllowed = allowed * adjPct;
    return {
      code: row.cpt,
      modifier: "",
      desc: row.desc,
      qty,
      billed: allowed,
      adjAllowed,
      lineTotal: adjAllowed * qty
    };
  });
}

function syncPrintView() {
  const totals = isOrthotics() ? calculateOrthoticsTotals() : calculateSurgicalTotals();
  const inputs = getInputValues();
  const lines = getPrintableLines();

  if ($("printDate")) $("printDate").textContent = new Date().toLocaleDateString();
  if ($("printPreparedBy")) $("printPreparedBy").textContent = inputs.preparedBy;
  if ($("printPatient")) $("printPatient").textContent = inputs.patientName;
  if ($("printInsurance")) $("printInsurance").textContent = inputs.insurancePlan;
  if ($("printClinic")) $("printClinic").textContent = inputs.clinic;
  if ($("printProvider")) $("printProvider").textContent = inputs.provider;

  if ($("printTotalAllowed")) $("printTotalAllowed").textContent = money(totals.totalAllowed);
  if ($("printDedApplied")) $("printDedApplied").textContent = money(totals.dedApplied);
  if ($("printCoinsAmt")) $("printCoinsAmt").textContent = money(totals.coinsAmt);
  if ($("printCopay")) $("printCopay").textContent = money(totals.copay);
  if ($("printInsResp")) $("printInsResp").textContent = money(totals.insResp);
  if ($("printEstOwes")) $("printEstOwes").textContent = money(totals.estOwes);
  if ($("printEstOwes2")) $("printEstOwes2").textContent = money(totals.estOwes);
  if ($("printRecDeposit")) $("printRecDeposit").textContent = money(totals.recDeposit);

  if ($("printDedRem")) $("printDedRem").textContent = money(inputs.dedRem);
  if ($("printCoinsPct")) $("printCoinsPct").textContent = pct(inputs.coinsPct);
  if ($("printOopRem")) $("printOopRem").textContent = money(inputs.oopRem);
  if ($("printEstimateType")) {
    $("printEstimateType").textContent = isOrthotics() ? "Orthotics" : "Surgical / Procedure";
  }

  const tbody = $("printProcTbody");
  if (tbody) {
    tbody.innerHTML = lines.map(line => `
      <tr>
        <td>${escapeHtml(line.code || "")}</td>
        <td>${escapeHtml(line.modifier || "")}</td>
        <td>${escapeHtml(line.desc || "")}</td>
        <td class="num">${escapeHtml(String(line.qty || 1))}</td>
        <td class="num">${money(parseNum(line.billed))}</td>
        <td class="num">${money(parseNum(line.adjAllowed))}</td>
        <td class="num">${money(parseNum(line.lineTotal))}</td>
      </tr>
    `).join("");
  }
}

/* =========================
   HISTORY / QUOTES
   ========================= */
function buildQuotePayload() {
  const inputs = getInputValues();
  const totals = isOrthotics() ? calculateOrthoticsTotals() : calculateSurgicalTotals();

  const payload = {
    estimateType: state.estimateType,
    patientName: inputs.patientName,
    insurancePlan: inputs.insurancePlan,
    preparedBy: inputs.preparedBy,
    clinic: inputs.clinic,
    provider: inputs.provider,
    copay: inputs.copay,
    dedRem: inputs.dedRem,
    coinsPct: inputs.coinsPct,
    oopRem: inputs.oopRem,
    totalAllowed: totals.totalAllowed,
    dedApplied: totals.dedApplied,
    coinsAmt: totals.coinsAmt,
    estOwes: totals.estOwes,
    insResp: totals.insResp,
    recDeposit: totals.recDeposit,
    quoteDate: new Date().toISOString()
  };

  if (isOrthotics()) {
    payload.orthotics = {
      basis: getOrthoticBasis(),
      payer: safeText($("orthoticPayer")?.value),
      allowableEach: parseNum($("orthoticAllowableEach")?.value),
      selfPayPair: ORTHOTIC_SELF_PAY_PAIR,
      lines: getOrthoticLines()
    };
    payload.lines = getOrthoticLines();
  } else {
    payload.lines = getActiveProcedureRows().map((row, index) => {
      const qty = Math.max(1, parseInt(row.qty || 1, 10) || 1);
      const allowed = Math.max(0, parseNum(row.allowed));
      const adjPct = getRowAdjPct(index);
      const adjAllowed = allowed * adjPct;
      return {
        cpt: row.cpt,
        description: row.desc,
        qty,
        allowed,
        adjPct,
        adjAllowed,
        lineTotal: adjAllowed * qty
      };
    });
  }

  return payload;
}

async function saveQuote() {
  const payload = buildQuotePayload();
  const result = await apiPost("/api/quote", payload);

  if (!result.ok) {
    alert(`Could not save quote. ${result.errorText || ""}`.trim());
    return;
  }

  await loadHistory();
  renderHistory();
  alert("Quote saved.");
}

async function loadHistory() {
  const data = await apiGet("/api/quotes");
  state.history = Array.isArray(data?.items) ? data.items : [];
  state.historyLoaded = true;
}

function getHistoryFilters() {
  return {
    from: safeText($("historyFrom")?.value),
    to: safeText($("historyTo")?.value),
    take: Math.max(1, Math.min(200, parseInt($("historyTake")?.value || "50", 10) || 50)),
    type: safeText($("historyType")?.value),
    search: safeText($("historySearch")?.value).toLowerCase(),
    staff: safeText($("historyStaff")?.value).toLowerCase(),
    clinic: safeText($("historyClinic")?.value).toLowerCase(),
    provider: safeText($("historyProvider")?.value).toLowerCase()
  };
}

function renderHistory() {
  const tbody = $("historyTbody");
  if (!tbody) return;

  if (!state.historyLoaded) {
    tbody.innerHTML = `<tr><td colspan="9">Loading...</td></tr>`;
    return;
  }

  const f = getHistoryFilters();
  let items = [...state.history];

  if (f.from) {
    const fromTs = new Date(`${f.from}T00:00:00`).getTime();
    items = items.filter(x => new Date(x.quoteDate || x.createdAt || x.timestamp || 0).getTime() >= fromTs);
  }

  if (f.to) {
    const toTs = new Date(`${f.to}T23:59:59`).getTime();
    items = items.filter(x => new Date(x.quoteDate || x.createdAt || x.timestamp || 0).getTime() <= toTs);
  }

  if (f.type) {
    items = items.filter(x => String(x.estimateType || "").toLowerCase() === f.type.toLowerCase());
  }

  if (f.search) {
    items = items.filter(x => String(x.patientName || "").toLowerCase().includes(f.search));
  }

  if (f.staff) {
    items = items.filter(x =>
      String(x.preparedBy || x.userDetails || x.createdBy || "").toLowerCase().includes(f.staff)
    );
  }

  if (f.clinic) {
    items = items.filter(x => String(x.clinic || "").toLowerCase().includes(f.clinic));
  }

  if (f.provider) {
    items = items.filter(x => String(x.provider || "").toLowerCase().includes(f.provider));
  }

  items.sort((a, b) =>
    new Date(b.quoteDate || b.createdAt || b.timestamp || 0).getTime() -
    new Date(a.quoteDate || a.createdAt || a.timestamp || 0).getTime()
  );

  items = items.slice(0, f.take);

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="9">No data yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const dt = new Date(item.quoteDate || item.createdAt || item.timestamp || Date.now());
    return `
      <tr>
        <td>${escapeHtml(dt.toLocaleString())}</td>
        <td>${escapeHtml(item.estimateType === "orthotics" ? "Orthotics" : "Surgical / Procedure")}</td>
        <td>${escapeHtml(item.patientName || "")}</td>
        <td>${escapeHtml(item.provider || "")}</td>
        <td>${escapeHtml(item.clinic || "")}</td>
        <td>${escapeHtml(item.preparedBy || item.userDetails || item.createdBy || "")}</td>
        <td class="num">${money(parseNum(item.recDeposit))}</td>
        <td class="num">${money(parseNum(item.estOwes))}</td>
        <td><button class="btn btn--ghost btnOpenHistory" type="button" data-id="${escapeHtml(String(item.RowKey || item.id || item.quoteId || ""))}">Open</button></td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btnOpenHistory").forEach((btn, idx) => {
    btn.addEventListener("click", () => openHistoryItem(items[idx]));
  });
}

function openHistoryItem(item) {
  if (!item) return;

  const estimateType = item.estimateType === "orthotics" ? "orthotics" : "surgical";
  const radio = document.querySelector(`input[name="estimateType"][value="${estimateType}"]`);
  if (radio) radio.checked = true;
  setEstimateType(estimateType);

  $("patientName").value = item.patientName || "";
  $("insurancePlan").value = item.insurancePlan || "";
  $("preparedBy").value = item.preparedBy || item.userDetails || item.createdBy || "";
  $("clinic").value = item.clinic || "";
  $("provider").value = item.provider || "";
  $("copay").value = parseNum(item.copay || 0);
  $("dedRem").value = parseNum(item.dedRem || 0);
  $("coinsPct").value = parseNum(item.coinsPct || 0);
  $("oopRem").value = parseNum(item.oopRem || 0);

  if (estimateType === "orthotics") {
    const orth = item.orthotics || {};
    $("orthoticBasis").value = orth.basis === "selfPay" ? "selfPay" : "insurance";
    updateOrthoticBasisUI();
    $("orthoticPayer").value = orth.payer || "";
    if (orth.allowableEach != null) $("orthoticAllowableEach").value = parseNum(orth.allowableEach);
    $("orthoticSelfPayEach").value = String(ORTHOTIC_SELF_PAY_PAIR);
    renderOrthoticsPreview();
  } else {
    const lines = Array.isArray(item.lines) ? item.lines : [];
    state.rows = lines.map(line => ({
      id: makeId(),
      cpt: safeText(line.cpt),
      desc: safeText(line.description),
      qty: Math.max(1, parseInt(line.qty || 1, 10) || 1),
      allowed: parseNum(line.allowed)
    }));
    ensureRows(3);
    renderProcedureRows();
  }

  recalcAll();
  syncPrintView();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exportHistoryCSV() {
  const rows = [["Date/Time", "Type", "Patient", "Provider", "Clinic", "Staff", "Recommended Deposit", "Estimated Due"]];
  const tbody = $("historyTbody");
  if (!tbody) return;

  const items = [...tbody.querySelectorAll("tr")].map(tr =>
    [...tr.querySelectorAll("td")].slice(0, 8).map(td => td.textContent.trim())
  );

  items.forEach(row => {
    if (row.length) rows.push(row);
  });

  const csv = rows.map(row =>
    row.map(v => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    }).join(",")
  ).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "quote-history.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function refreshHistory() {
  loadHistory().then(renderHistory);
}

function setHistoryToday() {
  if ($("historyFrom")) $("historyFrom").value = todayYmd();
  if ($("historyTo")) $("historyTo").value = todayYmd();
  renderHistory();
}

function setHistoryThisWeek() {
  if ($("historyFrom")) $("historyFrom").value = startOfWeekYmd();
  if ($("historyTo")) $("historyTo").value = todayYmd();
  renderHistory();
}

/* =========================
   RESET
   ========================= */
function clearQuote() {
  $("patientName").value = "";
  $("insurancePlan").value = "";
  $("preparedBy").value = "";
  $("clinic").value = "";
  $("provider").value = "";
  $("copay").value = "0";
  $("dedRem").value = "0";
  $("coinsPct").value = "0.20";
  $("oopRem").value = "999999";

  $("orthoticBasis").value = "insurance";
  $("orthoticPayer").value = "";
  $("orthoticAllowableEach").value = "0";
  $("orthoticSelfPayEach").value = String(ORTHOTIC_SELF_PAY_PAIR);

  state.rows = [];
  ensureRows(3);
  renderProcedureRows();
  renderOrthoticsPreview();

  const surgicalRadio = document.querySelector('input[name="estimateType"][value="surgical"]');
  if (surgicalRadio) surgicalRadio.checked = true;

  setEstimateType("surgical");
  recalcAll();
  syncPrintView();
}

/* =========================
   EVENTS
   ========================= */
function wireOrthoticsInputs() {
  $("orthoticBasis")?.addEventListener("change", () => {
    updateOrthoticBasisUI();
    recalcAll();
  });

  $("orthoticPayer")?.addEventListener("change", applyOrthoticPayerSelection);

  $("orthoticAllowableEach")?.addEventListener("input", () => {
    recalcAll();
  });

  $("orthoticSelfPayEach")?.addEventListener("input", () => {
    if (isOrthoticsSelfPay()) {
      $("orthoticSelfPayEach").value = String(ORTHOTIC_SELF_PAY_PAIR);
    }
    recalcAll();
  });
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
    "historyType",
    "historySearch",
    "historyStaff",
    "historyClinic",
    "historyProvider"
  ].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", renderHistory);
    el.addEventListener("change", renderHistory);
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
        state.feeMap.set(String(x.cpt || "").trim(), {
          desc: String(x.desc || "").trim(),
          fee: parseNum(x.fee)
        });
      });

      renderFeePreview();
      populateCptDatalist();
      renderProcedureRows();
      recalcAll();
    });
  }

  wireEstimateType();
  wireOrthoticsInputs();
}

/* =========================
   INIT
   ========================= */
async function init() {
  await loadMe();
  await loadProviders();
  populateOrthoticPayers();

  let feesOk = await loadFeesFromApi();

  if (!feesOk) {
    feesOk = await loadFeesFromRootCsv();
  }

  if (!feesOk) {
    alert("Could not load the fee schedule from /api/fees or the site root CSV. You can still upload the fee CSV manually.");
  }

  state.rows = [];
  ensureRows(3);
  renderProcedureRows();
  renderOrthoticsPreview();

  if ($("historyTake")) $("historyTake").value = "50";

  await loadHistory();
  renderHistory();

  wireInputs();

  const surgicalRadio = document.querySelector('input[name="estimateType"][value="surgical"]');
  if (surgicalRadio) surgicalRadio.checked = true;

  setEstimateType("surgical");
  syncPrintView();
  recalcAll();
}

document.addEventListener("DOMContentLoaded", init);

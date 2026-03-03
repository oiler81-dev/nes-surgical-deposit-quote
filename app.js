// app.js (FIXED: chooses the correct Allowed column by scoring candidates)
// - Robust CSV parsing (quoted commas)
// - Normalizes CPTs (27685.0 -> 27685)
// - Parses money with $, commas, parentheses
// - Auto-selects the "Allowed" column that actually has numeric values
// - Warn banner if fee schedule missing or CPT not found

const state = {
  feeMap: new Map(),        // CPT -> { desc, allowed }
  rows: [],
  maxRows: 10
};

const $ = (id) => document.getElementById(id);

function money(n){
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function pct(n){
  const v = Number.isFinite(n) ? n : 0;
  return (v * 100).toFixed(0) + "%";
}

function numVal(el){
  const v = parseFloat(String(el.value || "").replace(/,/g,""));
  return Number.isFinite(v) ? v : 0;
}

function normalizeHeader(h){
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]/g, "");
}

function normalizeCpt(raw){
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/^'+|'+$/g, "");
  s = s.replace(/"/g, "");
  if (/^\d+(\.\d+)?$/.test(s)) s = String(parseInt(s, 10));
  return s.trim();
}

function parseMoney(raw){
  // Handles: "$1,234.56", "1,234.56", "(1,234.56)", "1234.56", "—", ""
  let s = String(raw ?? "").trim();
  if (!s) return 0;

  // Normalize weird spaces (non-breaking, narrow no-break, etc.)
  s = s.replace(/[\u00A0\u202F\u2007]/g, " ").trim();

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")){
    negative = true;
    s = s.slice(1, -1);
  }

  // Strip currency symbols and separators
  s = s.replace(/[$,]/g, "");
  s = s.replace(/\s/g, "");

  // If it's something like "—" or "N/A"
  if (!/[0-9]/.test(s)) return 0;

  const v = parseFloat(s);
  if (!Number.isFinite(v)) return 0;
  return negative ? -v : v;
}

function escapeHtml(s){
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function splitCSVLine(line){
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++){
    const ch = line[i];

    if (ch === '"'){
      if (inQuotes && line[i + 1] === '"'){
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes){
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map(x => x.trim());
}

function ensureBanner(){
  let el = document.getElementById("banner");
  if (el) return el;

  const card = document.querySelector(".card"); // Fee Schedule card
  el = document.createElement("div");
  el.id = "banner";
  el.style.marginTop = "12px";
  el.style.padding = "10px 12px";
  el.style.borderRadius = "12px";
  el.style.border = "1px solid rgba(16,56,96,.20)";
  el.style.background = "rgba(16,56,96,.05)";
  el.style.color = "#103860";
  el.style.fontWeight = "700";
  el.style.display = "none";
  card.appendChild(el);
  return el;
}

function showBanner(msg, type="info"){
  const el = ensureBanner();
  el.textContent = msg;
  el.style.display = "block";

  if (type === "warn"){
    el.style.border = "1px solid rgba(180,83,9,.35)";
    el.style.background = "rgba(180,83,9,.08)";
    el.style.color = "#7c2d12";
  } else {
    el.style.border = "1px solid rgba(16,56,96,.20)";
    el.style.background = "rgba(16,56,96,.05)";
    el.style.color = "#103860";
  }
}

function hideBanner(){
  const el = document.getElementById("banner");
  if (el) el.style.display = "none";
}

function pickBestAllowedIndex(headersNorm, rows){
  // Find all columns whose header looks like "allowed"
  const candidates = [];
  for (let i = 0; i < headersNorm.length; i++){
    const h = headersNorm[i];
    if (
      h.includes("allowed") ||
      h.includes("allowable") ||
      h.includes("allowedamt") ||
      h.includes("allowedamount") ||
      h.includes("allowedfee")
    ){
      candidates.push(i);
    }
  }

  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates[0];

  // Score each candidate by how many numeric values it has (and total magnitude)
  const sampleN = Math.min(rows.length, 40);
  let bestIdx = candidates[0];
  let bestScore = -1;

  for (const idx of candidates){
    let numericCount = 0;
    let nonEmptyCount = 0;
    let magnitude = 0;

    for (let r = 0; r < sampleN; r++){
      const val = rows[r][idx];
      const s = String(val ?? "").trim();
      if (s) nonEmptyCount++;

      const m = parseMoney(val);
      if (Number.isFinite(m) && m !== 0){
        numericCount++;
        magnitude += Math.abs(m);
      }
    }

    // Weighted score: numeric count most important, then non-empty, then magnitude
    const score = (numericCount * 1000000) + (nonEmptyCount * 1000) + magnitude;

    if (score > bestScore){
      bestScore = score;
      bestIdx = idx;
    }
  }

  return bestIdx;
}

function parseCSV(text){
  const lines = text
    .replace(/\uFEFF/g, "")
    .split(/\r?\n/)
    .filter(l => l.trim().length > 0);

  if (lines.length < 2) return [];

  const headersRaw = splitCSVLine(lines[0]);
  const headersNorm = headersRaw.map(normalizeHeader);

  const rows = [];
  for (let i = 1; i < lines.length; i++){
    rows.push(splitCSVLine(lines[i]));
  }

  const findHeaderIndex = (candidates) => {
    for (let i = 0; i < headersNorm.length; i++){
      if (candidates.includes(headersNorm[i])) return i;
    }
    return -1;
  };

  const idxCpt = findHeaderIndex(["cpt","cptcode","procedurecode","code"]);
  const idxDesc = findHeaderIndex(["description","cptdescription","procedurename","name"]);

  // Instead of a single allowed index, pick best allowed-like column
  const idxAllowed = pickBestAllowedIndex(headersNorm, rows);

  if (idxCpt === -1 || idxAllowed === -1){
    throw new Error(
      "CSV must include CPT and Allowed columns. " +
      "Make sure there is a CPT column and an Allowed/AllowedAmount/Allowable column."
    );
  }

  const out = [];
  for (const cols of rows){
    const cpt = normalizeCpt(cols[idxCpt]);
    if (!cpt) continue;

    const desc = idxDesc !== -1 ? String(cols[idxDesc] || "").trim() : "";
    const allowed = parseMoney(cols[idxAllowed]);

    out.push({ cpt, desc, allowed });
  }

  // If allowed values are still all zero, tell them exactly what happened
  const nonZero = out.filter(x => x.allowed !== 0).length;
  if (out.length > 0 && nonZero === 0){
    showBanner(
      "Fee schedule loaded, but Allowed amounts are still all $0.00. " +
      "Your CSV likely stores allowed amounts in a non-standard format (or another column not labeled 'Allowed').",
      "warn"
    );
  }

  return out;
}

function loadFeeSchedule(items){
  state.feeMap.clear();
  for (const it of items){
    state.feeMap.set(it.cpt, { desc: it.desc, allowed: it.allowed });
  }

  if (state.feeMap.size === 0){
    showBanner("Fee schedule loaded, but 0 CPTs were detected. Check your CSV values.", "warn");
  } else {
    hideBanner();
  }

  renderFeePreview();
  renderCptList();
  recalcAll();
}

function renderFeePreview(){
  $("feeCount").textContent = String(state.feeMap.size);
  const tbody = $("feePreview").querySelector("tbody");
  tbody.innerHTML = "";

  const entries = Array.from(state.feeMap.entries())
    .slice(0, 50)
    .map(([cpt, v]) => ({ cpt, ...v }));

  for (const e of entries){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(e.cpt)}</td>
      <td>${escapeHtml(e.desc || "")}</td>
      <td class="num">${money(e.allowed)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderCptList(){
  const dl = $("cptList");
  dl.innerHTML = "";
  for (const [cpt, v] of state.feeMap.entries()){
    const opt = document.createElement("option");
    opt.value = cpt;
    opt.label = v.desc || "";
    dl.appendChild(opt);
  }
}

function initRows(){
  state.rows = [];
  for (let i=0; i<state.maxRows; i++){
    state.rows.push({
      idx: i+1,
      cpt: "",
      desc: "",
      qty: 1,
      allowed: 0,
      adjPct: 0,
      adjAllowed: 0,
      lineTotal: 0,
      notFound: false
    });
  }
}

function renderProcTable(){
  const tbody = $("procTbody");
  tbody.innerHTML = "";

  state.rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.idx}</td>
      <td><input data-row="${i}" data-field="cpt" list="cptList" placeholder="e.g. 29881" /></td>
      <td data-row="${i}" data-out="desc"></td>
      <td class="num"><input data-row="${i}" data-field="qty" type="number" min="1" step="1" value="1" /></td>
      <td class="num" data-row="${i}" data-out="allowed">$0.00</td>
      <td class="num" data-row="${i}" data-out="adjPct">—</td>
      <td class="num" data-row="${i}" data-out="adjAllowed">$0.00</td>
      <td class="num" data-row="${i}" data-out="lineTotal">$0.00</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", onProcInput);
    inp.addEventListener("change", onProcInput);
  });
}

function onProcInput(e){
  const rowIdx = parseInt(e.target.getAttribute("data-row"), 10);
  const field = e.target.getAttribute("data-field");
  const v = e.target.value;

  const row = state.rows[rowIdx];
  if (!row) return;

  if (field === "cpt"){
    row.cpt = normalizeCpt(v);
  } else if (field === "qty"){
    const q = parseInt(v, 10);
    row.qty = Number.isFinite(q) && q > 0 ? q : 1;
  }

  recalcAll();
}

function recalcAll(){
  let anyMissing = false;

  for (const r of state.rows){
    const cpt = normalizeCpt(r.cpt);
    r.cpt = cpt;

    if (!cpt){
      r.desc = "";
      r.allowed = 0;
      r.notFound = false;
      continue;
    }

    const hit = state.feeMap.get(cpt);
    r.desc = hit ? hit.desc : "";
    r.allowed = hit ? hit.allowed : 0;
    r.notFound = !hit;
    if (r.notFound) anyMissing = true;
  }

  if (state.feeMap.size === 0){
    showBanner("No fee schedule loaded yet. Upload a CSV so Allowed Amounts populate.", "warn");
  } else if (anyMissing){
    showBanner("Some CPTs were not found in the fee schedule. Those lines will show $0.00 allowed.", "warn");
  } else {
    hideBanner();
  }

  let seen = 0;
  for (const r of state.rows){
    if (r.cpt){
      seen += 1;
      r.adjPct = (seen === 1) ? 1.0 : 0.5;
    } else {
      r.adjPct = 0;
    }
    r.adjAllowed = (r.adjPct > 0) ? (r.allowed * r.adjPct) : 0;
    r.lineTotal = r.qty * r.adjAllowed;
  }

  const totalAllowed = state.rows.reduce((sum, r) => sum + (r.lineTotal || 0), 0);

  const copay = numVal($("copay"));
  const dedRem = numVal($("dedRem"));
  const coinsPct = numVal($("coinsPct"));
  const oopRem = numVal($("oopRem"));

  const dedApplied = Math.min(totalAllowed, Math.max(dedRem, 0));
  const coinsBase = Math.max(totalAllowed - dedApplied, 0);
  const coinsAmt = coinsBase * Math.max(coinsPct, 0);
  const rawResp = Math.max(copay, 0) + dedApplied + coinsAmt;
  const oopCapped = Math.min(rawResp, Math.max(oopRem, 0));

  const estOwes = oopCapped;
  const recDeposit = estOwes;

  renderProcOutputs();

  $("totalAllowed").textContent = money(totalAllowed);
  $("dedApplied").textContent = money(dedApplied);
  $("coinsAmt").textContent = money(coinsAmt);
  $("copayOut").textContent = money(copay);
  $("estOwes").textContent = money(estOwes);
  $("recDeposit").textContent = money(recDeposit);

  renderPrintable({
    totalAllowed, dedApplied, coinsAmt, copay,
    estOwes, recDeposit, dedRem, coinsPct, oopRem
  });
}

function renderProcOutputs(){
  const tbody = $("procTbody");

  for (let i=0; i<state.rows.length; i++){
    const r = state.rows[i];

    const descCell = tbody.querySelector(`[data-row="${i}"][data-out="desc"]`);
    const allowedCell = tbody.querySelector(`[data-row="${i}"][data-out="allowed"]`);
    const adjPctCell = tbody.querySelector(`[data-row="${i}"][data-out="adjPct"]`);
    const adjAllowedCell = tbody.querySelector(`[data-row="${i}"][data-out="adjAllowed"]`);
    const lineTotalCell = tbody.querySelector(`[data-row="${i}"][data-out="lineTotal"]`);

    if (descCell){
      descCell.textContent = r.desc || (r.notFound ? "CPT not found in fee schedule" : "");
      descCell.style.color = r.notFound ? "#b45309" : "";
      descCell.style.fontWeight = r.notFound ? "800" : "";
    }
    if (allowedCell) allowedCell.textContent = money(r.allowed || 0);
    if (adjPctCell) adjPctCell.textContent = r.adjPct ? pct(r.adjPct) : "—";
    if (adjAllowedCell) adjAllowedCell.textContent = money(r.adjAllowed || 0);
    if (lineTotalCell) lineTotalCell.textContent = money(r.lineTotal || 0);
  }
}

function renderPrintable(calc){
  const today = new Date();
  $("printDate").textContent = today.toLocaleDateString();

  $("printPatient").textContent = $("patientName").value || "";
  $("printInsurance").textContent = $("insurancePlan").value || "";
  $("printPreparedBy").textContent = $("preparedBy").value || "";

  $("printEstOwes").textContent = money(calc.estOwes);
  $("printRecDeposit").textContent = money(calc.recDeposit);

  $("printTotalAllowed").textContent = money(calc.totalAllowed);
  $("printDedApplied").textContent = money(calc.dedApplied);
  $("printCoinsAmt").textContent = money(calc.coinsAmt);
  $("printCopay").textContent = money(calc.copay);
  $("printEstOwes2").textContent = money(calc.estOwes);

  $("printDedRem").textContent = money(calc.dedRem);
  $("printCoinsPct").textContent = pct(calc.coinsPct);
  $("printOopRem").textContent = money(calc.oopRem);

  const tbody = $("printProcTbody");
  tbody.innerHTML = "";
  for (const r of state.rows){
    if (!r.cpt) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.cpt)}</td>
      <td>${escapeHtml(r.desc || (r.notFound ? "CPT not found in fee schedule" : ""))}</td>
      <td class="num">${r.qty}</td>
      <td class="num">${money(r.adjAllowed || 0)}</td>
      <td class="num">${money(r.lineTotal || 0)}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function loadSampleFeeSchedule(){
  try{
    const res = await fetch("feeSchedule.sample.csv", { cache: "no-store" });
    if (!res.ok) return;
    const text = await res.text();
    const items = parseCSV(text);
    loadFeeSchedule(items);
  } catch {}
}

function hookInputs(){
  ["patientName","insurancePlan","preparedBy","copay","dedRem","coinsPct","oopRem"]
    .forEach(id => $(id).addEventListener("input", recalcAll));
}

function resetAll(){
  $("patientName").value = "";
  $("insurancePlan").value = "";
  $("preparedBy").value = "";
  $("copay").value = "0";
  $("dedRem").value = "0";
  $("coinsPct").value = "0.20";
  $("oopRem").value = "999999";

  initRows();
  renderProcTable();
  recalcAll();
}

function initFeeUpload(){
  $("feeFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try{
      const items = parseCSV(text);
      loadFeeSchedule(items);
    } catch(err){
      alert(err.message || "Failed to read CSV");
    }
  });
}

function initButtons(){
  $("btnPrint").addEventListener("click", () => window.print());
  $("btnReset").addEventListener("click", () => {
    if (confirm("Reset quote inputs and CPT lines?")) resetAll();
  });
}

(function boot(){
  initRows();
  renderProcTable();
  hookInputs();
  initFeeUpload();
  initButtons();
  loadSampleFeeSchedule();
  recalcAll();
})();

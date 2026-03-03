// app.js
// Surgical Deposit Quote (Static)
// - Fee schedule CSV import
// - Auto populate Description + Allowed
// - Multi-proc: 1st CPT = 100%, subsequent CPTs = 50%
// - Deductible / coinsurance / OOP cap logic
// - Printable patient quote with breakdown + NES logo

const state = {
  feeMap: new Map(),        // CPT -> { desc, allowed }
  rows: [],                 // procedure rows
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
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : 0;
}

function cleanCpt(s){
  return String(s || "").trim();
}

function escapeHtml(s){
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.trim());
  const idxCpt = headers.findIndex(h => h.toLowerCase() === "cpt");
  const idxDesc = headers.findIndex(h => h.toLowerCase() === "description");
  const idxAllowed = headers.findIndex(h => h.toLowerCase() === "allowedamount");

  if (idxCpt === -1 || idxDesc === -1 || idxAllowed === -1){
    throw new Error("CSV must include headers CPT, Description, AllowedAmount");
  }

  const out = [];
  for (let i=1; i<lines.length; i++){
    const cols = lines[i].split(",").map(x => x.trim());
    const cpt = cleanCpt(cols[idxCpt]);
    const desc = cols[idxDesc] || "";
    const allowed = parseFloat(cols[idxAllowed]);
    if (!cpt) continue;
    out.push({ cpt, desc, allowed: Number.isFinite(allowed) ? allowed : 0 });
  }
  return out;
}

function loadFeeSchedule(items){
  state.feeMap.clear();
  for (const it of items){
    state.feeMap.set(it.cpt, { desc: it.desc, allowed: it.allowed });
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
      <td>${escapeHtml(e.desc)}</td>
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
      lineTotal: 0
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
    row.cpt = cleanCpt(v);
  } else if (field === "qty"){
    const q = parseInt(v, 10);
    row.qty = Number.isFinite(q) && q > 0 ? q : 1;
  }

  recalcAll();
}

function recalcAll(){
  for (const r of state.rows){
    const cpt = cleanCpt(r.cpt);
    if (!cpt){
      r.desc = "";
      r.allowed = 0;
      continue;
    }
    const hit = state.feeMap.get(cpt);
    r.desc = hit ? hit.desc : "";
    r.allowed = hit ? hit.allowed : 0;
  }

  let seen = 0;
  for (const r of state.rows){
    if (cleanCpt(r.cpt)){
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

    if (descCell) descCell.textContent = r.desc || "";
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
    if (!cleanCpt(r.cpt)) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.cpt)}</td>
      <td>${escapeHtml(r.desc || "")}</td>
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

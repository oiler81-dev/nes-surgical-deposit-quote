/* =========================
   STATE
   ========================= */
const state = {
  feeMap: new Map(),       // CPT -> { desc, fee }
  providers: [],           // ["Dr. ...", ...]
  rows: [],
  maxRows: 10,
  history: []
};

const $ = (id) => document.getElementById(id);

function money(n){
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function parseNum(x){
  const v = parseFloat(String(x ?? "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

async function safeJson(res){
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return null; }
}

/* =========================
   API HELPERS (fallback-aware)
   ========================= */
async function apiGet(path){
  try{
    const res = await fetch(path, { cache: "no-store" });
    if(!res.ok) return null;
    return await safeJson(res);
  }catch{
    return null;
  }
}

async function apiPost(path, body){
  try{
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if(!res.ok) return null;
    return await safeJson(res);
  }catch{
    return null;
  }
}

/* =========================
   LOAD FEES + PROVIDERS
   ========================= */
async function loadFees(){
  // existing function you already had
  const data = await apiGet("/api/fees");
  if(!Array.isArray(data)) return false;

  state.feeMap.clear();
  data.forEach(x => {
    if(!x || !x.cpt) return;
    state.feeMap.set(String(x.cpt).trim(), {
      desc: String(x.desc || "").trim(),
      fee: parseNum(x.fee)
    });
  });

  return state.feeMap.size > 0;
}

async function loadProviders(){
  const data = await apiGet("/api/providers");
  if(data && Array.isArray(data.providers)){
    state.providers = data.providers;
    return true;
  }
  state.providers = [];
  return false;
}

/* =========================
   ROWS
   ========================= */
function cptOptionsHtml(selected){
  const codes = Array.from(state.feeMap.keys()).sort();
  const opts = [`<option value="">Select CPT</option>`];
  for(const cpt of codes){
    const sel = cpt === selected ? " selected" : "";
    opts.push(`<option value="${escapeHtml(cpt)}"${sel}>${escapeHtml(cpt)}</option>`);
  }
  return opts.join("");
}

function providerOptionsHtml(selected){
  const opts = [`<option value="">Select Provider</option>`];
  for(const p of state.providers){
    const sel = p === selected ? " selected" : "";
    opts.push(`<option value="${escapeHtml(p)}"${sel}>${escapeHtml(p)}</option>`);
  }
  return opts.join("");
}

function renderRows(){
  const host = $("rows");
  host.innerHTML = "";

  state.rows.forEach((r, idx) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>
        <select class="providerSelect">${providerOptionsHtml(r.provider)}</select>
      </td>

      <td>
        <select class="cptSelect">${cptOptionsHtml(r.cpt)}</select>
      </td>

      <td>
        <input class="descInput" type="text" value="${escapeHtml(r.desc || "")}" disabled />
      </td>

      <td>
        <input class="feeInput" type="number" step="0.01" value="${String(r.fee ?? 0)}" />
      </td>

      <td>
        <input class="qtyInput" type="number" step="1" min="1" value="${String(r.qty ?? 1)}" />
      </td>

      <td class="money lineTotal">${money((r.fee||0) * (r.qty||1))}</td>

      <td>
        <button class="btn danger icon-btn removeBtn" title="Remove">X</button>
      </td>
    `;

    const providerSel = tr.querySelector(".providerSelect");
    const cptSel = tr.querySelector(".cptSelect");
    const feeInput = tr.querySelector(".feeInput");
    const qtyInput = tr.querySelector(".qtyInput");
    const descInput = tr.querySelector(".descInput");
    const lineTotal = tr.querySelector(".lineTotal");
    const removeBtn = tr.querySelector(".removeBtn");

    providerSel.addEventListener("change", () => {
      r.provider = providerSel.value || "";
    });

    cptSel.addEventListener("change", () => {
      r.cpt = cptSel.value || "";
      const info = state.feeMap.get(r.cpt);
      if(info){
        r.desc = info.desc || "";
        r.fee = parseNum(info.fee);
        descInput.value = r.desc;
        feeInput.value = String(r.fee ?? 0);
      }else{
        r.desc = "";
        r.fee = 0;
        descInput.value = "";
        feeInput.value = "0";
      }
      updateLine();
      recalcTotals();
    });

    feeInput.addEventListener("input", () => {
      r.fee = parseNum(feeInput.value);
      updateLine();
      recalcTotals();
    });

    qtyInput.addEventListener("input", () => {
      r.qty = Math.max(1, Math.floor(parseNum(qtyInput.value)));
      qtyInput.value = String(r.qty);
      updateLine();
      recalcTotals();
    });

    removeBtn.addEventListener("click", () => {
      state.rows.splice(idx, 1);
      renderRows();
      recalcTotals();
    });

    function updateLine(){
      lineTotal.textContent = money((r.fee||0) * (r.qty||1));
    }

    host.appendChild(tr);
  });
}

function addRow(){
  if(state.rows.length >= state.maxRows) return;
  state.rows.push({ provider:"", cpt:"", desc:"", fee:0, qty:1 });
  renderRows();
  recalcTotals();
}

function recalcTotals(){
  const total = state.rows.reduce((s, r) => s + (parseNum(r.fee) * Math.max(1, parseNum(r.qty))), 0);
  $("grandTotal").textContent = money(total);
}

/* =========================
   HISTORY (API first, fallback local)
   ========================= */
function loadLocalHistory(){
  try{
    return JSON.parse(localStorage.getItem("nes_estimate_history_v2") || "[]");
  }catch{
    return [];
  }
}
function saveLocalHistory(items){
  localStorage.setItem("nes_estimate_history_v2", JSON.stringify(items));
}

async function loadHistory(){
  // If you already have /api/quotes working, use it.
  const api = await apiGet("/api/quotes?take=25");
  if(api && Array.isArray(api.items)){
    state.history = api.items;
    return;
  }

  // fallback to local
  state.history = loadLocalHistory();
}

function renderHistory(){
  const host = $("history");
  host.innerHTML = "";

  if(!state.history.length){
    host.innerHTML = `<div class="history-item"><div class="history-meta">No saved quotes.</div></div>`;
    return;
  }

  state.history.slice(0, 25).forEach(q => {
    const total = parseNum(q.total) || q.rows?.reduce((s,r)=>s+(parseNum(r.fee)*parseNum(r.qty||1)),0) || 0;
    const name = q.patientName || "Unnamed";
    const dt = q.quoteDate || "";
    const savedAt = q.savedAt ? new Date(q.savedAt).toLocaleString() : "";

    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <div class="history-top">
        <div>
          <div class="history-title">${escapeHtml(name)}</div>
          <div class="history-meta">${escapeHtml(dt)} ${savedAt ? "• " + escapeHtml(savedAt) : ""}</div>
        </div>
        <div class="history-title">${money(total)}</div>
      </div>
      <div class="history-lines">
        ${(q.rows || []).map(r => {
          const prov = r.provider ? ` (${escapeHtml(r.provider)})` : "";
          const line = parseNum(r.fee) * Math.max(1, parseNum(r.qty));
          return `• ${escapeHtml(r.cpt || "")} - ${escapeHtml(r.desc || "")}${prov} • ${money(parseNum(r.fee))} x ${parseNum(r.qty||1)} = <b>${money(line)}</b>`;
        }).join("<br/>")}
      </div>
    `;
    host.appendChild(div);
  });
}

async function saveQuote(){
  const hasCpt = state.rows.some(r => r.cpt);
  if(!hasCpt){
    alert("Select at least one CPT.");
    return;
  }

  const quote = {
    savedAt: new Date().toISOString(),
    patientName: $("patientName").value.trim(),
    quoteDate: $("quoteDate").value,
    notes: $("quoteNotes").value.trim(),
    rows: state.rows
      .filter(r => r.cpt)
      .map(r => ({
        provider: r.provider || "",
        cpt: r.cpt,
        desc: r.desc || "",
        fee: parseNum(r.fee),
        qty: Math.max(1, Math.floor(parseNum(r.qty)))
      }))
  };

  quote.total = quote.rows.reduce((s, r) => s + (parseNum(r.fee) * parseNum(r.qty)), 0);

  // API first (if you already have it)
  const apiSaved = await apiPost("/api/quotes", quote);
  if(apiSaved){
    await loadHistory();
    renderHistory();
    alert("Quote saved.");
    return;
  }

  // Fallback local
  const items = loadLocalHistory();
  items.unshift(quote);
  saveLocalHistory(items.slice(0, 50));
  state.history = items.slice(0, 50);
  renderHistory();
  alert("Quote saved (local fallback).");
}

function exportHistoryCSV(){
  const items = state.history || [];
  if(!items.length){
    alert("No history to export.");
    return;
  }

  const out = [];
  out.push(["SavedAt","QuoteDate","PatientName","Notes","Provider","CPT","Description","Fee","Qty","LineTotal","QuoteTotal"]);

  for(const q of items){
    const qTotal = parseNum(q.total) || 0;
    for(const r of (q.rows || [])){
      const fee = parseNum(r.fee);
      const qty = Math.max(1, parseNum(r.qty));
      const line = fee * qty;
      out.push([
        q.savedAt || "",
        q.quoteDate || "",
        q.patientName || "",
        q.notes || "",
        r.provider || "",
        r.cpt || "",
        r.desc || "",
        fee,
        qty,
        line,
        qTotal
      ]);
    }
  }

  const csv = out.map(row => row.map(csvCell).join(",")).join("\n");
  download(`quote_history_${new Date().toISOString().slice(0,10)}.csv`, csv, "text/csv");
}

function csvCell(v){
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function download(filename, content, mime){
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

function clearQuote(){
  if(!confirm("Clear current quote?")) return;
  $("patientName").value = "";
  $("quoteNotes").value = "";
  state.rows = [];
  for(let i=0;i<3;i++) addRow();
  recalcTotals();
}

async function refreshHistory(){
  await loadHistory();
  renderHistory();
}

/* =========================
   INIT
   ========================= */
async function init(){
  // default date
  const d = new Date();
  $("quoteDate").value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  // Load fees + providers
  const feesOk = await loadFees();
  await loadProviders();

  if(!feesOk){
    alert("Could not load CPT fees from /api/fees. Fix that first.");
  }

  // Seed rows
  state.rows = [];
  for(let i=0;i<3;i++) addRow();

  // History
  await loadHistory();
  renderHistory();

  // Buttons
  $("addRowBtn").addEventListener("click", addRow);
  $("saveQuoteBtn").addEventListener("click", saveQuote);
  $("clearBtn").addEventListener("click", clearQuote);
  $("refreshHistoryBtn").addEventListener("click", refreshHistory);
  $("exportHistoryBtn").addEventListener("click", exportHistoryCSV);
  $("clearHistoryBtn").addEventListener("click", () => {
    if(!confirm("Clear local history? (Does not clear API history)")) return;
    localStorage.removeItem("nes_estimate_history_v2");
    refreshHistory();
  });

  recalcTotals();
}

document.addEventListener("DOMContentLoaded", init);

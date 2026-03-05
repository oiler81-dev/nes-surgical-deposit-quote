/* =========================
   STATE + HELPERS
   ========================= */

const state = {
  feeMap: new Map(),   // CPT -> { desc, fee }
  rows: [],
  maxRows: 10,
  history: []
};

const $ = (id) => document.getElementById(id);

function money(n){
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function num(n){
  const v = Number.isFinite(n) ? n : 0;
  return v;
}
function parseNumber(x){
  const v = parseFloat(String(x ?? "").replace(/,/g,""));
  return Number.isFinite(v) ? v : 0;
}

/* =========================
   PROVIDERS (dropdown options)
   =========================
   Replace this list with your exact provider names as you want them shown.
*/
const providers = [
  "Select Provider",
  "Dr. David L. Wood",
  "Dr. Jason Snibbe",
  "Dr. Jonathan Yun",
  "Dr. Shawn Kato",
  "Dr. Patrick Hsieh",
  "Dr. Michael Stone",
  "Dr. Daniel Allison",
  "Dr. Brian Kim",
  "Dr. Farshad M. Ahmadi",
  "Dr. Sam Baksh",
  "Dr. Joshua Hernandez"
];

/* =========================
   CPT FEES (dropdown options)
   =========================
   Replace/add CPT codes, descriptions, and fees here.
   CPT dropdown is built from this.
*/
const cptFeeList = [
  { cpt: "99213", desc: "Office/outpatient visit est patient", fee: 150 },
  { cpt: "99214", desc: "Office/outpatient visit est patient (complex)", fee: 220 },
  { cpt: "20610", desc: "Arthrocentesis/injection, major joint", fee: 180 },
  { cpt: "20611", desc: "Arthrocentesis/injection w/ US guidance", fee: 260 },
  { cpt: "29881", desc: "Knee arthroscopy w/ meniscectomy", fee: 3200 },
  { cpt: "27447", desc: "Total knee arthroplasty", fee: 14500 }
];

/* =========================
   INIT
   ========================= */

function init(){
  // Load CPT fee list into feeMap
  state.feeMap.clear();
  for (const item of cptFeeList){
    state.feeMap.set(item.cpt, { desc: item.desc, fee: item.fee });
  }

  // Date default
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,"0");
  const dd = String(today.getDate()).padStart(2,"0");
  $("quoteDate").value = `${yyyy}-${mm}-${dd}`;

  // History
  state.history = loadHistory();
  renderHistory();

  // Start with 3 rows
  for (let i=0; i<3; i++) addRow();

  // Wire buttons
  $("addRowBtn").addEventListener("click", addRow);
  $("clearBtn").addEventListener("click", clearQuote);
  $("saveQuoteBtn").addEventListener("click", saveQuote);
  $("exportHistoryBtn").addEventListener("click", exportHistoryCSV);
  $("clearHistoryBtn").addEventListener("click", () => {
    if (!confirm("Clear quote history?")) return;
    localStorage.removeItem("estimate_history_v1");
    state.history = [];
    renderHistory();
  });

  recalcTotals();
}

document.addEventListener("DOMContentLoaded", init);

/* =========================
   ROWS
   ========================= */

function addRow(){
  if (state.rows.length >= state.maxRows) return;

  const row = {
    id: crypto.randomUUID(),
    provider: "",
    cpt: "",
    desc: "",
    fee: 0,
    qty: 1
  };
  state.rows.push(row);
  renderRows();
  recalcTotals();
}

function removeRow(id){
  state.rows = state.rows.filter(r => r.id !== id);
  renderRows();
  recalcTotals();
}

function renderRows(){
  const tbody = $("rowsTbody");
  tbody.innerHTML = "";

  for (const r of state.rows){
    const tr = document.createElement("tr");

    // Provider select
    const tdProvider = document.createElement("td");
    const providerSelect = document.createElement("select");
    providerSelect.className = "providerSelect";
    providers.forEach((p, idx) => {
      const opt = document.createElement("option");
      opt.value = idx === 0 ? "" : p;
      opt.textContent = p;
      providerSelect.appendChild(opt);
    });
    providerSelect.value = r.provider || "";
    providerSelect.addEventListener("change", () => {
      r.provider = providerSelect.value;
      // no totals impact
    });
    tdProvider.appendChild(providerSelect);
    tr.appendChild(tdProvider);

    // CPT select
    const tdCpt = document.createElement("td");
    const cptSelect = document.createElement("select");
    cptSelect.className = "cptSelect";

    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Select CPT";
    cptSelect.appendChild(first);

    const cptCodes = Array.from(state.feeMap.keys()).sort();
    cptCodes.forEach(cpt => {
      const opt = document.createElement("option");
      opt.value = cpt;
      opt.textContent = cpt;
      cptSelect.appendChild(opt);
    });

    cptSelect.value = r.cpt || "";
    cptSelect.addEventListener("change", () => {
      r.cpt = cptSelect.value;

      const info = state.feeMap.get(r.cpt);
      r.desc = info ? info.desc : "";
      r.fee = info ? info.fee : 0;

      renderRows();     // refresh desc/fee display
      recalcTotals();
    });

    tdCpt.appendChild(cptSelect);
    tr.appendChild(tdCpt);

    // Description (read-only)
    const tdDesc = document.createElement("td");
    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.value = r.desc || "";
    descInput.placeholder = "Auto-filled from CPT";
    descInput.disabled = true;
    tdDesc.appendChild(descInput);
    tr.appendChild(tdDesc);

    // Fee (read-only)
    const tdFee = document.createElement("td");
    tdFee.className = "money";
    tdFee.textContent = money(r.fee);
    tr.appendChild(tdFee);

    // Qty
    const tdQty = document.createElement("td");
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.step = "1";
    qtyInput.value = String(r.qty ?? 1);
    qtyInput.addEventListener("input", () => {
      r.qty = Math.max(1, Math.floor(parseNumber(qtyInput.value)));
      recalcTotals();
      renderRows(); // refresh line total display
    });
    tdQty.appendChild(qtyInput);
    tr.appendChild(tdQty);

    // Line Total
    const tdLine = document.createElement("td");
    tdLine.className = "money";
    tdLine.textContent = money(num(r.fee) * num(r.qty));
    tr.appendChild(tdLine);

    // Remove button
    const tdActions = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger icon-btn";
    delBtn.textContent = "X";
    delBtn.title = "Remove row";
    delBtn.addEventListener("click", () => removeRow(r.id));
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  }
}

/* =========================
   TOTALS
   ========================= */

function recalcTotals(){
  let subtotal = 0;
  for (const r of state.rows){
    subtotal += num(r.fee) * num(r.qty);
  }
  $("subtotal").textContent = money(subtotal);
  $("grandTotal").textContent = money(subtotal);
}

/* =========================
   QUOTE SAVE + HISTORY
   ========================= */

function clearQuote(){
  if (!confirm("Clear current quote?")) return;
  $("patientName").value = "";
  $("quoteNotes").value = "";
  state.rows = [];
  for (let i=0; i<3; i++) addRow();
  recalcTotals();
}

function saveQuote(){
  // Basic validation: at least 1 CPT chosen
  const hasCpt = state.rows.some(r => r.cpt);
  if (!hasCpt){
    alert("Select at least one CPT before saving.");
    return;
  }

  const quote = {
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    patientName: $("patientName").value.trim(),
    quoteDate: $("quoteDate").value,
    notes: $("quoteNotes").value.trim(),
    rows: state.rows
      .filter(r => r.cpt)
      .map(r => ({
        provider: r.provider || "",
        cpt: r.cpt,
        desc: r.desc,
        fee: num(r.fee),
        qty: num(r.qty),
        lineTotal: num(r.fee) * num(r.qty)
      }))
  };

  quote.total = quote.rows.reduce((s, r) => s + num(r.lineTotal), 0);

  state.history.unshift(quote);
  // keep last 50
  state.history = state.history.slice(0, 50);

  saveHistory(state.history);
  renderHistory();

  alert("Quote saved.");
}

function loadHistory(){
  try{
    const raw = localStorage.getItem("estimate_history_v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }catch{
    return [];
  }
}

function saveHistory(history){
  localStorage.setItem("estimate_history_v1", JSON.stringify(history));
}

function renderHistory(){
  const host = $("historyList");
  host.innerHTML = "";

  if (!state.history.length){
    const empty = document.createElement("div");
    empty.className = "history-item";
    empty.innerHTML = `<div class="history-meta">No saved quotes yet.</div>`;
    host.appendChild(empty);
    return;
  }

  state.history.forEach(q => {
    const div = document.createElement("div");
    div.className = "history-item";

    const title = q.patientName ? q.patientName : "Unnamed Patient";
    const when = new Date(q.savedAt);
    const whenStr = when.toLocaleString();

    const top = document.createElement("div");
    top.className = "history-top";
    top.innerHTML = `
      <div>
        <div class="history-title">${escapeHtml(title)}</div>
        <div class="history-meta">${escapeHtml(q.quoteDate || "")} • Saved ${escapeHtml(whenStr)}</div>
      </div>
      <div class="history-title">${money(q.total)}</div>
    `;

    const lines = document.createElement("div");
    lines.className = "history-lines";
    lines.innerHTML = q.rows.map(r => {
      const prov = r.provider ? ` (${escapeHtml(r.provider)})` : "";
      return `• ${escapeHtml(r.cpt)} - ${escapeHtml(r.desc)}${prov} • ${money(r.fee)} x ${r.qty} = <b>${money(r.lineTotal)}</b>`;
    }).join("<br/>");

    div.appendChild(top);
    div.appendChild(lines);

    host.appendChild(div);
  });
}

function exportHistoryCSV(){
  if (!state.history.length){
    alert("No history to export.");
    return;
  }

  const rows = [];
  rows.push([
    "SavedAt",
    "QuoteDate",
    "PatientName",
    "Notes",
    "Provider",
    "CPT",
    "Description",
    "Fee",
    "Qty",
    "LineTotal",
    "QuoteTotal"
  ]);

  state.history.forEach(q => {
    q.rows.forEach(r => {
      rows.push([
        q.savedAt,
        q.quoteDate || "",
        q.patientName || "",
        q.notes || "",
        r.provider || "",
        r.cpt,
        r.desc,
        r.fee,
        r.qty,
        r.lineTotal,
        q.total
      ]);
    });
  });

  const csv = rows.map(r => r.map(csvCell).join(",")).join("\n");
  downloadTextFile(`quote_history_${new Date().toISOString().slice(0,10)}.csv`, csv, "text/csv");
}

/* =========================
   UTILS
   ========================= */

function csvCell(v){
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

function downloadTextFile(filename, content, mime){
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

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

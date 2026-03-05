const $ = (id) => document.getElementById(id);

function money(n){
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function parseNum(x){
  const v = parseFloat(String(x ?? "").replace(/,/g,""));
  return Number.isFinite(v) ? v : 0;
}
function esc(s){
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
async function apiGet(path){
  try{
    const res = await fetch(path, { cache:"no-store" });
    if(!res.ok) return null;
    return await safeJson(res);
  }catch{
    return null;
  }
}

function loadLocalHistory(){
  try{
    return JSON.parse(localStorage.getItem("nes_estimate_history_v2") || "[]");
  }catch{
    return [];
  }
}

let allQuotes = [];
let charts = { rev:null, prov:null, cpt:null };

function toDateOnly(isoOrYmd){
  if(!isoOrYmd) return null;
  // accept YYYY-MM-DD or ISO
  const s = String(isoOrYmd);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if(isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function withinRange(dateYmd, startYmd, endYmd){
  if(!dateYmd) return false;
  if(startYmd && dateYmd < startYmd) return false;
  if(endYmd && dateYmd > endYmd) return false;
  return true;
}

function flattenLines(quotes){
  const lines = [];
  for(const q of quotes){
    const savedAt = q.savedAt || "";
    const quoteDate = q.quoteDate || "";
    const patient = q.patientName || "";
    for(const r of (q.rows || [])){
      const fee = parseNum(r.fee);
      const qty = Math.max(1, parseNum(r.qty));
      lines.push({
        savedAt,
        quoteDate,
        patient,
        provider: r.provider || "",
        cpt: r.cpt || "",
        desc: r.desc || "",
        fee,
        qty,
        lineTotal: fee * qty
      });
    }
  }
  return lines;
}

function fillProviderFilter(lines){
  const sel = $("providerFilter");
  const providers = Array.from(new Set(lines.map(x => x.provider).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
  sel.innerHTML = `<option value="">All Providers</option>` + providers.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
}

function aggregate(lines){
  const byDay = new Map();
  const byProvider = new Map();
  const byCpt = new Map();

  for(const x of lines){
    const day = toDateOnly(x.quoteDate) || toDateOnly(x.savedAt);
    if(day){
      byDay.set(day, (byDay.get(day) || 0) + x.lineTotal);
    }

    const prov = x.provider || "Unassigned";
    byProvider.set(prov, (byProvider.get(prov) || 0) + x.lineTotal);

    const cpt = x.cpt || "—";
    byCpt.set(cpt, (byCpt.get(cpt) || 0) + x.qty);
  }

  const dayLabels = Array.from(byDay.keys()).sort();
  const dayVals = dayLabels.map(d => byDay.get(d));

  const provPairs = Array.from(byProvider.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 15);
  const provLabels = provPairs.map(x=>x[0]);
  const provVals = provPairs.map(x=>x[1]);

  const cptPairs = Array.from(byCpt.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 20);
  const cptLabels = cptPairs.map(x=>x[0]);
  const cptVals = cptPairs.map(x=>x[1]);

  return { dayLabels, dayVals, provLabels, provVals, cptLabels, cptVals, cptPairs };
}

function setKpis(filteredQuotes, lines, cptPairs){
  const quoteCount = filteredQuotes.length;
  const total = lines.reduce((s,x)=>s+x.lineTotal,0);
  const avg = quoteCount ? total / quoteCount : 0;
  const topCpt = cptPairs.length ? `${cptPairs[0][0]} (${cptPairs[0][1]})` : "—";

  $("kpiQuotes").textContent = String(quoteCount);
  $("kpiTotal").textContent = money(total);
  $("kpiAvg").textContent = money(avg);
  $("kpiTopCpt").textContent = topCpt;
}

function renderCharts(agg){
  // destroy old charts
  charts.rev?.destroy?.();
  charts.prov?.destroy?.();
  charts.cpt?.destroy?.();

  charts.rev = new Chart($("revChart"), {
    type: "line",
    data: {
      labels: agg.dayLabels,
      datasets: [{ label: "Revenue", data: agg.dayVals }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { y: { ticks: { callback: (v)=>money(v) } } }
    }
  });

  charts.prov = new Chart($("provChart"), {
    type: "bar",
    data: {
      labels: agg.provLabels,
      datasets: [{ label: "Total", data: agg.provVals }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { y: { ticks: { callback: (v)=>money(v) } } }
    }
  });

  charts.cpt = new Chart($("cptChart"), {
    type: "bar",
    data: {
      labels: agg.cptLabels,
      datasets: [{ label: "Qty", data: agg.cptVals }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } }
    }
  });
}

function renderTable(lines){
  const body = $("detailBody");
  body.innerHTML = "";

  for(const x of lines.slice(0, 500)){ // cap for UI
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(x.savedAt ? new Date(x.savedAt).toLocaleString() : "")}</td>
      <td>${esc(x.quoteDate || "")}</td>
      <td>${esc(x.patient || "")}</td>
      <td>${esc(x.provider || "")}</td>
      <td>${esc(x.cpt || "")}</td>
      <td>${esc(x.desc || "")}</td>
      <td>${money(x.fee)}</td>
      <td>${esc(x.qty)}</td>
      <td>${money(x.lineTotal)}</td>
    `;
    body.appendChild(tr);
  }
}

function exportCsv(lines){
  const out = [];
  out.push(["SavedAt","QuoteDate","Patient","Provider","CPT","Description","Fee","Qty","LineTotal"]);
  for(const x of lines){
    out.push([x.savedAt, x.quoteDate, x.patient, x.provider, x.cpt, x.desc, x.fee, x.qty, x.lineTotal]);
  }
  const csv = out.map(r => r.map(csvCell).join(",")).join("\n");
  download(`rcm_export_${new Date().toISOString().slice(0,10)}.csv`, csv, "text/csv");
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

function applyFilters(){
  const start = $("startDate").value || "";
  const end = $("endDate").value || "";
  const provider = $("providerFilter").value || "";

  const filteredQuotes = allQuotes.filter(q => {
    const qDate = toDateOnly(q.quoteDate) || toDateOnly(q.savedAt);
    if(!withinRange(qDate, start, end)) return false;
    if(!provider) return true;
    return (q.rows || []).some(r => (r.provider || "") === provider);
  });

  // Flatten then apply provider filter at line level
  let lines = flattenLines(filteredQuotes);

  if(provider){
    lines = lines.filter(x => x.provider === provider);
  }

  // Now date filter on lines (in case quoteDate varies)
  lines = lines.filter(x => withinRange(toDateOnly(x.quoteDate) || toDateOnly(x.savedAt), start, end));

  fillProviderFilter(flattenLines(allQuotes)); // keep full provider list stable
  const agg = aggregate(lines);
  setKpis(filteredQuotes, lines, agg.cptPairs);
  renderCharts(agg);
  renderTable(lines);

  // stash for export
  window.__filteredLines = lines;
}

async function loadAll(){
  // API first
  const api = await apiGet("/api/quotes?take=5000");
  if(api && Array.isArray(api.items)){
    allQuotes = api.items;
  }else{
    allQuotes = loadLocalHistory();
  }

  // Default dates: last 30 days
  const d = new Date();
  const end = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const d2 = new Date(d.getTime() - 29*24*60*60*1000);
  const start = `${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,"0")}-${String(d2.getDate()).padStart(2,"0")}`;

  $("startDate").value = start;
  $("endDate").value = end;

  fillProviderFilter(flattenLines(allQuotes));
  applyFilters();
}

function clearFilters(){
  $("providerFilter").value = "";
  $("startDate").value = "";
  $("endDate").value = "";
  applyFilters();
}

document.addEventListener("DOMContentLoaded", () => {
  $("refreshBtn").addEventListener("click", loadAll);
  $("applyBtn").addEventListener("click", applyFilters);
  $("clearBtn").addEventListener("click", clearFilters);
  $("exportBtn").addEventListener("click", () => exportCsv(window.__filteredLines || []));
  loadAll();
});

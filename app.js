// -------------------- utilities --------------------
function $(id){ return document.getElementById(id); }

function money(n){
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { style:"currency", currency:"USD" });
}

function toYmdLocal(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d){
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff);
  x.setHours(0,0,0,0);
  return x;
}

async function fetchText(url, options={}){
  const res = await fetch(url, { cache:"no-store", ...options });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}\n${text}`);
  return text;
}

async function fetchJson(url, options={}){
  const text = await fetchText(url, options);
  try { return JSON.parse(text); }
  catch { throw new Error(`Bad JSON from ${url}\n${text}`); }
}

function showQhError(msg){
  const el = $("qhError");
  if (!el) return;
  el.style.display = "block";
  el.textContent = msg;
}
function clearQhError(){
  const el = $("qhError");
  if (!el) return;
  el.style.display = "none";
  el.textContent = "";
}

function downloadCsv(filename, headers, rows){
  const escape = (v) => {
    const s = String(v ?? "");
    if (s.includes('"') || s.includes(",") || s.includes("\n")) return '"' + s.replaceAll('"','""') + '"';
    return s;
  };
  const csv = [headers.join(",")]
    .concat(rows.map(r => headers.map(h => escape(r[h])).join(",")))
    .join("\n");

  const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// -------------------- fee schedule persistence --------------------
const LS_FEE_KEY = "nes_feeSchedule_csv_v1";
const DEFAULT_FEE_URL = "/feeSchedule.sample.csv"; // ✅ auto-load fallback

function saveFeeScheduleCsv(csvText){
  try { localStorage.setItem(LS_FEE_KEY, csvText); } catch {}
}
function loadFeeScheduleCsv(){
  try { return localStorage.getItem(LS_FEE_KEY) || ""; } catch { return ""; }
}
function clearFeeScheduleCsv(){
  try { localStorage.removeItem(LS_FEE_KEY); } catch {}
}

// -------------------- auth: user + roles --------------------
let CURRENT_USER = null;

async function loadAuth(){
  const data = await fetchJson("/.auth/me");
  const principal = data?.clientPrincipal || null;
  CURRENT_USER = principal;

  const preparedBy = $("preparedBy");
  if (preparedBy && principal){
    preparedBy.value = principal.userDetails || principal.userId || "";
  }

  const roles = principal?.userRoles || [];
  const isAdmin = roles.includes("admin");

  const adminBtn = $("adminBtn");
  if (adminBtn){
    adminBtn.style.display = isAdmin ? "inline-flex" : "none";
    adminBtn.onclick = () => window.location.href = "/admin.html";
  }
}

// -------------------- fee schedule + procedures --------------------
let FEE_MAP = new Map(); // CPT -> { cpt, desc, allowed }
let PROCEDURES = [];     // { cpt, desc, qty, allowed, adjPct, adjAllowed, lineTotal }

function parseCsv(text){
  const rows = [];
  let i=0, field="", row=[], inQuotes=false;

  while (i < text.length){
    const c = text[i];

    if (inQuotes){
      if (c === '"'){
        if (text[i+1] === '"'){ field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    } else {
      if (c === '"'){ inQuotes = true; i++; continue; }
      if (c === ","){ row.push(field); field=""; i++; continue; }
      if (c === "\n"){
        row.push(field); field="";
        rows.push(row); row=[];
        i++; continue;
      }
      if (c === "\r"){ i++; continue; }
      field += c; i++; continue;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function normalizeHeader(h){
  return String(h||"").trim().toLowerCase().replaceAll(" ", "");
}

function loadFeeScheduleFromCsv(csvText){
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error("CSV is empty");

  const header = rows[0].map(normalizeHeader);
  const idxCpt = header.findIndex(h => h === "cpt");
  const idxDesc = header.findIndex(h => h === "description" || h === "desc");
  const idxAllowed = header.findIndex(h => ["allowed","allowedamount","allowable"].includes(h));

  if (idxCpt < 0 || idxAllowed < 0){
    throw new Error("CSV missing required columns. Need CPT and Allowed/AllowedAmount/Allowable.");
  }

  const map = new Map();
  for (let r=1; r<rows.length; r++){
    const line = rows[r];
    const cpt = String(line[idxCpt] || "").trim();
    if (!cpt) continue;

    const desc = idxDesc >= 0 ? String(line[idxDesc] || "").trim() : "";
    const allowedRaw = String(line[idxAllowed] || "").trim().replaceAll("$","");
    const allowed = Number(allowedRaw || 0);

    if (!Number.isFinite(allowed)) continue;
    map.set(cpt, { cpt, desc, allowed });
  }

  FEE_MAP = map;
}

function setFeeLoadedText(text){
  const el = $("feeLoadedText");
  if (el) el.textContent = text;
}

function renderFeePreview(){
  const tbody = $("feePreviewTbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  const arr = Array.from(FEE_MAP.values()).slice(0, 100);

  if (!arr.length){
    tbody.innerHTML = `<tr><td colspan="3" class="muted">No data yet.</td></tr>`;
    return;
  }

  for (const x of arr){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${x.cpt}</td>
      <td>${x.desc || ""}</td>
      <td class="right">${money(x.allowed)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderProcedures(){
  const tbody = $("procTbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!PROCEDURES.length){
    tbody.innerHTML = `<tr><td colspan="8" class="muted">No procedures yet.</td></tr>`;
    return;
  }

  PROCEDURES.forEach((p, idx) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><input data-field="cpt" data-idx="${idx}" value="${p.cpt || ""}" placeholder="e.g. 27447"/></td>
      <td><input data-field="desc" data-idx="${idx}" value="${p.desc || ""}" placeholder="Auto from fee schedule"/></td>
      <td><input data-field="qty" data-idx="${idx}" type="number" min="1" step="1" value="${p.qty || 1}"/></td>
      <td class="right">${money(p.allowed || 0)}</td>
      <td class="right">${Math.round((p.adjPct || 1) * 100)}%</td>
      <td class="right">${money(p.adjAllowed || 0)}</td>
      <td class="right">${money(p.lineTotal || 0)}</td>
      <td class="right"><button class="btn secondary" data-del="${idx}">Remove</button></td>
    `;

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input[data-field]").forEach(inp => {
    inp.addEventListener("input", () => {
      const idx = parseInt(inp.getAttribute("data-idx"), 10);
      const field = inp.getAttribute("data-field");
      let val = inp.value;

      if (field === "qty") val = Math.max(1, parseInt(val || "1", 10) || 1);
      PROCEDURES[idx][field] = val;

      if (field === "cpt"){
        const hit = FEE_MAP.get(String(val).trim());
        if (hit){
          PROCEDURES[idx].desc = hit.desc || PROCEDURES[idx].desc || "";
          PROCEDURES[idx].allowed = Number(hit.allowed || 0);
        } else {
          PROCEDURES[idx].allowed = 0;
        }
      }
      recalcAll();
      renderProcedures();
    });
  });

  tbody.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-del"), 10);
      PROCEDURES.splice(idx, 1);
      recalcAll();
      renderProcedures();
    });
  });
}

function computeMultiProcAdjPct(orderIndex){
  return orderIndex === 0 ? 1.0 : 0.5;
}

function recalcAll(){
  for (const p of PROCEDURES){
    const hit = FEE_MAP.get(String(p.cpt||"").trim());
    if (hit){
      p.allowed = Number(hit.allowed || 0);
      if (!p.desc) p.desc = hit.desc || "";
    } else {
      p.allowed = Number(p.allowed || 0) || 0;
    }
    p.qty = Math.max(1, parseInt(p.qty || "1", 10) || 1);
  }

  const sorted = PROCEDURES
    .map((p,i)=>({p,i}))
    .sort((a,b)=> (b.p.allowed||0) - (a.p.allowed||0));

  sorted.forEach((x, orderIndex) => {
    const pct = computeMultiProcAdjPct(orderIndex);
    x.p.adjPct = pct;
    x.p.adjAllowed = (x.p.allowed || 0) * pct;
    x.p.lineTotal = x.p.adjAllowed * (x.p.qty || 1);
  });

  const totalAllowed = PROCEDURES.reduce((sum,p)=> sum + (p.lineTotal||0), 0);

  const copay = Number($("copay")?.value || 0);
  const dedRemaining = Number($("deductibleRemaining")?.value || 0);
  const coinsPct = Number($("coinsurancePct")?.value || 0);
  const oopRemaining = Number($("oopMaxRemaining")?.value || 0);

  const dedApplied = Math.min(dedRemaining, totalAllowed);
  const afterDed = Math.max(0, totalAllowed - dedApplied);
  const coinsuranceAmt = afterDed * coinsPct;

  let due = copay + dedApplied + coinsuranceAmt;
  if (oopRemaining > 0) due = Math.min(due, oopRemaining);

  const recommendedDeposit = due;

  $("kTotalAllowed").textContent = money(totalAllowed);
  $("kDedApplied").textContent = money(dedApplied);
  $("kCoinsurance").textContent = money(coinsuranceAmt);
  $("kCopay").textContent = money(copay);
  $("kDue").textContent = money(due);
  $("kDeposit").textContent = money(recommendedDeposit);

  window.__QUOTE_TOTALS = {
    totalAllowed,
    deductibleApplied: dedApplied,
    coinsuranceAmount: coinsuranceAmt,
    copay,
    estimatedOwes: due,
    recommendedDeposit
  };
}

// -------------------- quote save + history --------------------
async function saveQuote(){
  const payload = {
    patientName: $("patientName")?.value || "",
    insurancePlan: $("insurancePlan")?.value || "",
    preparedBy: $("preparedBy")?.value || "",
    clinic: $("clinic")?.value || "",
    provider: $("provider")?.value || "",
    copay: Number($("copay")?.value || 0),
    deductibleRemaining: Number($("deductibleRemaining")?.value || 0),
    coinsurancePct: Number($("coinsurancePct")?.value || 0),
    oopMaxRemaining: Number($("oopMaxRemaining")?.value || 0),
    procedures: PROCEDURES,
    totals: window.__QUOTE_TOTALS || {}
  };

  const res = await fetchJson("/api/quotes", {
    method:"POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(res.error || "Save failed");
  return res;
}

let QH_ITEMS = [];

function renderQuoteHistory(items){
  const tbody = $("qhTbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!items || !items.length){
    tbody.innerHTML = `<tr><td colspan="8" class="muted">No data yet.</td></tr>`;
    return;
  }

  for (const x of items){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${x.createdAtLocal || x.createdAt || ""}</td>
      <td>${x.patientName || ""}</td>
      <td>${x.provider || ""}</td>
      <td>${x.clinic || ""}</td>
      <td>${x.createdBy || ""}</td>
      <td class="right">${money(x.recommendedDeposit || 0)}</td>
      <td class="right">${money(x.estimatedOwes || 0)}</td>
      <td>${x.quoteId ? "✓" : ""}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function loadQuoteHistory(){
  clearQhError();

  const from = $("qhFrom")?.value || "";
  const to = $("qhTo")?.value || "";
  const take = Math.max(1, Math.min(parseInt($("qhTake")?.value || "50", 10) || 50, 200));

  const q = $("qhSearch")?.value?.trim() || "";
  const staff = $("qhStaff")?.value?.trim() || "";
  const clinic = $("qhClinic")?.value?.trim() || "";
  const provider = $("qhProvider")?.value?.trim() || "";

  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  qs.set("take", String(take));
  if (q) qs.set("q", q);
  if (staff) qs.set("staff", staff);
  if (clinic) qs.set("clinic", clinic);
  if (provider) qs.set("provider", provider);

  const data = await fetchJson("/api/quotes?" + qs.toString());

  if (!data || data.ok !== true || !Array.isArray(data.items)){
    throw new Error("Unexpected response from /api/quotes\n" + JSON.stringify(data, null, 2));
  }

  QH_ITEMS = data.items;
  renderQuoteHistory(QH_ITEMS);
}

function exportQuoteHistory(){
  const headers = [
    "createdAt","createdAtLocal","patientName","provider","clinic","createdBy",
    "recommendedDeposit","estimatedOwes","quoteId","partitionKey","rowKey"
  ];
  downloadCsv("quote-history.csv", headers, QH_ITEMS || []);
}

// -------------------- fee schedule auto-load logic --------------------
function applyFeeSchedule(csvText, label){
  loadFeeScheduleFromCsv(csvText);
  setFeeLoadedText(`${FEE_MAP.size} CPTs loaded${label ? " (" + label + ")" : ""}`);
  renderFeePreview();
  recalcAll();
  renderProcedures();
}

async function autoLoadFeeSchedule(){
  // 1) localStorage cache
  const cached = loadFeeScheduleCsv();
  if (cached){
    try{
      applyFeeSchedule(cached, "cached");
      return;
    } catch (e){
      console.warn("Cached fee schedule failed to parse; clearing cache.", e);
      clearFeeScheduleCsv();
    }
  }

  // 2) fallback: fetch feeSchedule.sample.csv
  try{
    const sample = await fetchText(DEFAULT_FEE_URL);
    applyFeeSchedule(sample, "sample");
    // cache it so it persists
    saveFeeScheduleCsv(sample);
    return;
  } catch (e){
    console.warn("No sample fee schedule available.", e);
  }

  // 3) nothing
  setFeeLoadedText("No fee schedule loaded");
  renderFeePreview();
}

// -------------------- init + events --------------------
document.addEventListener("DOMContentLoaded", async () => {
  $("logoutBtn").onclick = () => window.location.href = "/.auth/logout";

  $("addProcBtn").onclick = () => {
    PROCEDURES.push({ cpt:"", desc:"", qty:1, allowed:0, adjPct:1, adjAllowed:0, lineTotal:0 });
    recalcAll();
    renderProcedures();
  };

  $("resetBtn").onclick = () => {
    PROCEDURES = [];
    recalcAll();
    renderProcedures();
  };

  $("saveQuoteBtn").onclick = async () => {
    try{
      const res = await saveQuote();
      alert(`Saved quote ${res.quoteId}`);
      await loadQuoteHistory();
    } catch (e){
      console.error(e);
      alert(e.message || String(e));
    }
  };

  $("qhRefreshBtn").onclick = async () => {
    try { await loadQuoteHistory(); }
    catch(e){
      console.error(e);
      showQhError(e.message || String(e));
      $("qhTbody").innerHTML = `<tr><td colspan="8">Error: ${String(e.message || e)}</td></tr>`;
    }
  };

  $("qhExportBtn").onclick = () => exportQuoteHistory();

  $("qhTodayBtn").onclick = async () => {
    const today = toYmdLocal(new Date());
    $("qhFrom").value = today;
    $("qhTo").value = today;
    $("qhRefreshBtn").click();
  };

  $("qhWeekBtn").onclick = async () => {
    const now = new Date();
    const start = startOfWeek(now);
    $("qhFrom").value = toYmdLocal(start);
    $("qhTo").value = toYmdLocal(now);
    $("qhRefreshBtn").click();
  };

  ["copay","deductibleRemaining","coinsurancePct","oopMaxRemaining"].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener("input", () => { recalcAll(); renderProcedures(); });
  });

  // Upload + persist fee schedule
  $("feeFile").addEventListener("change", async () => {
    const file = $("feeFile").files?.[0];
    if (!file) return;

    try{
      const text = await file.text();
      applyFeeSchedule(text, "uploaded");
      saveFeeScheduleCsv(text); // overwrite cache
    } catch(e){
      console.error(e);
      alert(e.message || String(e));
    }
  });

  // defaults
  const today = toYmdLocal(new Date());
  $("qhFrom").value = today;
  $("qhTo").value = today;

  // init procedures + totals
  recalcAll();
  renderProcedures();

  // ✅ load auth + fee schedule + history
  try { await loadAuth(); } catch(e){ console.error(e); }

  try { await autoLoadFeeSchedule(); } catch(e){ console.error(e); }

  try { await loadQuoteHistory(); }
  catch(e){
    console.error(e);
    showQhError(e.message || String(e));
  }
});

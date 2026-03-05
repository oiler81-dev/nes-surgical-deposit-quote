/* =========================
   STATE + HELPERS
   ========================= */
const state = {
  feeMap: new Map(),
  rows: [],
  maxRows: 10,
  lastHistoryItems: [],
  adminLastExport: []
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
  if (!el) return 0;
  const v = parseFloat(String(el.value || "").replace(/,/g,""));
  return Number.isFinite(v) ? v : 0;
}
function normalizeHeader(h){
  return String(h || "").trim().toLowerCase().replace(/\s+/g,"").replace(/[_-]/g,"");
}
function normalizeCpt(raw){
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/^'+|'+$/g, "").replace(/"/g,"");
  if (/^\d+(\.\d+)?$/.test(s)) s = String(parseInt(s, 10));
  return s.trim();
}
function parseMoney(raw){
  let s = String(raw ?? "").trim();
  if (!s) return 0;
  s = s.replace(/[\u00A0\u202F\u2007]/g, " ").trim();
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")){
    negative = true;
    s = s.slice(1,-1);
  }
  s = s.replace(/[$,]/g,"").replace(/\s/g,"");
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

/* =========================
   CSV PARSING
   ========================= */
function splitCSVLine(line){
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i=0;i<line.length;i++){
    const ch = line[i];
    if (ch === '"'){
      if (inQuotes && line[i+1] === '"'){ cur += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes){
      out.push(cur); cur=""; continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim());
}
function pickBestAllowedIndex(headersNorm, rows){
  const candidates = [];
  for (let i=0;i<headersNorm.length;i++){
    const h = headersNorm[i];
    if (h.includes("allowed") || h.includes("allowable")) candidates.push(i);
  }
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates[0];

  const sampleN = Math.min(rows.length, 40);
  let bestIdx = candidates[0];
  let bestScore = -1;

  for (const idx of candidates){
    let numericCount=0, nonEmptyCount=0, magnitude=0;
    for (let r=0;r<sampleN;r++){
      const val = rows[r][idx];
      const s = String(val ?? "").trim();
      if (s) nonEmptyCount++;
      const m = parseMoney(val);
      if (Number.isFinite(m) && m !== 0){
        numericCount++;
        magnitude += Math.abs(m);
      }
    }
    const score = (numericCount * 1000000) + (nonEmptyCount * 1000) + magnitude;
    if (score > bestScore){ bestScore = score; bestIdx = idx; }
  }
  return bestIdx;
}
function parseCSV(text){
  const lines = text.replace(/\uFEFF/g,"").split(/\r?\n/).filter(l => l.trim().length>0);
  if (lines.length < 2) return [];

  const headersRaw = splitCSVLine(lines[0]);
  const headersNorm = headersRaw.map(normalizeHeader);

  const rows = [];
  for (let i=1;i<lines.length;i++) rows.push(splitCSVLine(lines[i]));

  const findHeaderIndex = (candidates) => {
    for (let i=0;i<headersNorm.length;i++){
      if (candidates.includes(headersNorm[i])) return i;
    }
    return -1;
  };

  const idxCpt = findHeaderIndex(["cpt","cptcode","procedurecode","code"]);
  const idxDesc = findHeaderIndex(["description","cptdescription","procedurename","name"]);
  const idxAllowed = pickBestAllowedIndex(headersNorm, rows);

  if (idxCpt === -1 || idxAllowed === -1){
    throw new Error("CSV must include CPT and an Allowed column (Allowed/AllowedAmount/Allowable).");
  }

  const out = [];
  for (const cols of rows){
    const cpt = normalizeCpt(cols[idxCpt]);
    if (!cpt) continue;
    const desc = idxDesc !== -1 ? String(cols[idxDesc] || "").trim() : "";
    const allowed = parseMoney(cols[idxAllowed]);
    out.push({ cpt, desc, allowed });
  }
  return out;
}

/* =========================
   ROWS / TABLE
   ========================= */
function initRows(){
  state.rows = [];
  for (let i=0;i<state.maxRows;i++){
    state.rows.push({
      idx:i+1,cpt:"",desc:"",qty:1,
      allowed:0,adjPct:0,adjAllowed:0,lineTotal:0,notFound:false
    });
  }
}
function renderCptList(){
  const dl = $("cptList");
  if (!dl) return;
  dl.innerHTML = "";
  for (const [cpt,v] of state.feeMap.entries()){
    const opt = document.createElement("option");
    opt.value = cpt;
    opt.label = v.desc || "";
    dl.appendChild(opt);
  }
}
function renderFeePreview(){
  if (!$("feeCount")) return;
  $("feeCount").textContent = String(state.feeMap.size);

  const table = $("feePreview");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  const entries = Array.from(state.feeMap.entries()).slice(0,50).map(([cpt,v]) => ({cpt,...v}));
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
function loadFeeSchedule(items){
  state.feeMap.clear();
  for (const it of items){
    state.feeMap.set(it.cpt, { desc: it.desc, allowed: it.allowed });
  }
  renderFeePreview();
  renderCptList();
  recalcAll();
}
function renderProcTable(){
  const tbody = $("procTbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  state.rows.forEach((r,i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.idx}</td>
      <td><input data-row="${i}" data-field="cpt" list="cptList" placeholder="e.g. 29881" value="${escapeHtml(r.cpt)}" /></td>
      <td data-row="${i}" data-out="desc"></td>
      <td class="num"><input data-row="${i}" data-field="qty" type="number" min="1" step="1" value="${r.qty}" /></td>
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

  if (field === "cpt") row.cpt = normalizeCpt(v);
  if (field === "qty"){
    const q = parseInt(v,10);
    row.qty = Number.isFinite(q) && q>0 ? q : 1;
  }
  recalcAll();
}
function renderProcOutputs(){
  const tbody = $("procTbody");
  if (!tbody) return;

  for (let i=0;i<state.rows.length;i++){
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
    if (allowedCell) allowedCell.textContent = money(r.allowed||0);
    if (adjPctCell) adjPctCell.textContent = r.adjPct ? pct(r.adjPct) : "—";
    if (adjAllowedCell) adjAllowedCell.textContent = money(r.adjAllowed||0);
    if (lineTotalCell) lineTotalCell.textContent = money(r.lineTotal||0);
  }
}

/* =========================
   PRINT RENDER
   ========================= */
function renderPrintable(calc){
  if (!$("printDate")) return;

  const today = new Date();
  $("printDate").textContent = today.toLocaleDateString();

  $("printPatient").textContent = $("patientName")?.value || "";
  $("printInsurance").textContent = $("insurancePlan")?.value || "";
  $("printPreparedBy").textContent = $("preparedBy")?.value || "";
  $("printClinic").textContent = $("clinic")?.value || "";
  if ($("printProvider")) $("printProvider").textContent = $("provider")?.value || "";

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
      <td class="num">${money(r.adjAllowed||0)}</td>
      <td class="num">${money(r.lineTotal||0)}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* =========================
   CALC
   ========================= */
function recalcAll(){
  for (const r of state.rows){
    const cpt = normalizeCpt(r.cpt);
    r.cpt = cpt;
    if (!cpt){ r.desc=""; r.allowed=0; r.notFound=false; continue; }
    const hit = state.feeMap.get(cpt);
    r.desc = hit ? hit.desc : "";
    r.allowed = hit ? hit.allowed : 0;
    r.notFound = !hit;
  }

  let seen = 0;
  for (const r of state.rows){
    if (r.cpt){
      seen += 1;
      r.adjPct = (seen === 1) ? 1.0 : 0.5;
    } else r.adjPct = 0;
    r.adjAllowed = r.adjPct ? (r.allowed * r.adjPct) : 0;
    r.lineTotal = (r.qty || 1) * r.adjAllowed;
  }

  const totalAllowed = state.rows.reduce((sum,r) => sum + (r.lineTotal || 0), 0);

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

  if ($("totalAllowed")) $("totalAllowed").textContent = money(totalAllowed);
  if ($("dedApplied")) $("dedApplied").textContent = money(dedApplied);
  if ($("coinsAmt")) $("coinsAmt").textContent = money(coinsAmt);
  if ($("copayOut")) $("copayOut").textContent = money(copay);
  if ($("estOwes")) $("estOwes").textContent = money(estOwes);
  if ($("recDeposit")) $("recDeposit").textContent = money(recDeposit);

  renderPrintable({ totalAllowed, dedApplied, coinsAmt, copay, estOwes, recDeposit, dedRem, coinsPct, oopRem });
}

/* =========================
   AUTH
   ========================= */
async function getMe(){
  try{
    const r = await fetch("/.auth/me", { credentials:"include" });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.clientPrincipal || null;
  } catch {
    return null;
  }
}
function hasRole(me, role){
  const roles = me?.userRoles || [];
  return roles.includes(role);
}
async function hydrateUserUI(){
  const me = await getMe();
  const who = $("whoAmI") || $("adminWhoAmI");
  if (who) who.textContent = me ? `Signed in: ${me.userDetails}` : "Signed in";

  if ($("preparedBy") && me && !$("preparedBy").value){
    $("preparedBy").value = me.userDetails || "";
  }

  const adminLink = $("adminLink");
  if (adminLink){
    adminLink.style.display = (me && hasRole(me,"admin")) ? "inline-block" : "none";
  }
}

/* =========================
   API WRAPPERS
   ========================= */
async function apiGet(path){
  const r = await fetch(path, { credentials:"include" });
  const text = await r.text();
  if (!r.ok) throw new Error(text || r.statusText);
  return text ? JSON.parse(text) : {};
}
async function apiPost(path, body){
  const r = await fetch(path, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    credentials:"include",
    body: JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text || r.statusText);
  return text ? JSON.parse(text) : {};
}

/* =========================
   QUOTE SAVE/LOAD (ROUTES FIXED)
   ========================= */
function buildQuotePayload(){
  return {
    patientName: $("patientName")?.value || "",
    insurancePlan: $("insurancePlan")?.value || "",
    preparedBy: $("preparedBy")?.value || "",
    clinic: $("clinic")?.value || "",
    provider: $("provider")?.value || "",
    copay: numVal($("copay")),
    deductibleRemaining: numVal($("dedRem")),
    coinsurancePct: numVal($("coinsPct")),
    oopMaxRemaining: numVal($("oopRem")),
    procedures: state.rows.filter(r => r.cpt).map(r => ({
      cpt: r.cpt, desc: r.desc, qty: r.qty,
      allowed: r.allowed, adjPct: r.adjPct,
      adjAllowed: r.adjAllowed, lineTotal: r.lineTotal
    })),
    totals: {
      totalAllowedAdjusted: parseMoney($("totalAllowed")?.textContent),
      deductibleApplied: parseMoney($("dedApplied")?.textContent),
      coinsuranceAmount: parseMoney($("coinsAmt")?.textContent),
      copay: parseMoney($("copayOut")?.textContent),
      estimatedOwes: parseMoney($("estOwes")?.textContent),
      recommendedDeposit: parseMoney($("recDeposit")?.textContent)
    }
  };
}

async function saveCurrentQuote(){
  const payload = buildQuotePayload();
  // ✅ your function endpoint
  const res = await apiPost("/api/createQuote", payload);
  alert(`Saved quote: ${res.quoteId}`);
  await loadQuoteHistory();
}

async function loadQuoteByKeys(partitionKey, quoteId){
  // ✅ your function endpoint uses query params
  const qs = new URLSearchParams({ partitionKey, quoteId });
  return await apiGet(`/api/getQuote?${qs.toString()}`);
}

function loadQuoteIntoUI(payload){
  if (!payload) return;

  $("patientName") && ($("patientName").value = payload.patientName || "");
  $("insurancePlan") && ($("insurancePlan").value = payload.insurancePlan || "");
  $("preparedBy") && ($("preparedBy").value = payload.preparedBy || "");
  $("clinic") && ($("clinic").value = payload.clinic || "");
  $("provider") && ($("provider").value = payload.provider || "");

  $("copay") && ($("copay").value = payload.copay ?? 0);
  $("dedRem") && ($("dedRem").value = payload.deductibleRemaining ?? 0);
  $("coinsPct") && ($("coinsPct").value = payload.coinsurancePct ?? 0.2);
  $("oopRem") && ($("oopRem").value = payload.oopMaxRemaining ?? 999999);

  initRows();
  const procs = payload.procedures || [];
  for (let i=0;i<Math.min(procs.length, state.rows.length); i++){
    state.rows[i].cpt = procs[i].cpt || "";
    state.rows[i].qty = procs[i].qty || 1;
  }
  renderProcTable();
  recalcAll();
}

/* =========================
   HISTORY (ROUTES FIXED)
   ========================= */
function ymd(d){
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function setHistoryRangeToday(){
  const d = new Date();
  $("historyFrom") && ($("historyFrom").value = ymd(d));
  $("historyTo") && ($("historyTo").value = ymd(d));
}
function setHistoryRangeThisWeek(){
  const d = new Date();
  const day = d.getDay();
  const diffToMon = (day === 0 ? 6 : day - 1);
  const mon = new Date(d);
  mon.setDate(d.getDate() - diffToMon);
  $("historyFrom") && ($("historyFrom").value = ymd(mon));
  $("historyTo") && ($("historyTo").value = ymd(d));
}
function buildHistoryQuery(){
  const params = new URLSearchParams();
  const take = Math.min(parseInt($("historyTake")?.value || "50",10) || 50, 200);
  params.set("take", String(take));

  const from = $("historyFrom")?.value || "";
  const to = $("historyTo")?.value || "";
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const staff = ($("historyStaff")?.value || "").trim();
  const clinic = ($("historyClinic")?.value || "").trim();
  const provider = ($("historyProvider")?.value || "").trim();
  const q = ($("historySearch")?.value || "").trim();

  if (staff) params.set("staff", staff);
  if (clinic) params.set("clinic", clinic);
  if (provider) params.set("provider", provider);
  if (q) params.set("q", q);

  return params.toString();
}

async function loadQuoteHistory(){
  const tbody = $("historyTbody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8">Loading…</td></tr>`;
  try{
    const qs = buildHistoryQuery();
    // ✅ your function endpoint
    const res = await apiGet(`/api/listQuotes?${qs}`);
    const items = res.items || [];
    state.lastHistoryItems = items;

    tbody.innerHTML = "";
    if (items.length === 0){
      tbody.innerHTML = `<tr><td colspan="8">No quotes found for the selected filters.</td></tr>`;
      return;
    }

    for (const it of items){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(it.createdAtLocal || it.createdAt || "")}</td>
        <td>${escapeHtml(it.patientName || "")}</td>
        <td>${escapeHtml(it.provider || "")}</td>
        <td>${escapeHtml(it.clinic || "")}</td>
        <td>${escapeHtml(it.createdBy || "")}</td>
        <td class="num">${money(Number(it.recommendedDeposit || 0))}</td>
        <td class="num">${money(Number(it.estimatedOwes || 0))}</td>
        <td><button class="btn btn--ghost btn--tiny" data-part="${escapeHtml(it.partitionKey)}" data-id="${escapeHtml(it.quoteId)}">Open</button></td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", async () => {
        const part = btn.getAttribute("data-part");
        const id = btn.getAttribute("data-id");
        const q = await loadQuoteByKeys(part, id);
        loadQuoteIntoUI(q.payload);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  } catch(err){
    tbody.innerHTML = `<tr><td colspan="8">Error: ${escapeHtml(err.message || String(err))}</td></tr>`;
  }
}

function exportHistoryCsv(){
  const items = state.lastHistoryItems || [];
  const headers = ["createdAt","patientName","provider","clinic","createdBy","recommendedDeposit","estimatedOwes","quoteId","partitionKey"];
  const rows = [headers.join(",")];

  for (const it of items){
    const row = headers.map(h => {
      const v = it[h] ?? "";
      const s = String(v).replaceAll('"','""');
      return `"${s}"`;
    }).join(",");
    rows.push(row);
  }

  const blob = new Blob([rows.join("\n")], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nes_quote_history_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =========================
   SIMPLE CANVAS CHARTS
   ========================= */
function drawBarChart(canvasId, items, labelKey, valueKey, topN=10){
  const c = $(canvasId);
  if (!c) return;
  const ctx = c.getContext("2d");

  const data = (items || []).slice(0, topN);
  const labels = data.map(x => String(x[labelKey] || ""));
  const values = data.map(x => Number(x[valueKey] || 0));

  ctx.clearRect(0,0,c.width,c.height);

  const w = c.width;
  const h = c.height;
  const pad = 36;
  const maxV = Math.max(...values, 1);

  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad/2);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad/2, h - pad);
  ctx.stroke();

  const barW = (w - pad*1.5) / Math.max(values.length, 1);
  for (let i=0;i<values.length;i++){
    const v = values[i];
    const x = pad + i*barW + barW*0.12;
    const bw = barW*0.76;
    const bh = (h - pad*1.5) * (v / maxV);
    const y = (h - pad) - bh;

    ctx.fillRect(x, y, bw, bh);

    const lbl = labels[i].length > 14 ? labels[i].slice(0,14)+"…" : labels[i];
    ctx.save();
    ctx.translate(x + bw/2, h - pad + 12);
    ctx.rotate(-0.35);
    ctx.textAlign = "center";
    ctx.font = "12px Arial";
    ctx.fillText(lbl, 0, 0);
    ctx.restore();
  }
}
function drawLineChart(canvasId, items, xKey, yKey){
  const c = $(canvasId);
  if (!c) return;
  const ctx = c.getContext("2d");

  const data = (items || []).slice().sort((a,b) => String(a[xKey]).localeCompare(String(b[xKey])));
  const xs = data.map(d => String(d[xKey] || ""));
  const ys = data.map(d => Number(d[yKey] || 0));

  ctx.clearRect(0,0,c.width,c.height);

  const w = c.width;
  const h = c.height;
  const pad = 40;

  const maxY = Math.max(...ys, 1);

  ctx.beginPath();
  ctx.moveTo(pad, pad/2);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad/2, h - pad);
  ctx.stroke();

  if (ys.length < 2) return;

  const stepX = (w - pad*1.5) / (ys.length - 1);

  ctx.beginPath();
  for (let i=0;i<ys.length;i++){
    const x = pad + i*stepX;
    const y = (h - pad) - ((h - pad*1.5) * (ys[i] / maxY));
    if (i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  }
  ctx.stroke();

  for (let i=0;i<ys.length;i++){
    const x = pad + i*stepX;
    const y = (h - pad) - ((h - pad*1.5) * (ys[i] / maxY));
    ctx.beginPath();
    ctx.arc(x,y,2.5,0,Math.PI*2);
    ctx.fill();

    if (i===0 || i===ys.length-1 || (ys.length>6 && i%Math.ceil(ys.length/6)===0)){
      const lbl = xs[i];
      ctx.font = "12px Arial";
      ctx.textAlign = "center";
      ctx.fillText(lbl, x, h - pad + 14);
    }
  }
}

/* =========================
   ADMIN DASHBOARD (ROUTE FIXED)
   ========================= */
function setAdminRangeToday(){
  const d = new Date();
  $("adminFrom") && ($("adminFrom").value = ymd(d));
  $("adminTo") && ($("adminTo").value = ymd(d));
}
function setAdminRangeThisWeek(){
  const d = new Date();
  const day = d.getDay();
  const diffToMon = (day === 0 ? 6 : day - 1);
  const mon = new Date(d);
  mon.setDate(d.getDate() - diffToMon);
  $("adminFrom") && ($("adminFrom").value = ymd(mon));
  $("adminTo") && ($("adminTo").value = ymd(d));
}
function buildAdminQuery(){
  const params = new URLSearchParams();
  const from = $("adminFrom")?.value || "";
  const to = $("adminTo")?.value || "";
  const clinic = ($("adminClinic")?.value || "").trim();
  const provider = ($("adminProvider")?.value || "").trim();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (clinic) params.set("clinic", clinic);
  if (provider) params.set("provider", provider);
  return params.toString();
}
function renderAggTable(tbodyId, items, labelKey){
  const tbody = $(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!items || items.length === 0){
    tbody.innerHTML = `<tr><td colspan="4">No data</td></tr>`;
    return;
  }

  for (const it of items){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(it[labelKey] || "")}</td>
      <td class="num">${Number(it.quotes || 0)}</td>
      <td class="num">${money(Number(it.deposits || 0))}</td>
      <td class="num">${money(Number(it.due || 0))}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function loadAdminReport(){
  if (!$("sumQuotes")) return;

  $("sumQuotes").textContent = "…";
  $("sumDeposits").textContent = "…";
  $("sumDue").textContent = "…";

  const qs = buildAdminQuery();

  try{
    // ✅ your function endpoint
    const res = await apiGet(`/api/reportSummary?${qs}`);

    $("sumQuotes").textContent = String(res.summary?.quotes || 0);
    $("sumDeposits").textContent = money(Number(res.summary?.deposits || 0));
    $("sumDue").textContent = money(Number(res.summary?.due || 0));

    renderAggTable("byStaffTbody", res.byStaff, "staff");
    renderAggTable("byClinicTbody", res.byClinic, "clinic");
    renderAggTable("byProviderTbody", res.byProvider, "provider");
    renderAggTable("byDateTbody", res.byDate, "date");

    state.adminLastExport = res.exportItems || [];

    drawBarChart("chartDepositsByProvider", res.byProvider, "provider", "deposits", 10);
    drawBarChart("chartQuotesByStaff", res.byStaff, "staff", "quotes", 10);
    drawLineChart("chartDepositsByDate", res.byDate, "date", "deposits");

  } catch(err){
    alert(`Admin report error: ${err.message || err}`);
  }
}

function exportAdminCsv(){
  const items = state.adminLastExport || [];
  const headers = ["date","createdAt","patientName","provider","clinic","createdBy","recommendedDeposit","estimatedOwes","quoteId"];
  const rows = [headers.join(",")];

  for (const it of items){
    const row = headers.map(h => {
      const v = it[h] ?? "";
      const s = String(v).replaceAll('"','""');
      return `"${s}"`;
    }).join(",");
    rows.push(row);
  }

  const blob = new Blob([rows.join("\n")], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nes_admin_report_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =========================
   WIRING
   ========================= */
function hookInputs(){
  ["patientName","insurancePlan","preparedBy","clinic","provider","copay","dedRem","coinsPct","oopRem"]
    .forEach(id => $(id)?.addEventListener("input", recalcAll));
}
function resetAll(){
  $("patientName") && ($("patientName").value = "");
  $("insurancePlan") && ($("insurancePlan").value = "");
  $("clinic") && ($("clinic").value = "");
  $("provider") && ($("provider").value = "");
  $("copay") && ($("copay").value = "0");
  $("dedRem") && ($("dedRem").value = "0");
  $("coinsPct") && ($("coinsPct").value = "0.20");
  $("oopRem") && ($("oopRem").value = "999999");

  initRows();
  renderProcTable();
  recalcAll();
}
function initFeeUpload(){
  const feeFile = $("feeFile");
  if (!feeFile) return;
  feeFile.addEventListener("change", async (e) => {
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
async function loadSampleFeeSchedule(){
  try{
    const res = await fetch("feeSchedule.sample.csv", { cache:"no-store" });
    if (!res.ok) return;
    const text = await res.text();
    const items = parseCSV(text);
    loadFeeSchedule(items);
  } catch {}
}
function initButtons(){
  $("btnPrint")?.addEventListener("click", () => window.print());
  $("btnReset")?.addEventListener("click", () => {
    if (confirm("Reset quote inputs and CPT lines?")) resetAll();
  });
  $("btnSaveQuote")?.addEventListener("click", () => saveCurrentQuote());

  $("btnToday")?.addEventListener("click", async () => { setHistoryRangeToday(); await loadQuoteHistory(); });
  $("btnThisWeek")?.addEventListener("click", async () => { setHistoryRangeThisWeek(); await loadQuoteHistory(); });
  $("btnHistoryRefresh")?.addEventListener("click", () => loadQuoteHistory());
  $("btnHistoryExport")?.addEventListener("click", () => exportHistoryCsv());

  let t = null;
  const onHistChange = () => {
    clearTimeout(t);
    t = setTimeout(() => loadQuoteHistory(), 300);
  };
  ["historySearch","historyStaff","historyClinic","historyProvider","historyFrom","historyTo","historyTake"].forEach(id => {
    $(id)?.addEventListener("input", onHistChange);
    $(id)?.addEventListener("change", onHistChange);
  });

  $("btnAdminToday")?.addEventListener("click", async () => { setAdminRangeToday(); await loadAdminReport(); });
  $("btnAdminThisWeek")?.addEventListener("click", async () => { setAdminRangeThisWeek(); await loadAdminReport(); });
  $("btnAdminRefresh")?.addEventListener("click", () => loadAdminReport());
  $("btnAdminExport")?.addEventListener("click", () => exportAdminCsv());

  ["adminFrom","adminTo","adminClinic","adminProvider"].forEach(id => {
    $(id)?.addEventListener("change", () => loadAdminReport());
    $(id)?.addEventListener("input", () => loadAdminReport());
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
  hydrateUserUI();

  if ($("historyFrom") && $("historyTo")){
    const d = new Date();
    const from = new Date(d);
    from.setDate(d.getDate() - 7);
    $("historyFrom").value = ymd(from);
    $("historyTo").value = ymd(d);
    loadQuoteHistory();
  }

  if ($("adminFrom") && $("adminTo")){
    setAdminRangeThisWeek();
    loadAdminReport();
  }
})();

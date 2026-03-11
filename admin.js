const $ = (id) => document.getElementById(id);

const state = {
  items: [],
  providers: []
};

function money(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function parseNum(x) {
  const v = parseFloat(String(x ?? "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
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

async function loadProviders() {
  const data = await apiGet("/api/providers");
  const providers = data && Array.isArray(data.providers) ? data.providers : [];
  state.providers = providers;

  const host = $("adminProviderList");
  if (!host) return;

  host.innerHTML = providers
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map(p => `<option value="${escapeHtml(p)}"></option>`)
    .join("");
}

function loadLocalHistory() {
  try {
    return JSON.parse(localStorage.getItem("nes_estimate_history_v4") || "[]");
  } catch {
    return [];
  }
}

function getFilters() {
  return {
    from: $("filterFrom")?.value || "",
    to: $("filterTo")?.value || "",
    type: ($("filterType")?.value || "").trim().toLowerCase(),
    basis: ($("filterBasis")?.value || "").trim().toLowerCase(),
    provider: ($("filterProvider")?.value || "").trim().toLowerCase(),
    clinic: ($("filterClinic")?.value || "").trim().toLowerCase(),
    staff: ($("filterStaff")?.value || "").trim().toLowerCase(),
    orthoticPayer: ($("filterOrthoticPayer")?.value || "").trim().toLowerCase(),
    patient: ($("filterPatient")?.value || "").trim().toLowerCase(),
    take: Math.max(1, Math.min(5000, Math.floor(parseNum($("filterTake")?.value || 5000)) || 5000))
  };
}

function itemDateYmd(q) {
  const raw = q.quoteDate || q.savedAt;
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function quoteTypeLabel(q) {
  return q.estimateType === "orthotics" ? "Orthotics" : "Surgical / Procedure";
}

function quoteBasisLabel(q) {
  if (q.estimateType !== "orthotics") return "";
  return q.orthoticBasis === "selfPay" ? "Self-Pay" : "Insurance";
}

function applyFilters(items) {
  const f = getFilters();

  return items.filter(q => {
    const ymd = itemDateYmd(q);
    const provider = String(q.provider || q.rows?.[0]?.provider || "").toLowerCase();
    const clinic = String(q.clinic || "").toLowerCase();
    const staff = String(q.preparedBy || "").toLowerCase();
    const type = String(q.estimateType || "surgical").toLowerCase();
    const basis = String(q.orthoticBasis || "").toLowerCase();
    const orthoticPayer = String(q.orthoticPayer || "").toLowerCase();
    const patient = String(q.patientName || "").toLowerCase();

    if (f.from && ymd && ymd < f.from) return false;
    if (f.to && ymd && ymd > f.to) return false;
    if (f.type && type !== f.type) return false;
    if (f.basis && basis !== f.basis) return false;
    if (f.provider && !provider.includes(f.provider)) return false;
    if (f.clinic && !clinic.includes(f.clinic)) return false;
    if (f.staff && !staff.includes(f.staff)) return false;
    if (f.orthoticPayer && !orthoticPayer.includes(f.orthoticPayer)) return false;
    if (f.patient && !patient.includes(f.patient)) return false;

    return true;
  }).slice(0, f.take);
}

async function loadItems() {
  const take = Math.max(1, Math.min(5000, Math.floor(parseNum($("filterTake")?.value || 5000)) || 5000));
  const api = await apiGet(`/api/quotes?take=${take}`);
  if (api && Array.isArray(api.items)) {
    state.items = api.items;
    return;
  }

  state.items = loadLocalHistory();
}

function renderSummary(items) {
  const quoteCount = items.length;
  const estDue = items.reduce((s, q) => s + parseNum(q.estimatedDue || 0), 0);
  const recDep = items.reduce((s, q) => s + parseNum(q.recommendedDeposit || 0), 0);
  const avgDep = quoteCount ? recDep / quoteCount : 0;

  const surgicalQuotes = items.filter(q => (q.estimateType || "surgical") === "surgical").length;
  const orthoticsQuotes = items.filter(q => q.estimateType === "orthotics").length;
  const orthoticsInsurance = items.filter(q => q.estimateType === "orthotics" && q.orthoticBasis === "insurance").length;
  const orthoticsSelfPay = items.filter(q => q.estimateType === "orthotics" && q.orthoticBasis === "selfPay").length;

  $("kpiQuotes").textContent = String(quoteCount);
  $("kpiEstDue").textContent = money(estDue);
  $("kpiRecDep").textContent = money(recDep);
  $("kpiAvgDep").textContent = money(avgDep);
  $("kpiSurgicalQuotes").textContent = String(surgicalQuotes);
  $("kpiOrthoticsQuotes").textContent = String(orthoticsQuotes);
  $("kpiOrthoticsInsurance").textContent = String(orthoticsInsurance);
  $("kpiOrthoticsSelfPay").textContent = String(orthoticsSelfPay);
}

function renderProviderSummary(items) {
  const map = new Map();

  items.forEach(q => {
    const provider = q.provider || q.rows?.[0]?.provider || "Unassigned";
    const estDue = parseNum(q.estimatedDue || 0);
    const recDep = parseNum(q.recommendedDeposit || 0);
    const type = q.estimateType === "orthotics" ? "orthotics" : "surgical";

    if (!map.has(provider)) {
      map.set(provider, {
        provider,
        quotes: 0,
        surgical: 0,
        orthotics: 0,
        estDue: 0,
        recDep: 0
      });
    }

    const item = map.get(provider);
    item.quotes += 1;
    if (type === "orthotics") item.orthotics += 1;
    else item.surgical += 1;
    item.estDue += estDue;
    item.recDep += recDep;
  });

  const rows = Array.from(map.values()).sort((a, b) => b.recDep - a.recDep);
  const host = $("providerSummaryTbody");

  if (!rows.length) {
    host.innerHTML = `<tr><td colspan="6">No data yet.</td></tr>`;
    return;
  }

  host.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.provider)}</td>
      <td class="num">${r.quotes}</td>
      <td class="num">${r.surgical}</td>
      <td class="num">${r.orthotics}</td>
      <td class="num">${money(r.estDue)}</td>
      <td class="num">${money(r.recDep)}</td>
    </tr>
  `).join("");
}

function renderCodeSummary(items) {
  const map = new Map();

  items.forEach(q => {
    (q.rows || []).forEach(r => {
      const cpt = String(r.cpt || "").trim();
      const modifier = String(r.modifier || "").trim();
      if (!cpt) return;

      const key = `${cpt}__${modifier}`;
      if (!map.has(key)) {
        map.set(key, {
          cpt,
          modifier,
          desc: r.desc || "",
          qty: 0,
          billed: 0,
          allowed: 0,
          lineTotal: 0
        });
      }

      const item = map.get(key);
      item.qty += parseNum(r.qty || 1);
      item.billed += parseNum(r.billed || 0);
      item.allowed += parseNum(r.allowed || 0);
      item.lineTotal += parseNum(r.lineTotal || 0);
    });
  });

  const rows = Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  const host = $("cptSummaryTbody");

  if (!rows.length) {
    host.innerHTML = `<tr><td colspan="7">No data yet.</td></tr>`;
    return;
  }

  host.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.cpt)}</td>
      <td>${escapeHtml(r.modifier)}</td>
      <td>${escapeHtml(r.desc)}</td>
      <td class="num">${r.qty}</td>
      <td class="num">${money(r.billed)}</td>
      <td class="num">${money(r.allowed)}</td>
      <td class="num">${money(r.lineTotal)}</td>
    </tr>
  `).join("");
}

function renderDetail(items) {
  const host = $("detailTbody");

  if (!items.length) {
    host.innerHTML = `<tr><td colspan="11">No data yet.</td></tr>`;
    return;
  }

  host.innerHTML = items.map(q => {
    const dt = q.savedAt ? new Date(q.savedAt).toLocaleString() : "";
    const codes = (q.rows || [])
      .map(r => [r.cpt, r.modifier].filter(Boolean).join("-"))
      .filter(Boolean)
      .join(", ");

    return `
      <tr>
        <td>${escapeHtml(dt)}</td>
        <td>${escapeHtml(quoteTypeLabel(q))}</td>
        <td>${escapeHtml(quoteBasisLabel(q))}</td>
        <td>${escapeHtml(q.patientName || "")}</td>
        <td>${escapeHtml(q.provider || "")}</td>
        <td>${escapeHtml(q.clinic || "")}</td>
        <td>${escapeHtml(q.preparedBy || "")}</td>
        <td>${escapeHtml(q.orthoticPayer || "")}</td>
        <td class="num">${money(parseNum(q.estimatedDue || 0))}</td>
        <td class="num">${money(parseNum(q.recommendedDeposit || 0))}</td>
        <td>${escapeHtml(codes)}</td>
      </tr>
    `;
  }).join("");
}

function renderAll() {
  const filtered = applyFilters(state.items);
  renderSummary(filtered);
  renderProviderSummary(filtered);
  renderCodeSummary(filtered);
  renderDetail(filtered);
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

function exportCsv() {
  const items = applyFilters(state.items);
  if (!items.length) {
    alert("No data to export.");
    return;
  }

  const rows = [];
  rows.push([
    "SavedAt",
    "QuoteDate",
    "EstimateType",
    "OrthoticBasis",
    "OrthoticPayer",
    "OrthoticAllowableEach",
    "OrthoticSelfPayEach",
    "PatientName",
    "InsurancePlan",
    "PreparedBy",
    "Clinic",
    "Provider",
    "Copay",
    "DedRem",
    "CoinsPct",
    "OopRem",
    "TotalAllowed",
    "DedApplied",
    "CoinsAmt",
    "EstimatedDue",
    "InsuranceResponsibility",
    "RecommendedDeposit",
    "CPT",
    "Modifier",
    "Description",
    "Qty",
    "Billed",
    "Allowed",
    "AdjPct",
    "AdjAllowed",
    "LineTotal"
  ]);

  items.forEach(q => {
    (q.rows || []).forEach(r => {
      rows.push([
        q.savedAt || "",
        q.quoteDate || "",
        q.estimateType || "surgical",
        q.orthoticBasis || "",
        q.orthoticPayer || "",
        parseNum(q.orthoticAllowableEach || 0),
        parseNum(q.orthoticSelfPayEach || 0),
        q.patientName || "",
        q.insurancePlan || "",
        q.preparedBy || "",
        q.clinic || "",
        q.provider || "",
        parseNum(q.copay || 0),
        parseNum(q.dedRem || 0),
        parseNum(q.coinsPct || 0),
        parseNum(q.oopRem || 0),
        parseNum(q.totalAllowed || 0),
        parseNum(q.dedApplied || 0),
        parseNum(q.coinsAmt || 0),
        parseNum(q.estimatedDue || 0),
        parseNum(q.insuranceResponsibility || 0),
        parseNum(q.recommendedDeposit || 0),
        r.cpt || "",
        r.modifier || "",
        r.desc || "",
        parseNum(r.qty || 1),
        parseNum(r.billed || 0),
        parseNum(r.allowed || 0),
        parseNum(r.adjPct || 0),
        parseNum(r.adjAllowed || 0),
        parseNum(r.lineTotal || 0)
      ]);
    });
  });

  const csv = rows.map(r => r.map(csvCell).join(",")).join("\n");
  download(`admin_report_${todayYmd()}.csv`, csv, "text/csv");
}

function wire() {
  $("btnAdminRefresh")?.addEventListener("click", async () => {
    await loadItems();
    renderAll();
  });

  $("btnAdminExport")?.addEventListener("click", exportCsv);

  $("btnAdminToday")?.addEventListener("click", async () => {
    $("filterFrom").value = todayYmd();
    $("filterTo").value = todayYmd();
    renderAll();
  });

  $("btnAdminThisWeek")?.addEventListener("click", async () => {
    $("filterFrom").value = startOfWeekYmd();
    $("filterTo").value = todayYmd();
    renderAll();
  });

  [
    "filterFrom",
    "filterTo",
    "filterType",
    "filterBasis",
    "filterProvider",
    "filterClinic",
    "filterStaff",
    "filterOrthoticPayer",
    "filterPatient",
    "filterTake"
  ].forEach(id => {
    $(id)?.addEventListener("input", renderAll);
    $(id)?.addEventListener("change", renderAll);
  });
}

async function init() {
  $("filterTake").value = "5000";
  await loadProviders();
  await loadItems();
  wire();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);

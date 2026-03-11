const $ = (id) => document.getElementById(id);

const state = {
  report: null,
  providers: [],
  filteredItems: []
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

function getFilters() {
  return {
    from: $("filterFrom")?.value || "",
    to: $("filterTo")?.value || "",
    type: ($("filterType")?.value || "").trim(),
    basis: ($("filterBasis")?.value || "").trim(),
    provider: ($("filterProvider")?.value || "").trim(),
    clinic: ($("filterClinic")?.value || "").trim(),
    staff: ($("filterStaff")?.value || "").trim(),
    orthoticPayer: ($("filterOrthoticPayer")?.value || "").trim(),
    patient: ($("filterPatient")?.value || "").trim(),
    take: Math.max(1, Math.min(5000, Math.floor(parseNum($("filterTake")?.value || 5000)) || 5000))
  };
}

function buildReportUrl() {
  const f = getFilters();
  const params = new URLSearchParams();

  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.type) params.set("type", f.type);
  if (f.basis) params.set("basis", f.basis);
  if (f.provider) params.set("provider", f.provider);
  if (f.clinic) params.set("clinic", f.clinic);
  if (f.staff) params.set("staff", f.staff);
  if (f.orthoticPayer) params.set("orthoticPayer", f.orthoticPayer);
  if (f.patient) params.set("patient", f.patient);

  return `/api/reports/admin-report?${params.toString()}`;
}

async function loadReport() {
  const url = buildReportUrl();
  const data = await apiGet(url);

  if (!data || !data.ok) {
    state.report = null;
    state.filteredItems = [];
    return;
  }

  state.report = data;
  state.filteredItems = Array.isArray(data.exportItems)
    ? data.exportItems.slice(0, getFilters().take)
    : [];
}

function renderSummary() {
  const s = state.report?.summary || {
    quotes: 0,
    deposits: 0,
    due: 0,
    surgicalQuotes: 0,
    orthoticsQuotes: 0,
    orthoticsInsuranceQuotes: 0,
    orthoticsSelfPayQuotes: 0
  };

  $("kpiQuotes").textContent = String(s.quotes || 0);
  $("kpiEstDue").textContent = money(parseNum(s.due || 0));
  $("kpiRecDep").textContent = money(parseNum(s.deposits || 0));
  $("kpiAvgDep").textContent = money((s.quotes || 0) ? parseNum(s.deposits || 0) / s.quotes : 0);

  $("kpiSurgicalQuotes").textContent = String(s.surgicalQuotes || 0);
  $("kpiOrthoticsQuotes").textContent = String(s.orthoticsQuotes || 0);
  $("kpiOrthoticsInsurance").textContent = String(s.orthoticsInsuranceQuotes || 0);
  $("kpiOrthoticsSelfPay").textContent = String(s.orthoticsSelfPayQuotes || 0);
}

function renderProviderSummary() {
  const host = $("providerSummaryTbody");
  const rows = Array.isArray(state.report?.byProvider) ? state.report.byProvider : [];

  if (!rows.length) {
    host.innerHTML = `<tr><td colspan="6">No data yet.</td></tr>`;
    return;
  }

  host.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.provider || "")}</td>
      <td class="num">${parseNum(r.quotes || 0)}</td>
      <td class="num">${parseNum(r.surgical || 0)}</td>
      <td class="num">${parseNum(r.orthotics || 0)}</td>
      <td class="num">${money(parseNum(r.due || 0))}</td>
      <td class="num">${money(parseNum(r.deposits || 0))}</td>
    </tr>
  `).join("");
}

function renderCodeSummary() {
  const host = $("cptSummaryTbody");
  const items = state.filteredItems || [];
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

function quoteTypeLabel(q) {
  return q.estimateType === "orthotics" ? "Orthotics" : "Surgical / Procedure";
}

function quoteBasisLabel(q) {
  if (q.estimateType !== "orthotics") return "";
  return q.orthoticBasis === "selfPay" ? "Self-Pay" : "Insurance";
}

function renderDetail() {
  const host = $("detailTbody");
  const items = state.filteredItems || [];

  if (!items.length) {
    host.innerHTML = `<tr><td colspan="11">No data yet.</td></tr>`;
    return;
  }

  host.innerHTML = items.map(q => {
    const codes = (q.rows || [])
      .map(r => [r.cpt, r.modifier].filter(Boolean).join("-"))
      .filter(Boolean)
      .join(", ");

    const dt = q.savedAt ? new Date(q.savedAt).toLocaleString() : "";

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
  renderSummary();
  renderProviderSummary();
  renderCodeSummary();
  renderDetail();
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
  const items = state.filteredItems || [];
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
    await loadReport();
    renderAll();
  });

  $("btnAdminExport")?.addEventListener("click", exportCsv);

  $("btnAdminToday")?.addEventListener("click", async () => {
    $("filterFrom").value = todayYmd();
    $("filterTo").value = todayYmd();
    await loadReport();
    renderAll();
  });

  $("btnAdminThisWeek")?.addEventListener("click", async () => {
    $("filterFrom").value = startOfWeekYmd();
    $("filterTo").value = todayYmd();
    await loadReport();
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
    $(id)?.addEventListener("change", async () => {
      await loadReport();
      renderAll();
    });

    $(id)?.addEventListener("input", async () => {
      await loadReport();
      renderAll();
    });
  });
}

async function init() {
  $("filterTake").value = "5000";
  await loadProviders();
  await loadReport();
  wire();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);

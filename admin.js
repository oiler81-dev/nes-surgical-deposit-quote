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

function loadLocalHistory() {
  try {
    return JSON.parse(localStorage.getItem("nes_estimate_history_v3") || "[]");
  } catch {
    return [];
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
    provider: ($("filterProvider")?.value || "").trim().toLowerCase(),
    clinic: ($("filterClinic")?.value || "").trim().toLowerCase(),
    staff: ($("filterStaff")?.value || "").trim().toLowerCase(),
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

function applyFilters(items) {
  const f = getFilters();

  return items.filter(q => {
    const ymd = itemDateYmd(q);
    const provider = String(q.provider || q.rows?.[0]?.provider || "").toLowerCase();
    const clinic = String(q.clinic || "").toLowerCase();
    const staff = String(q.preparedBy || "").toLowerCase();

    if (f.from && ymd && ymd < f.from) return false;
    if (f.to && ymd && ymd > f.to) return false;
    if (f.provider && !provider.includes(f.provider)) return false;
    if (f.clinic && !clinic.includes(f.clinic)) return false;
    if (f.staff && !staff.includes(f.staff)) return false;

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
  const estDue = items.reduce((s, q) => s + parseNum(q.estimatedDue || q.estOwes || q.total || 0), 0);
  const recDep = items.reduce((s, q) => s + parseNum(q.recommendedDeposit || q.recDeposit || q.total || 0), 0);
  const avgDep = quoteCount ? recDep / quoteCount : 0;

  $("kpiQuotes").textContent = String(quoteCount);
  $("kpiEstDue").textContent = money(estDue);
  $("kpiRecDep").textContent = money(recDep);
  $("kpiAvgDep").textContent = money(avgDep);
}

function renderProviderSummary(items) {
  const map = new Map();

  items.forEach(q => {
    const provider = q.provider || q.rows?.[0]?.provider || "Unassigned";
    const estDue = parseNum(q.estimatedDue || q.estOwes || q.total || 0);
    const recDep = parseNum(q.recommendedDeposit || q.recDeposit || q.total || 0);

    if (!map.has(provider)) {
      map.set(provider, { provider, quotes: 0, estDue: 0, recDep: 0 });
    }

    const item = map.get(provider);
    item.quotes += 1;
    item.estDue += estDue;
    item.recDep += recDep;
  });

  const rows = Array.from(map.values()).sort((a, b) => b.recDep - a.recDep);
  const host = $("providerSummaryTbody");

  if (!rows.length) {
    host.innerHTML = `<tr><td colspan="4">No data yet.</td></tr>`;
    return;
  }

  host.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.provider)}</td>
      <td class="num">${r.quotes}</td>
      <td class="num">${money(r.estDue)}</td>
      <td class="num">${money(r.recDep)}</td>
    </tr>
  `).join("");
}

function renderCptSummary(items) {
  const map = new Map();

  items.forEach(q => {
    (q.rows || []).forEach(r => {
      const key = r.cpt || "";
      if (!key) return;

      if (!map.has(key)) {
        map.set(key, {
          cpt: key,
          desc: r.desc || "",
          qty: 0,
          allowed: 0,
          lineTotal: 0
        });
      }

      const item = map.get(key);
      item.qty += parseNum(r.qty || 1);
      item.allowed += parseNum(r.allowed ?? r.fee ?? 0);
      item.lineTotal += parseNum(r.lineTotal || 0);
    });
  });

  const rows = Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  const host = $("cptSummaryTbody");

  if (!rows.length) {
    host.innerHTML = `<tr><td colspan="5">No data yet.</td></tr>`;
    return;
  }

  host.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.cpt)}</td>
      <td>${escapeHtml(r.desc)}</td>
      <td class="num">${r.qty}</td>
      <td class="num">${money(r.allowed)}</td>
      <td class="num">${money(r.lineTotal)}</td>
    </tr>
  `).join("");
}

function renderDetail(items) {
  const host = $("detailTbody");

  if (!items.length) {
    host.innerHTML = `<tr><td colspan="8">No data yet.</td></tr>`;
    return;
  }

  host.innerHTML = items.map(q => {
    const provider = q.provider || q.rows?.[0]?.provider || "";
    const estDue = parseNum(q.estimatedDue || q.estOwes || q.total || 0);
    const recDep = parseNum(q.recommendedDeposit || q.recDeposit || q.total || 0);
    const cpts = (q.rows || []).map(r => r.cpt).filter(Boolean).join(", ");
    const dt = q.savedAt ? new Date(q.savedAt).toLocaleString() : "";

    return `
      <tr>
        <td>${escapeHtml(dt)}</td>
        <td>${escapeHtml(q.patientName || "")}</td>
        <td>${escapeHtml(provider)}</td>
        <td>${escapeHtml(q.clinic || "")}</td>
        <td>${escapeHtml(q.preparedBy || "")}</td>
        <td class="num">${money(estDue)}</td>
        <td class="num">${money(recDep)}</td>
        <td>${escapeHtml(cpts)}</td>
      </tr>
    `;
  }).join("");
}

function renderAll() {
  const filtered = applyFilters(state.items);
  renderSummary(filtered);
  renderProviderSummary(filtered);
  renderCptSummary(filtered);
  renderDetail(filtered);
}

function exportCsv() {
  const filtered = applyFilters(state.items);
  if (!filtered.length) {
    alert("No data to export.");
    return;
  }

  const rows = [];
  rows.push([
    "SavedAt",
    "PatientName",
    "InsurancePlan",
    "PreparedBy",
    "Clinic",
    "Provider",
    "EstimatedDue",
    "RecommendedDeposit",
    "CPT",
    "Description",
    "Qty",
    "Allowed",
    "AdjPct",
    "AdjAllowed",
    "LineTotal"
  ]);

  filtered.forEach(q => {
    const provider = q.provider || q.rows?.[0]?.provider || "";
    const estDue = parseNum(q.estimatedDue || q.estOwes || q.total || 0);
    const recDep = parseNum(q.recommendedDeposit || q.recDeposit || q.total || 0);

    (q.rows || []).forEach(r => {
      rows.push([
        q.savedAt || "",
        q.patientName || "",
        q.insurancePlan || "",
        q.preparedBy || "",
        q.clinic || "",
        provider,
        estDue,
        recDep,
        r.cpt || "",
        r.desc || "",
        parseNum(r.qty || 1),
        parseNum(r.allowed ?? r.fee ?? 0),
        parseNum(r.adjPct || 0),
        parseNum(r.adjAllowed || 0),
        parseNum(r.lineTotal || 0)
      ]);
    });
  });

  const csv = rows.map(r => r.map(csvCell).join(",")).join("\n");
  download(`admin_report_${todayYmd()}.csv`, csv, "text/csv");
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

function wire() {
  $("btnAdminRefresh")?.addEventListener("click", async () => {
    await loadItems();
    renderAll();
  });

  $("btnAdminExport")?.addEventListener("click", exportCsv);

  $("btnAdminToday")?.addEventListener("click", () => {
    $("filterFrom").value = todayYmd();
    $("filterTo").value = todayYmd();
    renderAll();
  });

  $("btnAdminThisWeek")?.addEventListener("click", () => {
    $("filterFrom").value = startOfWeekYmd();
    $("filterTo").value = todayYmd();
    renderAll();
  });

  ["filterFrom", "filterTo", "filterProvider", "filterClinic", "filterStaff", "filterTake"].forEach(id => {
    $(id)?.addEventListener("input", renderAll);
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

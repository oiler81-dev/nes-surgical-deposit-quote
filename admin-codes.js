const state = {
  me: null,
  isAdmin: false,
  items: [],
  filtered: []
};

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function parseNum(x) {
  const n = parseFloat(String(x ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toBool(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(v)) return true;
    if (["false", "0", "no", "n"].includes(v)) return false;
  }
  return fallback;
}

async function safeJson(res) {
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return null; }
}

async function apiGet(path) {
  const res = await fetch(path, { cache: "no-store" });
  const data = await safeJson(res);
  return { ok: res.ok, status: res.status, data };
}

async function apiSend(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await safeJson(res);
  return { ok: res.ok, status: res.status, data };
}

async function loadMe() {
  const res = await apiGet("/.auth/me");
  const principal = Array.isArray(res.data) ? res.data[0]?.clientPrincipal : null;
  state.me = principal || null;

  const roles = Array.isArray(principal?.userRoles) ? principal.userRoles : [];
  state.isAdmin = roles.some(r => String(r).toLowerCase() === "admin");

  $("whoAmI").textContent = principal?.userDetails || principal?.userId || "Signed in";
  $("rolePill").textContent = state.isAdmin ? "Role: Admin" : "Role: Non-admin";

  $("managerCard").style.display = state.isAdmin ? "" : "none";
  $("accessDeniedCard").style.display = state.isAdmin ? "none" : "";
}

async function loadCodes() {
  const res = await apiGet("/api/adminCodes");
  if (!res.ok || !Array.isArray(res.data?.items)) {
    $("codesTbody").innerHTML = `<tr><td colspan="7">Could not load codes.</td></tr>`;
    return;
  }

  state.items = res.data.items.slice().sort((a, b) => String(a.cpt).localeCompare(String(b.cpt)));
  applyFilters();
}

function applyFilters() {
  const search = String($("searchText")?.value || "").trim().toLowerCase();
  const status = $("statusFilter")?.value || "all";
  const maxRows = Math.max(10, Math.min(1000, parseInt($("maxRows")?.value || "250", 10) || 250));

  state.filtered = state.items.filter(item => {
    if (status === "active" && item.active === false) return false;
    if (status === "inactive" && item.active !== false) return false;

    if (search) {
      const hay = `${item.cpt} ${item.description || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }

    return true;
  }).slice(0, maxRows);

  renderTable();
}

function renderTable() {
  const tbody = $("codesTbody");
  if (!state.filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7">No matching codes.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.filtered.map(item => `
    <tr>
      <td class="mono">${escapeHtml(item.cpt)}</td>
      <td>${escapeHtml(item.description || "")}</td>
      <td class="num">${money(parseNum(item.allowed))}</td>
      <td>${item.active === false ? "No" : "Yes"}</td>
      <td>${escapeHtml(item.updatedAt || "")}</td>
      <td>${escapeHtml(item.updatedBy || "")}</td>
      <td>
        <div class="rowActions">
          <button class="btn btn--ghost btnEdit" type="button" data-cpt="${escapeHtml(item.cpt)}">Edit</button>
          <button class="btn btn--danger btnDeactivate" type="button" data-cpt="${escapeHtml(item.cpt)}">
            ${item.active === false ? "Activate" : "Deactivate"}
          </button>
        </div>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btnEdit").forEach(btn => {
    btn.addEventListener("click", () => {
      const cpt = btn.getAttribute("data-cpt");
      const item = state.items.find(x => x.cpt === cpt);
      if (!item) return;

      $("formMode").value = "edit";
      $("codeCpt").value = item.cpt;
      $("codeDescription").value = item.description || "";
      $("codeAllowed").value = parseNum(item.allowed);
      $("codeActive").value = item.active === false ? "false" : "true";
      $("formStatus").textContent = `Editing ${item.cpt}. Save when ready.`;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  tbody.querySelectorAll(".btnDeactivate").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!state.isAdmin) return;

      const cpt = btn.getAttribute("data-cpt");
      const item = state.items.find(x => x.cpt === cpt);
      if (!item) return;

      const nextActive = item.active === false;
      const confirmed = window.confirm(
        nextActive
          ? `Activate ${cpt}?`
          : `Deactivate ${cpt}? It will stop appearing in the estimator but stay in storage.`
      );
      if (!confirmed) return;

      const res = await apiSend("PUT", "/api/adminCodes", {
        cpt,
        description: item.description || "",
        allowed: parseNum(item.allowed),
        active: nextActive
      });

      if (!res.ok) {
        alert(res.data?.error || "Could not update the code.");
        return;
      }

      await loadCodes();
    });
  });
}

function clearForm() {
  $("formMode").value = "add";
  $("codeCpt").value = "";
  $("codeDescription").value = "";
  $("codeAllowed").value = "";
  $("codeActive").value = "true";
  $("formStatus").textContent = "Use this page to add new CPTs, update allowed amounts, or deactivate old codes.";
}

async function saveCode() {
  if (!state.isAdmin) return;

  const mode = $("formMode").value === "edit" ? "edit" : "add";
  const cpt = String($("codeCpt").value || "").trim().toUpperCase();
  const description = String($("codeDescription").value || "").trim();
  const allowed = parseNum($("codeAllowed").value);
  const active = toBool($("codeActive").value, true);

  if (!cpt) {
    alert("CPT is required.");
    return;
  }

  const payload = { cpt, description, allowed, active };
  const res = mode === "edit"
    ? await apiSend("PUT", "/api/adminCodes", payload)
    : await apiSend("POST", "/api/adminCodes", payload);

  if (!res.ok) {
    alert(res.data?.error || "Could not save the code.");
    return;
  }

  $("formStatus").textContent = `${cpt} saved successfully.`;
  clearForm();
  await loadCodes();
}

function exportCsv() {
  const rows = [
    ["CPT", "Description", "Allowed", "Active", "UpdatedAt", "UpdatedBy"],
    ...state.filtered.map(item => [
      item.cpt,
      item.description || "",
      parseNum(item.allowed).toFixed(2),
      item.active === false ? "No" : "Yes",
      item.updatedAt || "",
      item.updatedBy || ""
    ])
  ];

  const csv = rows.map(cols => cols.map(value => {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  }).join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nes-fee-schedule.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function wire() {
  $("searchText").addEventListener("input", applyFilters);
  $("statusFilter").addEventListener("change", applyFilters);
  $("maxRows").addEventListener("input", applyFilters);
  $("btnRefreshCodes").addEventListener("click", loadCodes);
  $("btnExportCodes").addEventListener("click", exportCsv);
  $("btnSaveCode").addEventListener("click", saveCode);
  $("btnClearForm").addEventListener("click", clearForm);
}

async function init() {
  wire();
  await loadMe();
  await loadCodes();
}

document.addEventListener("DOMContentLoaded", init);

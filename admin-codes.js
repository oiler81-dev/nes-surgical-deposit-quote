const state = {
  user: null,
  isAdmin: false,
  codes: [],
  filtered: [],
  editingCpt: null
};

function $(id) {
  return document.getElementById(id);
}

function showError(message) {
  $("errorText").textContent = message || "Unexpected error.";
  $("errorBox").classList.remove("hidden");
}

function hideError() {
  $("errorBox").classList.add("hidden");
  $("errorText").textContent = "";
}

function showSuccess(message) {
  $("successText").textContent = message || "";
  $("successBox").classList.remove("hidden");
  setTimeout(() => $("successBox").classList.add("hidden"), 2500);
}

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function getCurrentUser() {
  const res = await fetch("/.auth/me", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not read authentication status.");
  const data = await res.json();
  const principal = data?.clientPrincipal || null;

  if (!principal) {
    return {
      authenticated: false,
      userDetails: null,
      roles: ["anonymous"]
    };
  }

  return {
    authenticated: true,
    userDetails: principal.userDetails || null,
    roles: Array.isArray(principal.userRoles) ? principal.userRoles : []
  };
}

function updateIdentityUi() {
  $("authPill").textContent = state.user?.authenticated ? "Signed in" : "Not signed in";
  $("rolePill").textContent = state.isAdmin ? "Role: admin" : "Role: Non-admin";

  if (state.isAdmin) {
    $("editorCard").classList.remove("hidden");
    $("deniedBox").classList.add("hidden");
  } else {
    $("editorCard").classList.add("hidden");
    if (state.user?.authenticated) {
      $("deniedBox").classList.remove("hidden");
    } else {
      $("deniedBox").classList.add("hidden");
    }
  }
}

async function loadCodes() {
  $("codesBody").innerHTML = `<tr><td colspan="7" class="empty">Loading...</td></tr>`;

  const res = await fetch("/api/fees", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    throw new Error(data?.error || `Could not load codes. (${res.status})`);
  }

  state.codes = Array.isArray(data.items) ? data.items : [];
  applyFilters();
}

function applyFilters() {
  const q = String($("searchInput").value || "").trim().toLowerCase();
  const status = $("statusFilter").value;
  const rowLimit = Math.max(1, Math.min(1000, parseInt($("rowLimit").value || "250", 10) || 250));

  let items = [...state.codes];

  if (q) {
    items = items.filter(x =>
      String(x.cpt || "").toLowerCase().includes(q) ||
      String(x.description || "").toLowerCase().includes(q)
    );
  }

  if (status === "active") {
    items = items.filter(x => !!x.active);
  } else if (status === "inactive") {
    items = items.filter(x => !x.active);
  }

  items.sort((a, b) => String(a.cpt || "").localeCompare(String(b.cpt || "")));
  state.filtered = items.slice(0, rowLimit);

  renderTable();
}

function renderTable() {
  const body = $("codesBody");

  if (!state.filtered.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty">No matching codes.</td></tr>`;
    return;
  }

  body.innerHTML = state.filtered.map(item => {
    const activeClass = item.active ? "status-active" : "status-inactive";
    const activeText = item.active ? "Active" : "Inactive";

    return `
      <tr>
        <td>${esc(item.cpt)}</td>
        <td>${esc(item.description)}</td>
        <td>${money(item.allowed)}</td>
        <td class="${activeClass}">${activeText}</td>
        <td>${esc(item.updatedAt || "")}</td>
        <td>${esc(item.updatedBy || "")}</td>
        <td>
          <div class="actions">
            <button class="mini primary" type="button" onclick="editCode('${esc(item.cpt)}')">Edit</button>
            <button class="mini danger" type="button" onclick="deactivateCode('${esc(item.cpt)}')">Deactivate</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function resetForm() {
  state.editingCpt = null;
  $("cptInput").value = "";
  $("descInput").value = "";
  $("allowedInput").value = "";
  $("activeInput").value = "true";
}

window.editCode = function(cpt) {
  const item = state.codes.find(x => String(x.cpt) === String(cpt));
  if (!item) return;

  state.editingCpt = item.cpt;
  $("cptInput").value = item.cpt || "";
  $("descInput").value = item.description || "";
  $("allowedInput").value = item.allowed ?? "";
  $("activeInput").value = item.active ? "true" : "false";
  window.scrollTo({ top: 0, behavior: "smooth" });
};

window.deactivateCode = async function(cpt) {
  if (!state.isAdmin) return;
  if (!confirm(`Deactivate CPT ${cpt}?`)) return;

  hideError();

  try {
    const res = await fetch(`/api/fees?cpt=${encodeURIComponent(cpt)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data?.error || `Could not deactivate code. (${res.status})`);
    }

    showSuccess(`CPT ${cpt} deactivated.`);
    await loadCodes();
  } catch (err) {
    showError(err.message || "Could not deactivate code.");
  }
};

async function saveCode() {
  hideError();

  const cpt = String($("cptInput").value || "").trim().toUpperCase();
  const description = String($("descInput").value || "").trim();
  const allowed = String($("allowedInput").value || "").trim();
  const active = $("activeInput").value === "true";

  if (!cpt) {
    showError("CPT is required.");
    return;
  }

  const payload = {
    cpt,
    description,
    allowed,
    active
  };

  const method = state.editingCpt ? "PUT" : "POST";

  try {
    const res = await fetch("/api/fees", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data?.error || `Could not save code. (${res.status})`);
    }

    showSuccess(state.editingCpt ? `CPT ${cpt} updated.` : `CPT ${cpt} added.`);
    resetForm();
    await loadCodes();
  } catch (err) {
    showError(err.message || "Could not save code.");
  }
}

function exportCsv() {
  const rows = [
    ["CPT", "Description", "Allowed", "Active", "UpdatedAt", "UpdatedBy"],
    ...state.filtered.map(x => [
      x.cpt || "",
      x.description || "",
      x.allowed ?? "",
      x.active ? "true" : "false",
      x.updatedAt || "",
      x.updatedBy || ""
    ])
  ];

  const csv = rows.map(row =>
    row.map(v => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    }).join(",")
  ).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fee-schedule.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function init() {
  hideError();

  try {
    state.user = await getCurrentUser();
    state.isAdmin = !!state.user?.roles?.includes("admin");
    updateIdentityUi();
    await loadCodes();
  } catch (err) {
    updateIdentityUi();
    $("codesBody").innerHTML = `<tr><td colspan="7" class="empty">Could not load codes.</td></tr>`;
    showError(err.message || "Page failed to initialize.");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  $("refreshBtn").addEventListener("click", async () => {
    hideError();
    try {
      await loadCodes();
    } catch (err) {
      showError(err.message || "Could not refresh codes.");
    }
  });

  $("exportBtn").addEventListener("click", exportCsv);
  $("searchInput").addEventListener("input", applyFilters);
  $("statusFilter").addEventListener("change", applyFilters);
  $("rowLimit").addEventListener("input", applyFilters);
  $("saveBtn").addEventListener("click", saveCode);
  $("clearBtn").addEventListener("click", resetForm);

  init();
});

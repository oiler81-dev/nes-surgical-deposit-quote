const state = {
  user: null,
  isAdmin: false,
  codes: []
};

async function getUser() {
  const res = await fetch("/.auth/me");
  const data = await res.json();

  if (!data || !data.clientPrincipal) {
    return null;
  }

  const principal = data.clientPrincipal;

  const roles = principal.userRoles || [];

  return {
    email: principal.userDetails,
    roles
  };
}

function updateUserBadge(user) {
  const badge = document.getElementById("userBadge");

  if (!user) {
    badge.innerText = "Not signed in";
    return;
  }

  const role = user.roles.includes("admin") ? "admin" : "Non-admin";

  badge.innerText = `Signed in | Role: ${role}`;
}

async function loadCodes() {
  const res = await fetch("/api/adminCodes");

  if (!res.ok) {
    document.getElementById("codesBody").innerHTML =
      `<tr><td colspan="7">Could not load codes.</td></tr>`;
    return;
  }

  const data = await res.json();

  state.codes = data.items || [];

  renderCodes();
}

function renderCodes() {
  const body = document.getElementById("codesBody");

  if (!state.codes.length) {
    body.innerHTML =
      `<tr><td colspan="7">No matching codes.</td></tr>`;
    return;
  }

  body.innerHTML = state.codes.map(c => `
    <tr>
      <td>${c.cpt}</td>
      <td>${c.description}</td>
      <td>${c.allowed}</td>
      <td>${c.active}</td>
      <td>${c.updatedAt || ""}</td>
      <td>${c.updatedBy || ""}</td>
      <td></td>
    </tr>
  `).join("");
}

async function init() {
  const user = await getUser();

  state.user = user;
  state.isAdmin = user?.roles?.includes("admin");

  updateUserBadge(user);

  if (!state.isAdmin) {
    document.getElementById("accessDenied").style.display = "block";
    return;
  }

  document.getElementById("accessDenied").style.display = "none";

  loadCodes();
}

init();

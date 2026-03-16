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

/* =========================
   LOAD FEE SCHEDULE
   ========================= */

async function loadFees(){
  const res = await fetch("/api/fees",{cache:"no-store"});
  const data = await res.json();

  if(!data.ok) return;

  state.feeMap.clear();

  for(const item of data.items){
    if(!item.active) continue;
    state.feeMap.set(String(item.cpt),{
      description:item.description,
      allowed:Number(item.allowed||0)
    });
  }
}

/* =========================
   ROW MANAGEMENT
   ========================= */

function addRow(){

  if(state.rows.length >= state.maxRows) return;

  const idx = state.rows.length;

  const row = document.createElement("tr");

  row.innerHTML = `
    <td>
      <input class="cpt" placeholder="CPT">
    </td>

    <td>
      <input class="desc" placeholder="Description" readonly>
    </td>

    <td>
      <input class="allowed" readonly>
    </td>

    <td>
      <input class="units" type="number" min="1" value="1">
    </td>

    <td>
      <input class="total" readonly>
    </td>

    <td>
      <button class="removeBtn">Remove</button>
    </td>
  `;

  $("rows").appendChild(row);

  const cptInput = row.querySelector(".cpt");
  const descInput = row.querySelector(".desc");
  const allowedInput = row.querySelector(".allowed");
  const unitsInput = row.querySelector(".units");
  const totalInput = row.querySelector(".total");

  function update(){

    const cpt = cptInput.value.trim();

    if(!state.feeMap.has(cpt)){
      descInput.value = "";
      allowedInput.value = "";
      totalInput.value = "";
      calcTotals();
      return;
    }

    const fee = state.feeMap.get(cpt);

    descInput.value = fee.description;
    allowedInput.value = money(fee.allowed);

    const units = numVal(unitsInput) || 1;

    const total = fee.allowed * units;

    totalInput.value = money(total);

    calcTotals();
  }

  cptInput.addEventListener("change",update);
  unitsInput.addEventListener("change",update);

  row.querySelector(".removeBtn").onclick = ()=>{
    row.remove();
    calcTotals();
  };

  state.rows.push(row);
}

/* =========================
   TOTAL CALCULATIONS
   ========================= */

function calcTotals(){

  const insuranceType = $("insuranceType").value;
  const orthoticsChecked = $("orthoticsCheck").checked;

  let surgicalTotal = 0;

  document.querySelectorAll(".total").forEach(el=>{
    const v = parseFloat(String(el.value).replace(/[^0-9.]/g,""));
    if(Number.isFinite(v)) surgicalTotal += v;
  });

  $("surgicalTotal").textContent = money(surgicalTotal);

  /* -------------------------
     ORTHOTICS CALC
  ------------------------- */

  let orthotics = 0;

  if(orthoticsChecked){

    if(insuranceType === "self"){

      /* HARD LOCK SELF PAY ORTHOTICS */

      orthotics = 480;

      $("orthoticsAmount").value = "480";
      $("orthoticsAmount").disabled = true;

    }else{

      const entered = numVal($("orthoticsAmount"));

      orthotics = entered;

      $("orthoticsAmount").disabled = false;
    }

  }else{

    $("orthoticsAmount").disabled = false;
    orthotics = 0;
  }

  $("orthoticsTotal").textContent = money(orthotics);

  /* -------------------------
     GRAND TOTAL
  ------------------------- */

  const grandTotal = surgicalTotal + orthotics;

  $("grandTotal").textContent = money(grandTotal);
}

/* =========================
   EVENT LISTENERS
   ========================= */

$("addRowBtn").addEventListener("click",addRow);

$("insuranceType").addEventListener("change",calcTotals);

$("orthoticsCheck").addEventListener("change",calcTotals);

$("orthoticsAmount").addEventListener("change",calcTotals);

/* =========================
   INIT
   ========================= */

async function init(){

  await loadFees();

  addRow();

  calcTotals();
}

init();

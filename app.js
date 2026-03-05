/* =========================
   STATE
   ========================= */

const state = {
  feeMap: new Map(),
  rows: [],
  maxRows: 10,
  lastHistoryItems: [],
  adminLastExport: [],
  providers: []
};

const $ = (id) => document.getElementById(id);

/* =========================
   HELPERS
   ========================= */

function money(n){
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined,{style:"currency",currency:"USD"});
}

function numVal(el){
  if(!el) return 0;
  const v=parseFloat(String(el.value||"").replace(/,/g,""));
  return Number.isFinite(v)?v:0;
}

/* =========================
   PROVIDERS
   =========================
   These mirror NES providers.
*/

function loadProviders(){

  state.providers = [
    "David L Wood MD",
    "Jason Snibbe MD",
    "Jonathan Yun MD",
    "Shawn Kato MD",
    "Patrick Hsieh MD",
    "Michael Stone MD",
    "Daniel Allison MD",
    "Brian Kim MD",
    "Farshad Ahmadi MD",
    "Sam Baksh MD",
    "Joshua Hernandez MD"
  ];

}

/* =========================
   CPT DROPDOWN OPTIONS
   ========================= */

function buildCPTOptions(){

  const list = Array.from(state.feeMap.keys()).sort();

  return list.map(cpt =>
    `<option value="${cpt}">${cpt}</option>`
  ).join("");

}

/* =========================
   PROVIDER OPTIONS
   ========================= */

function buildProviderOptions(){

  return state.providers.map(p =>
    `<option value="${p}">${p}</option>`
  ).join("");

}

/* =========================
   ROW RENDER
   ========================= */

function renderRows(){

  const tbody=$("#rows");
  tbody.innerHTML="";

  const cptOptions=buildCPTOptions();
  const providerOptions=buildProviderOptions();

  state.rows.forEach((row,i)=>{

    const tr=document.createElement("tr");

    tr.innerHTML=`

<td>

<select class="provider">

<option value="">Select Provider</option>

${providerOptions}

</select>

</td>

<td>

<select class="cpt">

<option value="">Select CPT</option>

${cptOptions}

</select>

</td>

<td class="desc"></td>

<td>

<input type="number" class="fee" value="0" step="0.01">

</td>

<td>

<input type="number" class="qty" value="1">

</td>

<td class="lineTotal">$0.00</td>

<td>

<button class="removeRow">X</button>

</td>

`;

    tbody.appendChild(tr);

    const providerSel=tr.querySelector(".provider");
    const cptSel=tr.querySelector(".cpt");
    const feeInput=tr.querySelector(".fee");
    const qtyInput=tr.querySelector(".qty");
    const descCell=tr.querySelector(".desc");
    const lineCell=tr.querySelector(".lineTotal");

    providerSel.value=row.provider||"";
    cptSel.value=row.cpt||"";

    providerSel.onchange=()=>{
      row.provider=providerSel.value;
    };

    cptSel.onchange=()=>{

      row.cpt=cptSel.value;

      const data=state.feeMap.get(row.cpt);

      if(data){

        descCell.textContent=data.desc||"";
        feeInput.value=data.fee||0;

      }

      recalcRow(tr);

    };

    feeInput.oninput=()=>recalcRow(tr);
    qtyInput.oninput=()=>recalcRow(tr);

    tr.querySelector(".removeRow").onclick=()=>{
      state.rows.splice(i,1);
      renderRows();
      recalcTotals();
    };

  });

}

/* =========================
   ROW CALC
   ========================= */

function recalcRow(tr){

  const fee=numVal(tr.querySelector(".fee"));
  const qty=numVal(tr.querySelector(".qty"));

  const total=fee*qty;

  tr.querySelector(".lineTotal").textContent=money(total);

  recalcTotals();

}

/* =========================
   TOTALS
   ========================= */

function recalcTotals(){

  let total=0;

  document.querySelectorAll(".lineTotal").forEach(el=>{

    const v=parseFloat(el.textContent.replace(/[^0-9.-]+/g,""));

    if(Number.isFinite(v)) total+=v;

  });

  $("#grandTotal").textContent=money(total);

}

/* =========================
   ADD ROW
   ========================= */

function addRow(){

  if(state.rows.length>=state.maxRows) return;

  state.rows.push({
    provider:"",
    cpt:"",
    fee:0,
    qty:1
  });

  renderRows();

}

/* =========================
   INIT
   ========================= */

async function init(){

  loadProviders();

  await loadFees();

  addRow();

}

/* =========================
   LOAD CPT FEES
   ========================= */

async function loadFees(){

  const res=await fetch("/api/fees");

  const data=await res.json();

  state.feeMap.clear();

  data.forEach(x=>{

    state.feeMap.set(x.cpt,{
      desc:x.desc,
      fee:x.fee
    });

  });

}

/* =========================
   START
   ========================= */

document.addEventListener("DOMContentLoaded",init);

async function fetchJsonOrThrow(url, options = {}) {
  const res = await fetch(url, { cache: "no-store", ...options });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
  try { return JSON.parse(text); } catch { throw new Error(`Bad JSON from ${url}\n${text}`); }
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

async function saveQuote() {
  const payload = {
    patientName: getVal("patientName"),
    clinic: getVal("clinic"),
    provider: getVal("provider"),
    totals: {
      recommendedDeposit: Number(getVal("recommendedDeposit") || 0),
      estimatedOwes: Number(getVal("estimatedOwes") || 0)
    }
    // include your other fields here as needed
  };

  const data = await fetchJsonOrThrow("/api/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!data.ok) throw new Error(data.error || "Save failed");
  alert(`Saved. QuoteId: ${data.quoteId}`);
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("saveQuoteBtn");
  if (btn) {
    btn.addEventListener("click", async () => {
      try {
        await saveQuote();
      } catch (e) {
        console.error(e);
        alert(e.message || String(e));
      }
    });
  }
});

// /api/providers/index.js
// Scrapes https://nespecialists.com/team/ and returns provider names.
// Caches results in-memory for a few hours to avoid hammering the site.

let CACHE = { at: 0, providers: [] };
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function uniqSorted(arr) {
  return Array.from(new Set(arr))
    .map(s => String(s || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(s) {
  return decodeHtml(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function extractProvidersFromHtml(html) {
  // The team page includes headings like "### Dr. Mia Horvath" etc.
  // We’ll pull any heading that starts with Dr.
  const providers = [];

  // Match heading tags (h1-h4) containing "Dr."
  const headingRegex = /<(h1|h2|h3|h4)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = headingRegex.exec(html)) !== null) {
    const text = stripTags(m[2]);
    if (/^Dr\.\s+/i.test(text)) {
      // Normalize spacing
      providers.push(text.replace(/\s+/g, " ").trim());
    }
  }

  // Fallback: markdown-ish headings sometimes appear in parsed HTML blocks
  // e.g. "### Dr. Name"
  const mdRegex = /###\s*(Dr\.\s+[A-Za-z][^\r\n<]*)/g;
  while ((m = mdRegex.exec(html)) !== null) {
    providers.push(stripTags(m[1]));
  }

  return uniqSorted(providers);
}

module.exports = async function (context, req) {
  try {
    const now = Date.now();
    if (CACHE.providers.length && (now - CACHE.at) < CACHE_TTL_MS) {
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
        body: { source: "cache", count: CACHE.providers.length, providers: CACHE.providers }
      };
      return;
    }

    const url = "https://nespecialists.com/team/";
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NES Estimate Bot; +https://estimate.nespecialists.com)"
      }
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch team page: ${resp.status} ${resp.statusText}`);
    }

    const html = await resp.text();
    const providers = extractProvidersFromHtml(html);

    CACHE = { at: now, providers };

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
      body: { source: "live", count: providers.length, providers }
    };
  } catch (e) {
    // Fail safe: return a small static fallback so the dropdown still works.
    context.log("providers scrape error:", e?.message || e);

    const fallback = [
      "Dr. Mia Horvath",
      "Dr. Todd Galle",
      "Dr. Cara Beach",
      "Dr. Clifford Mah",
      "Dr. Denny Le",
      "Dr. Lacey Beth Lockhart",
      "Dr. Manny Moy",
      "Dr. Peter Pham",
      "Dr. Thomas Melillo",
      "Dr. Taylor Bunka",
      "Dr. Ron Bowman"
    ];

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: { source: "fallback", count: fallback.length, providers: fallback, warning: "Scrape failed; using fallback list." }
    };
  }
};

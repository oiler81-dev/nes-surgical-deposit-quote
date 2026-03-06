let CACHE = { at: 0, providers: [] };
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

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
  const providers = [];
  const headingRegex = /<(h1|h2|h3|h4)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;

  while ((m = headingRegex.exec(html)) !== null) {
    const text = stripTags(m[2]);
    if (/^(Dr\.|Landon Masterfield)/i.test(text)) {
      providers.push(text);
    }
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

    const resp = await fetch("https://nespecialists.com/team/", {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NES Estimate Tool)"
      }
    });

    if (!resp.ok) throw new Error(`Failed to fetch team page: ${resp.status}`);

    const html = await resp.text();
    const providers = extractProvidersFromHtml(html);

    CACHE = { at: now, providers };

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
      body: { source: "live", count: providers.length, providers }
    };
  } catch (e) {
    const fallback = [
      "Dr. Ron Bowman",
      "Landon Masterfield, PA-C",
      "Dr. Mia Horvath",
      "Dr. Todd Galle",
      "Dr. Cara Beach",
      "Dr. Clifford Mah",
      "Dr. Denny Le",
      "Dr. Lacey Beth Lockhart",
      "Dr. Manny Moy",
      "Dr. Peter Pham",
      "Dr. Thomas Melillo",
      "Dr. Melinda Nicholes",
      "Dr. Taylor Bunka",
      "Dr. Yama Dehqanzada",
      "Dr. Magnus Schlyer"
    ];

    context.log("providers scrape error:", e?.message || e);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: { source: "fallback", count: fallback.length, providers: fallback }
    };
  }
};

/**
 * Cloudflare Worker – Proxy für die conan-exiles.com Vote-API.
 *
 * Einrichten (kostenlos):
 *  1. dash.cloudflare.com → Workers & Pages → Create → "Hello World" Worker
 *  2. Diesen Code einfügen und deployen
 *  3. Settings → Variables and Secrets:
 *       API_KEY         = dein Server-API-Key        (als "Secret" anlegen)
 *       ALLOWED_ORIGIN  = https://deine-seite.de     (optional, sonst * )
 *  4. Die Worker-Adresse (https://NAME.DEINKONTO.workers.dev) in conan-votes.html
 *     bei WORKER_URL eintragen.
 *
 * Aufruf:  /?element=voters&month=current&limit=100
 *          /?element=votes&limit=100
 *          /?element=detail
 */
const API = "https://conan-exiles.com/api/";

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return reply({ error: "Nur GET erlaubt" }, 405, cors);

    const u = new URL(request.url);
    const element = u.searchParams.get("element");
    if (!["voters", "votes", "detail"].includes(element))
      return reply({ error: "Ungültiges element" }, 400, cors);

    const month = u.searchParams.get("month") === "previous" ? "previous" : "current";
    const limit = Math.max(1, Math.min(1000, parseInt(u.searchParams.get("limit")) || 100));

    const build = (format) => {
      const q = new URLSearchParams({ object: "servers", element, key: env.API_KEY });
      if (element === "voters") q.set("month", month);
      if (element !== "detail") { q.set("limit", limit); q.set("format", format); }
      return `${API}?${q}`;
    };
    const get = async (url) => {
      const r = await fetch(url, { cf: { cacheTtl: 180, cacheEverything: true } });
      if (!r.ok) throw new Error("API antwortet mit " + r.status);
      return r.text();
    };

    try {
      if (element === "detail")
        return reply({ detail: JSON.parse(await get(build("json"))) }, 200, cors);

      const text = await get(build("json"));
      try {
        return reply({ items: JSON.parse(text) }, 200, cors);
      } catch {
        // Kein JSON → HTML-Variante holen, die Seite wertet die Tabelle selbst aus
        return reply({ html: await get(build("html")) }, 200, cors);
      }
    } catch (e) {
      return reply({ error: String(e.message || e) }, 502, cors);
    }
  },
};

const reply = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers });

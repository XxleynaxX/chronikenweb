/* ============================================================
   Chroniken – Anmeldung über Discord (läuft über chroniken-discord-proxy)
   Rollen werden im Proxy geprüft:
     Admin-Rolle      → portal_admin_auth = 1 (+ Bibliothek)
     Bibliothek-Rolle → portal_bibliothek_auth = 1
   ============================================================ */
(function (global) {
  const ADMIN_KEY = "portal_admin_auth";
  const LIB_KEY = "portal_bibliothek_auth";
  const TOKEN_KEY = "chroniken_discord_token";
  const NAME_KEY = "chroniken_discord_name";
  const DEFAULT_PROXY = "https://chronikenweb-1.onrender.com";

  function proxyBase() {
    try {
      const saved = localStorage.getItem("chroniken_discord_proxy_url");
      if (saved && saved.trim()) return saved.trim().replace(/\/$/, "");
    } catch (e) {}
    if (typeof global.CHRONIKEN_DISCORD_PROXY === "string" && global.CHRONIKEN_DISCORD_PROXY.trim()) {
      return global.CHRONIKEN_DISCORD_PROXY.trim().replace(/\/$/, "");
    }
    return DEFAULT_PROXY;
  }

  function login() {
    const ret = location.origin + location.pathname;
    location.href = proxyBase() + "/auth/login?return=" + encodeURIComponent(ret);
  }

  function clear() {
    try {
      [ADMIN_KEY, LIB_KEY, TOKEN_KEY, NAME_KEY].forEach(function (k) { sessionStorage.removeItem(k); });
    } catch (e) {}
  }

  function name() { try { return sessionStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } }

  function showError(msg) {
    let el = document.getElementById("discordAuthMsg");
    if (!el) {
      el = document.createElement("div");
      el.id = "discordAuthMsg";
      el.style.cssText = "position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:99999;background:#9f1239;color:#fff;padding:.7rem 1.1rem;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.4);max-width:90vw;";
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 7000);
    }
    el.textContent = "Discord-Login: " + msg;
  }

  async function handleReturn() {
    const h = location.hash || "";
    const m = h.match(/^#(auth|auth_error)=(.*)$/);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    const val = decodeURIComponent(m[2]);
    if (m[1] === "auth_error") { showError(val); return; }
    try {
      const res = await fetch(proxyBase() + "/auth/me", { headers: { Authorization: "Bearer " + val } });
      const info = await res.json();
      if (!res.ok || !info.ok) throw new Error("Token ungültig");
      sessionStorage.setItem(TOKEN_KEY, val);
      sessionStorage.setItem(NAME_KEY, info.name || "");
      if (info.admin) sessionStorage.setItem(ADMIN_KEY, "1"); else sessionStorage.removeItem(ADMIN_KEY);
      if (info.admin || info.lib) sessionStorage.setItem(LIB_KEY, "1"); else sessionStorage.removeItem(LIB_KEY);
      location.reload();
    } catch (e) {
      showError("Anmeldung konnte nicht geprüft werden (" + e.message + ").");
    }
  }

  // Alle Knöpfe mit data-discord-login starten die Anmeldung
  function bind() {
    document.querySelectorAll("[data-discord-login]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.preventDefault(); login(); });
    });
  }

  global.ChronikenAuth = { login: login, clear: clear, name: name };
  function start() { bind(); handleReturn(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof window !== "undefined" ? window : globalThis);

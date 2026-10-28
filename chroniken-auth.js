/* ============================================================
   Chroniken – Anmeldung über Discord (läuft über chroniken-discord-proxy)
   Rollen werden im Proxy geprüft:
     Admin-Rolle      → portal_admin_auth = 1 (+ Bibliothek)
     Bibliothek-Rolle → portal_bibliothek_auth = 1
     Heiler-Rolle     → portal_heiler_auth = 1 (Admins auch)
   Ablauf: Klick → Knopf zeigt Ladekreis → Discord öffnet sich in einem
   kleinen Fenster → nach „Autorisieren“ schließt es sich und die Seite
   ist angemeldet. Ohne Popup (blockiert) → normale Weiterleitung.
   ============================================================ */
(function (global) {
  const ADMIN_KEY = "portal_admin_auth";
  const LIB_KEY = "portal_bibliothek_auth";
  const HEALER_KEY = "portal_heiler_auth";
  const TOKEN_KEY = "chroniken_discord_token";
  const NAME_KEY = "chroniken_discord_name";
  const HANDOFF_KEY = "chroniken_auth_handoff";
  const POPUP_PARAM = "discord_popup";
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

  function pageUrl() { return location.origin + location.pathname; }

  function clear() {
    try {
      [ADMIN_KEY, LIB_KEY, HEALER_KEY, TOKEN_KEY, NAME_KEY].forEach(function (k) { sessionStorage.removeItem(k); });
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

  // ---------- Knopf-Zustand ----------
  function setLoading(on, text) {
    document.querySelectorAll("[data-discord-login]").forEach(function (b) {
      const label = b.querySelector("span");
      if (on) {
        if (label && !b.dataset.label) b.dataset.label = label.textContent;
        if (label) label.textContent = text || "Verbinde mit Discord …";
        b.classList.add("is-loading");
        b.disabled = true;
        b.setAttribute("aria-busy", "true");
      } else {
        if (label && b.dataset.label) label.textContent = b.dataset.label;
        b.classList.remove("is-loading");
        b.disabled = false;
        b.removeAttribute("aria-busy");
      }
    });
  }

  // ---------- Popup ----------
  const POPUP_HTML = '<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Discord-Anmeldung</title>' +
    '<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.2rem;' +
    'background:radial-gradient(circle at 50% 30%,#2a1747,#0e0e10 70%);color:#e4e4e8;font-family:system-ui,sans-serif}' +
    '.r{width:46px;height:46px;border-radius:50%;border:4px solid rgba(192,132,252,.25);border-top-color:#a855f7;animation:s .8s linear infinite}' +
    '@keyframes s{to{transform:rotate(360deg)}}p{margin:0;color:#b8b0c8;font-size:.95rem}</style></head>' +
    '<body><div class="r"></div><p>Verbinde mit Discord …</p></body></html>';

  function openPopup() {
    const w = 500, h = 780;
    const left = Math.max(0, (global.screenX || 0) + ((global.outerWidth || w) - w) / 2);
    const top = Math.max(0, (global.screenY || 0) + ((global.outerHeight || h) - h) / 2);
    let pop = null;
    try { pop = global.open("", "chroniken_discord_login", "popup=yes,width=" + w + ",height=" + h + ",left=" + left + ",top=" + top); } catch (e) {}
    if (pop) { try { pop.document.open(); pop.document.write(POPUP_HTML); pop.document.close(); } catch (e) {} }
    return pop;
  }

  let finishing = false, popupWatch = null;

  function redirectLogin() {
    setLoading(true, "Weiterleitung zu Discord …");
    location.href = proxyBase() + "/auth/login?return=" + encodeURIComponent(pageUrl());
  }

  async function login() {
    if (finishing) return;
    setLoading(true);
    const pop = openPopup();
    if (!pop) { redirectLogin(); return; }
    try {
      const res = await fetch(proxyBase() + "/auth/start?return=" + encodeURIComponent(pageUrl() + "?" + POPUP_PARAM + "=1"), { cache: "no-store" });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok || !data.url) throw new Error(data.error || ("Status " + res.status));
      if (pop.closed) { setLoading(false); return; }
      pop.location.href = data.url;
      setLoading(true, "Warte auf Discord …");
    } catch (e) {
      try { pop.close(); } catch (x) {}
      // Alter Proxy ohne /auth/start → klassische Weiterleitung
      if (/Status 404/.test(e.message)) { redirectLogin(); return; }
      setLoading(false);
      showError("Server nicht erreichbar (" + e.message + "). Bitte gleich nochmal versuchen.");
      return;
    }
    clearInterval(popupWatch);
    popupWatch = setInterval(function () {
      if (finishing) { clearInterval(popupWatch); return; }
      if (pop.closed) {
        clearInterval(popupWatch);
        setTimeout(function () { if (!finishing) setLoading(false); }, 1200);
      }
    }, 500);
  }

  // ---------- Token übernehmen ----------
  async function finish(kind, val) {
    if (finishing) return;
    if (kind === "auth_error") { setLoading(false); showError(val); return; }
    finishing = true;
    setLoading(true, "Anmeldung wird geprüft …");
    try {
      const res = await fetch(proxyBase() + "/auth/me", { headers: { Authorization: "Bearer " + val } });
      const info = await res.json();
      if (!res.ok || !info.ok) throw new Error("Token ungültig");
      sessionStorage.setItem(TOKEN_KEY, val);
      sessionStorage.setItem(NAME_KEY, info.name || "");
      if (info.admin) sessionStorage.setItem(ADMIN_KEY, "1"); else sessionStorage.removeItem(ADMIN_KEY);
      if (info.admin || info.lib) sessionStorage.setItem(LIB_KEY, "1"); else sessionStorage.removeItem(LIB_KEY);
      if (info.admin || info.healer) sessionStorage.setItem(HEALER_KEY, "1"); else sessionStorage.removeItem(HEALER_KEY);
      location.reload();
    } catch (e) {
      finishing = false;
      setLoading(false);
      showError("Anmeldung konnte nicht geprüft werden (" + e.message + ").");
    }
  }

  function readHash() {
    const m = (location.hash || "").match(/^#(auth|auth_error)=(.*)$/);
    return m ? { kind: m[1], val: decodeURIComponent(m[2]) } : null;
  }

  function handleReturn() {
    const r = readHash();
    const params = new URLSearchParams(location.search);
    const inPopup = params.get(POPUP_PARAM) === "1";
    if (inPopup) {
      params.delete(POPUP_PARAM);
      const q = params.toString();
      history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + (r ? "" : location.hash));
    } else if (r) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (!r) return;
    if (inPopup) {
      // Ergebnis an das Hauptfenster geben und Popup schließen
      const msg = { type: "chroniken-auth", kind: r.kind, val: r.val, t: Date.now() };
      try { localStorage.setItem(HANDOFF_KEY, JSON.stringify(msg)); } catch (e) {}
      try { if (global.opener && !global.opener.closed) global.opener.postMessage(msg, location.origin); } catch (e) {}
      document.documentElement.innerHTML = '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0e0e10;color:#e4e4e8;font-family:system-ui,sans-serif"><p>✓ Angemeldet – dieses Fenster schließt sich …</p></body>';
      setTimeout(function () { try { global.close(); } catch (e) {} }, 150);
      // Falls sich das Fenster nicht schließen lässt (z. B. als Tab geöffnet): hier selbst anmelden
      setTimeout(function () { finish(r.kind, r.val); }, 1500);
      return;
    }
    finish(r.kind, r.val);
  }

  global.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== "chroniken-auth") return;
    finish(e.data.kind, e.data.val);
  });
  global.addEventListener("storage", function (e) {
    if (e.key !== HANDOFF_KEY || !e.newValue) return;
    try {
      const d = JSON.parse(e.newValue);
      if (d && d.type === "chroniken-auth" && Date.now() - d.t < 60000) finish(d.kind, d.val);
    } catch (x) {}
    try { localStorage.removeItem(HANDOFF_KEY); } catch (x) {}
  });

  // Alle Knöpfe mit data-discord-login starten die Anmeldung
  function bind() {
    document.querySelectorAll("[data-discord-login]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.preventDefault(); login(); });
    });
  }

  // Render-Server im Hintergrund aufwecken, damit der Klick schnell geht
  function warmUp() {
    try { fetch(proxyBase() + "/auth/ping", { cache: "no-store" }).catch(function () {}); } catch (e) {}
  }

  global.ChronikenAuth = { login: login, clear: clear, name: name };
  function start() {
    bind();
    handleReturn();
    if (document.querySelector("[data-discord-login]") && !sessionStorage.getItem(TOKEN_KEY)) warmUp();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof window !== "undefined" ? window : globalThis);

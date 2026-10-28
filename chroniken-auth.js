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

  const LOGOUT_KEY = "chroniken_logout";

  function clear() {
    try {
      [ADMIN_KEY, LIB_KEY, HEALER_KEY, TOKEN_KEY, NAME_KEY,
       "chroniken_discord_roles", "discord_roles", "discord_username", "portal_discord_user"
      ].forEach(function (k) { sessionStorage.removeItem(k); });
    } catch (e) {}
    try { localStorage.removeItem(HANDOFF_KEY); } catch (e) {}
  }

  function goHome() {
    const home = location.pathname.replace(/[^/]*$/, "") + "index.html";
    if (location.pathname === home && !location.search && !location.hash) location.reload();
    else location.replace(home);
  }

  // Abmelden: alles löschen, andere offene Tabs mit abmelden, zur Startseite
  function logout() {
    clear();
    try { localStorage.setItem(LOGOUT_KEY, String(Date.now())); } catch (e) {}
    goHome();
  }

  function loggedOutAfter(t) {
    try { return Number(localStorage.getItem(LOGOUT_KEY) || 0) >= t; } catch (e) { return false; }
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
    if (e.key === LOGOUT_KEY && e.newValue) {
      const was = !!(sessionStorage.getItem(ADMIN_KEY) || sessionStorage.getItem(LIB_KEY) || sessionStorage.getItem(HEALER_KEY) || sessionStorage.getItem(TOKEN_KEY));
      clear();
      if (was) goHome();
      return;
    }
    if (e.key !== HANDOFF_KEY || !e.newValue) return;
    try {
      const d = JSON.parse(e.newValue);
      if (d && d.type === "chroniken-auth" && Date.now() - d.t < 60000 && !loggedOutAfter(d.t)) finish(d.kind, d.val);
    } catch (x) {}
    try { localStorage.removeItem(HANDOFF_KEY); } catch (x) {}
  });

  // ---------- Login in der Menüleiste (vor „Start“) ----------
  const LOGO = "<svg class=\"discord-logo\" viewBox=\"0 0 127.14 96.36\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z\"/></svg>";
  function flag(k) { try { return sessionStorage.getItem(k) === "1"; } catch (e) { return false; } }
  function escHtml(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function navWidget() {
    const nav = document.querySelector("header nav") || document.querySelector("nav");
    if (!nav || nav.querySelector(".nav-auth")) return;
    const admin = flag(ADMIN_KEY), lib = flag(LIB_KEY), healer = flag(HEALER_KEY);
    let token = "";
    try { token = sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) {}
    const box = document.createElement("div");
    box.className = "nav-auth";
    if (!(admin || lib || healer || token)) {
      box.innerHTML = '<button type="button" class="btn btn-discord nav-discord" data-discord-login>' + LOGO + '<span>Mit Discord anmelden</span></button>';
    } else {
      const role = admin ? "Admin" : [healer && "Heiler", lib && "Bibliothek"].filter(Boolean).join(" · ") || "Mitglied";
      let links = "";
      if (admin) links += '<a href="admin.html">🛡️ Verwaltung</a><a href="wetter.html">🌦️ Wetter</a>';
      if (admin || healer) links += '<a href="heilerakte.html">🩺 Heilerakte</a>';
      if (admin || lib) links += '<a href="bibliothek.html">📚 Bibliothek</a>';
      box.innerHTML = '<button type="button" class="nav-user" aria-haspopup="true" aria-expanded="false">' + LOGO +
        '<span class="nav-user-name">' + escHtml(name() || "Angemeldet") + '</span><small>' + role + '</small><span class="nav-caret">▾</span></button>' +
        '<div class="nav-menu" hidden>' + links + '<button type="button" data-logout>🚪 Abmelden</button></div>';
      const btn = box.querySelector(".nav-user"), menu = box.querySelector(".nav-menu");
      const toggle = function (open) { menu.hidden = !open; btn.setAttribute("aria-expanded", open ? "true" : "false"); };
      btn.addEventListener("click", function (e) { e.stopPropagation(); toggle(menu.hidden); });
      document.addEventListener("click", function (e) { if (!box.contains(e.target)) toggle(false); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") toggle(false); });
      box.querySelector("[data-logout]").addEventListener("click", logout);
    }
    nav.insertBefore(box, nav.firstChild);
  }

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

  global.ChronikenAuth = { login: login, clear: clear, logout: logout, name: name };
  function start() {
    navWidget();
    bind();
    handleReturn();
    if (document.querySelector("[data-discord-login]") && !sessionStorage.getItem(TOKEN_KEY)) warmUp();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof window !== "undefined" ? window : globalThis);

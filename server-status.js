/**
 * Chroniken – Server Status + Vote Widget
 * Zeigt: Online/Offline · Spieler · Votes · Vote-Button (Popup)
 *
 * Benötigt: proxy.php (empfohlen) oder Cloudflare Worker
 * oder als Notlösung öffentliche Proxys (API-Key wird dann sichtbar).
 */
(function () {
  "use strict";

  /* ========== EINSTELLUNGEN ========== */
  const API_KEY   = "wUh7JPwEUsO53w3qeBCIyC3tj688bVdbkuA";
  const API       = "https://conan-exiles.com/api/";
  const VOTE_URL  = "https://conan-exiles.com/server/91542/vote/";
  const WORKER_URL = "";                 // z.B. "https://votes.deinname.workers.dev"
  const USE_PUBLIC_PROXY = true;         // auf false setzen, wenn Worker/proxy.php läuft

  const REFRESH_MS = 90 * 1000;          // alle 90 Sekunden neu laden

  /* ========== Quellen (Reihenfolge) ========== */
  const SOURCES = [];
  if (WORKER_URL) SOURCES.push({ name: "Worker", kind: "proxy", base: WORKER_URL });
  SOURCES.push({ name: "proxy.php", kind: "proxy", base: "proxy.php" });
  SOURCES.push({ name: "direkt", kind: "api", wrap: u => u });
  if (USE_PUBLIC_PROXY) {
    SOURCES.push({
      name: "allorigins",
      kind: "api",
      pub: true,
      wrap: u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u)
    });
    SOURCES.push({
      name: "corsproxy",
      kind: "api",
      pub: true,
      wrap: u => "https://corsproxy.io/?" + encodeURIComponent(u)
    });
  }

  /* ========== Hilfen ========== */
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function apiUrl(element) {
    let q = `object=servers&element=${element}&key=${API_KEY}`;
    if (element !== "detail") q += "&limit=1&format=json";
    return API + "?" + q;
  }

  async function ft(url) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 8000);
    try {
      const r = await fetch(url, { signal: c.signal });
      if (!r.ok) throw new Error(r.status);
      return await r.text();
    } finally {
      clearTimeout(t);
    }
  }

  function deepPick(o, names, depth = 0) {
    if (!o || typeof o !== "object" || depth > 5) return null;
    for (const n of names) {
      const k = Object.keys(o).find(x => x.toLowerCase() === n);
      if (k && o[k] !== "" && o[k] != null && typeof o[k] !== "object") return o[k];
    }
    for (const k of Object.keys(o)) {
      const r = deepPick(o[k], names, depth + 1);
      if (r != null) return r;
    }
    return null;
  }

  async function getDetail() {
    let lastErr;
    for (const s of SOURCES) {
      try {
        let data;
        if (s.kind === "proxy") {
          const raw = await ft(`${s.base}?element=detail`);
          data = JSON.parse(raw);
          if (data.error) throw new Error(data.error);
          data = data.detail ?? data;
        } else {
          const raw = await ft(s.wrap(apiUrl("detail")));
          data = JSON.parse(raw);
        }
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("keine Quelle erreichbar");
  }

  /* ========== Darstellung ========== */
  function setLoading() {
    $("ss-status").innerHTML = '<span class="ss-dot ss-loading"></span> Lade …';
    $("ss-players").textContent = "–";
    $("ss-votes").textContent = "–";
  }

  function setError() {
    $("ss-status").innerHTML = '<span class="ss-dot ss-off"></span> Offline / Fehler';
    $("ss-players").textContent = "–";
    $("ss-votes").textContent = "–";
  }

  function render(data) {
    const st  = deepPick(data, ["status", "online", "is_online"]);
    const pl  = deepPick(data, ["players", "numplayers", "players_online", "current_players"]);
    const max = deepPick(data, ["maxplayers", "max_players", "slots"]);
    const vt  = deepPick(data, ["votes", "vote_count", "monthly_votes"]);
    const name = deepPick(data, ["name", "server_name", "hostname"]);

    const on = st != null && /^(1|online|true|up)$/i.test(String(st));

    $("ss-status").innerHTML = on
      ? '<span class="ss-dot ss-on"></span> Online'
      : '<span class="ss-dot ss-off"></span> Offline';

    if (pl != null) {
      $("ss-players").textContent = max != null ? `${pl} / ${max}` : String(pl);
    } else {
      $("ss-players").textContent = "–";
    }

    $("ss-votes").textContent = vt != null ? String(vt) : "–";

    if (name) {
      const el = $("ss-name");
      if (el) el.textContent = name;
    }
  }

  /* ========== Vote-Popup (wie in conan-votes.html) ========== */
  function openVote(e) {
    e.preventDefault();
    const w = 520, h = 760;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
    const top  = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
    const win = window.open(
      VOTE_URL,
      "votefenster",
      `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    if (!win) {
      window.open(VOTE_URL, "_blank", "noopener");
      return;
    }
    win.focus();
    // Nach Schließen des Popups neu laden
    const t = setInterval(() => {
      if (win.closed) {
        clearInterval(t);
        setTimeout(load, 3500);
      }
    }, 700);
  }

  /* ========== Laden ========== */
  async function load() {
    setLoading();
    try {
      const data = await getDetail();
      render(data);
    } catch (e) {
      console.warn("[ServerStatus]", e);
      setError();
    }
  }

  /* ========== Init ========== */
  function init() {
    const btn = $("ss-vote-btn");
    if (btn) {
      btn.href = VOTE_URL;
      btn.addEventListener("click", openVote);
    }
    // Beim Zurückkommen zum Tab aktualisieren
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) load();
    });
    load();
    setInterval(load, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

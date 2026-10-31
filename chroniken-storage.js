/* ============================================================
   Chroniken – zentrale Datenspeicherung (MySQL über den Proxy)
   ============================================================
   Alle gemeinsamen RP-Daten laufen über dieses Modul.
   Der Browser spricht NICHT direkt mit MySQL, sondern mit dem
   Chroniken-Proxy (Render): GET/PUT {PROXY}/data[/key]
   Schreibrechte werden dort anhand des Discord-Logins geprüft.
   ============================================================ */
(function (global) {
  "use strict";

  // ---------- Konfiguration (nur hier ändern) ----------
  const DEFAULT_PROXY = "https://chronikenweb-1.onrender.com";
  const TOKEN_KEY = "chroniken_discord_token";   // gleiche Quelle wie chroniken-auth.js
  const REQUEST_TIMEOUT_MS = 45000;               // Render-Free-Instanzen brauchen beim Aufwecken lange

  function apiBase() {
    try {
      const saved = localStorage.getItem("chroniken_discord_proxy_url");
      if (saved && saved.trim()) return saved.trim().replace(/\/$/, "");
    } catch (e) {}
    if (typeof global.CHRONIKEN_DISCORD_PROXY === "string" && global.CHRONIKEN_DISCORD_PROXY.trim()) {
      return global.CHRONIKEN_DISCORD_PROXY.trim().replace(/\/$/, "");
    }
    return DEFAULT_PROXY;
  }

  function authToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  /**
   * Frontend-Name → Datenbank-Key
   * Einheitliches Mapping, damit Table Editor und Code zusammenpassen.
   */
  const DB_KEY = {
    wiki: "wiki",
    bibliothek: "library",
    voelker: "races",
    berufe: "professions",
    goetter: "gods",
    kreaturen: "creatures",
    regeln: "rules",
    rules: "rules",
    news: "news",
    events: "events",
    characterEvents: "character_events",
    birthdays: "birthdays",
    calendar: "calendar",
    disabledHolidays: "disabled_holidays",
    weather: "weather",
    moon: "moon",
    characters: "characters",
    characterSheets: "character_sheets",
    heiler: "healer_records",
    map: "map"
  };

  // Keys die als Objekt (nicht Array) gespeichert werden
  const OBJECT_KEYS = new Set(["weather", "moon"]);

  // ---------- Interner Zustand ----------
  const cache = Object.create(null); // dbKey → value
  let inflightAll = null;

  // ---------- Hilfsfunktionen ----------
  function toDbKey(name) {
    return DB_KEY[name] || name;
  }

  function emptyValue(name) {
    return OBJECT_KEYS.has(name) || OBJECT_KEYS.has(toDbKey(name)) ? {} : [];
  }

  function normalize(name, value) {
    if (value === undefined || value === null) return emptyValue(name);
    return value;
  }

  // ---------- HTTP ----------
  async function request(path, options, attempt) {
    attempt = attempt || 0;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
    const headers = Object.assign({ "Cache-Control": "no-cache" }, (options && options.headers) || {});
    const token = authToken();
    if (token) headers.Authorization = "Bearer " + token;

    let res;
    try {
      res = await fetch(apiBase() + path, Object.assign({ cache: "no-store" }, options, {
        headers: headers,
        signal: controller ? controller.signal : undefined
      }));
    } catch (e) {
      // Netzwerkfehler / Timeout: bei Lesezugriffen einmal wiederholen (Server wacht gerade auf)
      if (attempt < 1 && (!options || !options.method || options.method === "GET")) {
        return request(path, options, attempt + 1);
      }
      throw new Error(e && e.name === "AbortError"
        ? "Der Server antwortet nicht (Zeitüberschreitung)."
        : "Server nicht erreichbar.");
    } finally {
      if (timer) clearTimeout(timer);
    }

    let body = null;
    try { body = await res.json(); } catch (e) {}
    if (!res.ok || !body || body.ok === false) {
      const msg = (body && body.error) || ("Status " + res.status);
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // ---------- Kern-API ----------
  async function fetchAll() {
    // Mehrere gleichzeitige Aufrufe teilen sich eine Anfrage.
    if (!inflightAll) {
      inflightAll = request("/data").then(function (body) {
        const out = body.data || {};
        Object.keys(out).forEach(function (k) { cache[k] = out[k]; });
        return out;
      }).catch(function (e) {
        throw new Error("Daten laden fehlgeschlagen: " + e.message);
      }).finally(function () { inflightAll = null; });
    }
    return inflightAll;
  }

  async function load(name) {
    const dbKey = toDbKey(name);

    if (Object.prototype.hasOwnProperty.call(cache, dbKey)) {
      return cache[dbKey];
    }

    const all = await fetchAll();
    if (!Object.prototype.hasOwnProperty.call(all, dbKey)) {
      const empty = emptyValue(name);
      cache[dbKey] = empty;
      return empty;
    }

    const value = normalize(name, all[dbKey]);
    cache[dbKey] = value;
    return value;
  }

  async function save(name, value) {
    const dbKey = toDbKey(name);
    const normalized = value === undefined ? emptyValue(name) : value;

    try {
      await request("/data/" + encodeURIComponent(dbKey), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: normalized })
      });
    } catch (e) {
      console.error("[ChronikenStorage] Speichern fehlgeschlagen:", dbKey, e);
      if (e.status === 401 || e.status === 403) {
        throw new Error("Keine Berechtigung zum Speichern (" + e.message + ") – bitte mit Discord anmelden.");
      }
      throw new Error("Speichern fehlgeschlagen: " + e.message);
    }

    cache[dbKey] = normalized;
    console.info("[ChronikenStorage] Gespeichert:", dbKey);
    return normalized;
  }

  async function refresh(name) {
    const dbKey = toDbKey(name);
    delete cache[dbKey];
    return load(name);
  }

  function invalidate(name) {
    if (name) {
      delete cache[toDbKey(name)];
    } else {
      Object.keys(cache).forEach(function (k) { delete cache[k]; });
    }
  }

  // ---------- Convenience-Loader (für Admin / Seiten) ----------
  async function ensureMain() {
    const all = await fetchAll();
    return {
      wiki: normalize("wiki", all.wiki),
      bibliothek: normalize("bibliothek", all.library),
      voelker: normalize("voelker", all.races),
      berufe: normalize("berufe", all.professions),
      goetter: normalize("goetter", all.gods),
      kreaturen: normalize("kreaturen", all.creatures),
      regeln: normalize("regeln", all.rules),
      news: normalize("news", all.news)
    };
  }

  async function ensureEvents() {
    const all = await fetchAll();
    return {
      events: normalize("events", all.events),
      characterEvents: normalize("characterEvents", all.character_events),
      birthdays: normalize("birthdays", all.birthdays),
      calendar: normalize("calendar", all.calendar),
      disabledHolidays: normalize("disabledHolidays", all.disabled_holidays),
      weather: normalize("weather", all.weather),
      moon: normalize("moon", all.moon)
    };
  }

  async function ensureChars() {
    const all = await fetchAll();
    return {
      characters: normalize("characters", all.characters),
      characterSheets: normalize("characterSheets", all.character_sheets)
    };
  }

  async function ensureHealer() {
    return { heiler: await load("heiler") };
  }

  async function ensureMap() {
    return { map: await load("map") };
  }

  // ---------- Einmal-Import aus altem localStorage ----------
  async function importLocalStorage(options) {
    options = options || {};
    const overwrite = options.overwrite === true;
    const keys = [
      "characters", "characterSheets", "events", "birthdays", "calendar",
      "disabledHolidays", "voelker", "berufe", "goetter", "kreaturen",
      "bibliothek", "wiki", "regeln", "heiler", "weather", "news", "map",
      "characterEvents"
    ];

    const report = { imported: [], skipped: [], empty: [], failed: [] };
    let existing;
    try {
      existing = Object.assign(Object.create(null), await fetchAll());
    } catch (e) {
      throw new Error("Import: Datenbank konnte nicht gelesen werden: " + e.message);
    }

    function readBrowser(name) {
      try {
        const raw = localStorage.getItem(name);
        if (raw !== null) return JSON.parse(raw);
      } catch (e) {}
      return undefined;
    }

    for (const name of keys) {
      const dbKey = toDbKey(name);
      const localValue = readBrowser(name);

      if (localValue === undefined || localValue === null ||
          (Array.isArray(localValue) && localValue.length === 0)) {
        report.empty.push(name);
        continue;
      }

      const hasRemote = Object.prototype.hasOwnProperty.call(existing, dbKey) &&
        existing[dbKey] !== null && existing[dbKey] !== undefined &&
        !(Array.isArray(existing[dbKey]) && existing[dbKey].length === 0);

      if (!overwrite && hasRemote) {
        report.skipped.push(name);
        continue;
      }

      try {
        const saved = await save(name, localValue);
        existing[dbKey] = saved;
        report.imported.push(name);
      } catch (err) {
        report.failed.push({ key: name, error: err.message || String(err) });
      }
    }

    return report;
  }

  // ---------- Öffentliche API ----------
  global.ChronikenStorage = {
    load: load,
    save: save,
    refresh: refresh,
    invalidate: invalidate,
    fetchAll: fetchAll,
    ensureMain: ensureMain,
    ensureEvents: ensureEvents,
    ensureChars: ensureChars,
    ensureHealer: ensureHealer,
    ensureMap: ensureMap,
    ensureNamed: load,
    ensureCache: ensureMain,
    importLocalStorage: importLocalStorage,
    DB_KEY: DB_KEY,
    API_BASE: apiBase
  };
})(typeof window !== "undefined" ? window : globalThis);

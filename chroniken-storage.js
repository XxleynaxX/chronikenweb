/* ============================================================
   Chroniken – zentrale Datenspeicherung (MySQL über den Proxy)
   ============================================================ */
(function (global) {
  "use strict";

  const DEFAULT_PROXY = "https://chronikenweb-1.onrender.com";
  const TOKEN_KEY = "chroniken_discord_token";
  const REQUEST_TIMEOUT_MS = 45000;

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

  const DB_KEY = {
    wiki:"wiki", bibliothek:"library", voelker:"races", berufe:"professions",
    goetter:"gods", kreaturen:"creatures", regeln:"rules", rules:"rules",
    news:"news", events:"events", characterEvents:"character_events",
    birthdays:"birthdays", calendar:"calendar", disabledHolidays:"disabled_holidays",
    weather:"weather", moon:"moon", characters:"characters",
    characterSheets:"character_sheets", heiler:"healer_records", map:"map"
  };

  const OBJECT_KEYS = new Set(["weather", "moon"]);
  const cache = Object.create(null);
  let inflightAll = null;

  function toDbKey(name) { return DB_KEY[name] || name; }
  function emptyValue(name) {
    return OBJECT_KEYS.has(name) || OBJECT_KEYS.has(toDbKey(name)) ? {} : [];
  }
  function normalize(name, value) {
    return value === undefined || value === null ? emptyValue(name) : value;
  }

  async function request(path, options, attempt) {
    attempt = attempt || 0;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    const opts = options || {};
    const headers = Object.assign({ "Cache-Control": "no-cache" }, opts.headers || {});
    const token = authToken();

    // Der Server akzeptiert sowohl das Discord-Session-Cookie als auch den
    // Bearer-Token. Der Token muss bei Cross-Site-Requests ausdrücklich
    // mitgesendet werden.
    if (token && !headers.Authorization) headers.Authorization = "Bearer " + token;

    try {
      const res = await fetch(apiBase() + path, Object.assign({
        cache: "no-store",
        credentials: "include"
      }, opts, {
        headers,
        signal: controller ? controller.signal : undefined
      }));

      let body = null;
      try { body = await res.json(); } catch (e) {}

      if (!res.ok || !body || body.ok === false) {
        const msg = (body && body.error) || ("Status " + res.status);
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      return body;
    } catch (e) {
      if (attempt < 1 && (!opts.method || opts.method === "GET") && !(e && (e.status === 401 || e.status === 403))) {
        return request(path, options, attempt + 1);
      }
      if (e && (e.status === 401 || e.status === 403)) throw e;
      throw new Error(e && e.name === "AbortError"
        ? "Der Server antwortet nicht (Zeitüberschreitung)."
        : (e && e.message ? e.message : "Server nicht erreichbar."));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchAll() {
    if (!inflightAll) {
      inflightAll = request("/data").then(body => {
        const out = body.data || {};
        Object.keys(out).forEach(k => { cache[k] = out[k]; });
        return out;
      }).catch(e => {
        throw new Error("Daten laden fehlgeschlagen: " + e.message);
      }).finally(() => { inflightAll = null; });
    }
    return inflightAll;
  }

  async function load(name) {
    const dbKey = toDbKey(name);
    if (Object.prototype.hasOwnProperty.call(cache, dbKey)) return cache[dbKey];

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
    if (name) delete cache[toDbKey(name)];
    else Object.keys(cache).forEach(k => delete cache[k]);
  }

  async function ensureMain() {
    const all = await fetchAll();
    return {
      wiki:normalize("wiki",all.wiki), bibliothek:normalize("bibliothek",all.library),
      voelker:normalize("voelker",all.races), berufe:normalize("berufe",all.professions),
      goetter:normalize("goetter",all.gods), kreaturen:normalize("kreaturen",all.creatures),
      regeln:normalize("regeln",all.rules), news:normalize("news",all.news)
    };
  }

  async function ensureEvents() {
    const all = await fetchAll();
    return {
      events:normalize("events",all.events), characterEvents:normalize("characterEvents",all.character_events),
      birthdays:normalize("birthdays",all.birthdays), calendar:normalize("calendar",all.calendar),
      disabledHolidays:normalize("disabledHolidays",all.disabled_holidays),
      weather:normalize("weather",all.weather), moon:normalize("moon",all.moon)
    };
  }

  async function ensureChars() {
    const all = await fetchAll();
    return { characters:normalize("characters",all.characters), characterSheets:normalize("characterSheets",all.character_sheets) };
  }

  async function ensureHealer() { return { heiler: await load("heiler") }; }
  async function ensureMap() { return { map: await load("map") }; }

  async function importLocalStorage(options) {
    options = options || {};
    const overwrite = options.overwrite === true;
    const keys = ["characters","characterSheets","events","birthdays","calendar","disabledHolidays",
      "voelker","berufe","goetter","kreaturen","bibliothek","wiki","regeln","heiler","weather","news","map","characterEvents"];
    const report = { imported:[], skipped:[], empty:[], failed:[] };
    let existing;
    try { existing = Object.assign(Object.create(null), await fetchAll()); }
    catch (e) { throw new Error("Import: Datenbank konnte nicht gelesen werden: " + e.message); }

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

      if (!overwrite && hasRemote) { report.skipped.push(name); continue; }

      try {
        const saved = await save(name, localValue);
        existing[dbKey] = saved;
        report.imported.push(name);
      } catch (err) {
        report.failed.push({key:name,error:err.message || String(err)});
      }
    }
    return report;
  }

  global.ChronikenStorage = {
    load, save, refresh, invalidate, fetchAll, ensureMain, ensureEvents, ensureChars,
    ensureHealer, ensureMap, ensureNamed:load, ensureCache:ensureMain,
    importLocalStorage, DB_KEY, API_BASE:apiBase
  };
})(typeof window !== "undefined" ? window : globalThis);

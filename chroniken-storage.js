/* ============================================================
   Chroniken – zentrale Supabase-Speicherung (einzige Quelle)
   ============================================================
   Alle gemeinsamen RP-Daten laufen über dieses Modul.
   localStorage dient nur noch als schneller Cache.
   ============================================================ */
(function (global) {
  "use strict";

  // ---------- Konfiguration (nur hier ändern) ----------
  const SUPABASE_URL = "https://wlrsluafjhaeurgmqmci.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kXmLDeP47mcg-ytidwTg_ktUyr1mm";

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
    characters: "characters",
    characterSheets: "character_sheets",
    heiler: "healer_records",
    map: "map"
  };

  // Keys die als Objekt (nicht Array) gespeichert werden
  const OBJECT_KEYS = new Set(["weather"]);

  // ---------- Interner Zustand ----------
  let client = null;
  let readyPromise = null;
  const cache = Object.create(null); // dbKey → value

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

  // ---------- Client laden ----------
  function init() {
    if (client) return Promise.resolve(client);
    if (readyPromise) return readyPromise;

    readyPromise = new Promise(function (resolve, reject) {
      function create() {
        if (!global.supabase || !global.supabase.createClient) {
          reject(new Error("Supabase JS konnte nicht geladen werden."));
          return;
        }
        client = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
        resolve(client);
      }

      if (global.supabase && global.supabase.createClient) {
        create();
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.onload = create;
      script.onerror = function () {
        reject(new Error("Supabase JS konnte nicht geladen werden."));
      };
      document.head.appendChild(script);
    });

    return readyPromise;
  }

  // ---------- Kern-API ----------
  async function fetchAll() {
    const sb = await init();
    const { data, error } = await sb
      .from("chroniken_data")
      .select("key, value, updated_at");

    if (error) {
      throw new Error("Supabase lesen fehlgeschlagen: " + error.message);
    }

    const out = {};
    (data || []).forEach(function (row) {
      out[row.key] = row.value;
      cache[row.key] = row.value;
    });
    return out;
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

    const sb = await init();
    const { data, error } = await sb
      .from("chroniken_data")
      .upsert(
        {
          key: dbKey,
          value: normalized,
          updated_at: new Date().toISOString()
        },
        { onConflict: "key" }
      )
      .select("key, value, updated_at")
      .single();

    if (error) {
      console.error("[ChronikenStorage] Speichern fehlgeschlagen:", dbKey, error);
      throw new Error("Supabase speichern fehlgeschlagen: " + error.message);
    }

    cache[dbKey] = data && data.value !== undefined ? data.value : normalized;
    console.info("[ChronikenStorage] Gespeichert:", dbKey);
    return cache[dbKey];
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
      weather: normalize("weather", all.weather)
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
    const sb = await init();
    const { data: rows, error: readError } = await sb
      .from("chroniken_data")
      .select("key, value");

    if (readError) {
      throw new Error("Import: Datenbank konnte nicht gelesen werden: " + readError.message);
    }

    const existing = Object.create(null);
    (rows || []).forEach(function (row) { existing[row.key] = row.value; });

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
    SUPABASE_URL: SUPABASE_URL
  };
})(typeof window !== "undefined" ? window : globalThis);

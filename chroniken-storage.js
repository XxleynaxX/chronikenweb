/* ============================================================
   Chroniken – gemeinsame Supabase-Speicherung
   ============================================================ */
(function (global) {
  const SUPABASE_URL = "https://wlrsluafjhaeurgmqmci.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable__kXmLDeP47mcg-ytidwTg_ktUyr1mm";

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
    characterEvents: "characterEvents",
    birthdays: "birthdays",
    calendar: "calendar",
    disabledHolidays: "disabledHolidays",
    weather: "weather",
    characters: "characters",
    characterSheets: "character_sheets",
    heiler: "healer_records",
    map: "map"
  };

  const OBJECT_KEYS = new Set(["weather"]);
  let client = null;
  let ready = null;
  const caches = Object.create(null);

  function init() {
    if (client) return Promise.resolve(client);
    if (ready) return ready;

    ready = new Promise(function (resolve, reject) {
      function done() {
        if (!global.supabase || !global.supabase.createClient) {
          reject(new Error("Supabase JS konnte nicht geladen werden."));
          return;
        }
        client = global.supabase.createClient(
          SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY
        );
        resolve(client);
      }

      if (global.supabase && global.supabase.createClient) {
        done();
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.onload = done;
      script.onerror = function () {
        reject(new Error("Supabase JS konnte nicht geladen werden."));
      };
      document.head.appendChild(script);
    });

    return ready;
  }

  // Vorhandene JSON-Werte werden niemals in [] oder {} umgewandelt.
  function normalizeValue(name, value) {
    if (value === undefined || value === null) {
      return OBJECT_KEYS.has(name) ? {} : [];
    }
    return value;
  }

  async function fetchAll() {
    const sb = await init();

    const { data, error } = await sb
      .from("chroniken_data")
      .select("key,value,updated_at");

    if (error) {
      throw new Error("Supabase lesen fehlgeschlagen: " + error.message);
    }

    const out = {};

    (data || []).forEach(function (row) {
      out[row.key] = row.value;
      caches[row.key] = row.value;
    });

    return out;
  }

  async function load(name) {
    const dbKey = DB_KEY[name] || name;

    if (Object.prototype.hasOwnProperty.call(caches, dbKey)) {
      return caches[dbKey];
    }

    const all = await fetchAll();

    if (!Object.prototype.hasOwnProperty.call(all, dbKey)) {
      const empty = normalizeValue(name, undefined);
      caches[dbKey] = empty;
      return empty;
    }

    const value = normalizeValue(name, all[dbKey]);
    caches[dbKey] = value;
    return value;
  }

  async function save(name, value) {
    const dbKey = DB_KEY[name] || name;

    // Nur undefined bekommt einen leeren Startwert.
    // Ein vorhandener Wert wird unverändert gespeichert.
    const normalized = value === undefined
      ? (OBJECT_KEYS.has(name) ? {} : [])
      : value;

    const sb = await init();

    const { data, error } = await sb
      .from("chroniken_data")
      .upsert({
        key: dbKey,
        value: normalized,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "key"
      })
      .select("key,value,updated_at")
      .single();

    if (error) {
      console.error("[ChronikenStorage] Supabase-Speichern fehlgeschlagen:", error);
      console.error("[ChronikenStorage] Key:", dbKey);
      console.error("[ChronikenStorage] Wert:", normalized);
      throw new Error("Supabase speichern fehlgeschlagen: " + error.message);
    }

    caches[dbKey] = data && data.value !== undefined
      ? data.value
      : normalized;

    console.info("[ChronikenStorage] Gespeichert:", dbKey, caches[dbKey]);
    return caches[dbKey];
  }

  async function refresh(name) {
    const dbKey = DB_KEY[name] || name;
    delete caches[dbKey];
    return load(name);
  }

  async function ensureNamed(name) {
    return load(name);
  }

  // Einmaliger Import vorhandener Browser-Daten nach Supabase.
  // Bereits vorhandene Supabase-Daten werden standardmäßig nicht überschrieben.
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
      .select("key,value");

    if (readError) {
      throw new Error("Supabase-Import konnte die Datenbank nicht lesen: " + readError.message);
    }

    const existing = Object.create(null);
    (rows || []).forEach(function (row) { existing[row.key] = row.value; });

    function readBrowserValue(name) {
      try {
        const raw = localStorage.getItem(name);
        if (raw !== null) return JSON.parse(raw);
      } catch (e) {}
      return undefined;
    }

    for (const name of keys) {
      const dbKey = DB_KEY[name] || name;
      const localValue = readBrowserValue(name);

      if (localValue === undefined || localValue === null ||
          (Array.isArray(localValue) && localValue.length === 0)) {
        report.empty.push(name);
        continue;
      }

      if (!overwrite && Object.prototype.hasOwnProperty.call(existing, dbKey) &&
          existing[dbKey] !== null && existing[dbKey] !== undefined &&
          !(Array.isArray(existing[dbKey]) && existing[dbKey].length === 0)) {
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

  async function ensureMain() {
    const all = await fetchAll();

    return {
      wiki: normalizeValue("wiki", all.wiki),
      bibliothek: normalizeValue("bibliothek", all.library),
      voelker: normalizeValue("voelker", all.races),
      berufe: normalizeValue("berufe", all.professions),
      goetter: normalizeValue("goetter", all.gods),
      kreaturen: normalizeValue("kreaturen", all.creatures),
      regeln: normalizeValue("regeln", all.rules),
      news: normalizeValue("news", all.news)
    };
  }

  async function ensureHealer() {
    return { heiler: await load("heiler") };
  }

  async function ensureMap() {
    return { map: await load("map") };
  }

  async function ensureEvents() {
    const all = await fetchAll();

    return {
      events: normalizeValue("events", all.events),
      characterEvents: normalizeValue("characterEvents", all.characterEvents),
      birthdays: normalizeValue("birthdays", all.birthdays),
      calendar: normalizeValue("calendar", all.calendar),
      disabledHolidays: normalizeValue(
        "disabledHolidays",
        all.disabledHolidays
      ),
      weather: normalizeValue("weather", all.weather)
    };
  }

  async function ensureChars() {
    const all = await fetchAll();

    return {
      characters: normalizeValue("characters", all.characters),
      characterSheets: normalizeValue(
        "characterSheets",
        all.character_sheets
      )
    };
  }

  async function ensureCache() {
    return ensureMain();
  }

  function invalidate() {
    Object.keys(caches).forEach(function (key) {
      delete caches[key];
    });
  }

  global.ChronikenStorage = {
    load: load,
    save: save,
    refresh: refresh,
    ensureNamed: ensureNamed,
    importLocalStorage: importLocalStorage,
    ensureMain: ensureMain,
    ensureHealer: ensureHealer,
    ensureMap: ensureMap,
    ensureEvents: ensureEvents,
    ensureChars: ensureChars,
    ensureCache: ensureCache,
    invalidate: invalidate,
    SUPABASE_URL: SUPABASE_URL
  };
})(typeof window !== "undefined" ? window : globalThis);

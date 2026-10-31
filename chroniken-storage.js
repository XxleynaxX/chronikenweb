/* ============================================================
   Chroniken – gemeinsame Supabase-Speicherung

   Alle öffentlichen Chroniken-Daten werden direkt über Supabase
   geladen und gespeichert. Kein JSONBin und kein Render-Proxy
   für die Datenspeicherung.

   Die Publishable-Key darf im Browser verwendet werden.
   Niemals einen Supabase Secret/Service-Role-Key hier eintragen.
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

  const OBJECT_KEYS = new Set(["kreaturen", "weather"]);
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
        client = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
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

  function normalizeValue(name, value) {
    if (OBJECT_KEYS.has(name)) {
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
    return Array.isArray(value) ? value : [];
  }

  async function fetchAll() {
    const sb = await init();
    const { data, error } = await sb
      .from("chroniken_data")
      .select("key,value");

    if (error) {
      throw new Error("Supabase lesen fehlgeschlagen: " + error.message);
    }

    const out = {};
    (data || []).forEach(function (row) {
      out[row.key] = row.value;
    });
    return out;
  }

  async function load(name) {
    const dbKey = DB_KEY[name] || name;
    const all = await fetchAll();
    const value = all[dbKey];

    if (value === undefined || value === null) {
      return OBJECT_KEYS.has(name) ? {} : [];
    }

    const normalized = normalizeValue(name, value);
    caches[dbKey] = normalized;
    return normalized;
  }

  async function save(name, value) {
    const dbKey = DB_KEY[name] || name;
    const normalized = normalizeValue(name, value);
    const sb = await init();

    const { error } = await sb
      .from("chroniken_data")
      .upsert({
        key: dbKey,
        value: normalized,
        updated_at: new Date().toISOString()
      }, { onConflict: "key" });

    if (error) {
      throw new Error("Supabase speichern fehlgeschlagen: " + error.message);
    }

    caches[dbKey] = normalized;
    return normalized;
  }

  async function refresh(name) {
    const dbKey = DB_KEY[name] || name;
    delete caches[dbKey];
    return load(name);
  }

  async function ensureNamed(name) {
    return load(name);
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
      disabledHolidays: normalizeValue("disabledHolidays", all.disabledHolidays),
      weather: all.weather && typeof all.weather === "object" ? all.weather : {}
    };
  }

  async function ensureChars() {
    const all = await fetchAll();
    return {
      characters: normalizeValue("characters", all.characters),
      characterSheets: normalizeValue("characterSheets", all.character_sheets)
    };
  }

  async function ensureCache() {
    return ensureMain();
  }

  function invalidate() {
    Object.keys(caches).forEach(function (k) { delete caches[k]; });
  }

  global.ChronikenStorage = {
    load: load,
    save: save,
    refresh: refresh,
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

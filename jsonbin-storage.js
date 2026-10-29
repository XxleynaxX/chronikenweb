/* ============================================================
   Chroniken – zentrale JSONBin-Speicherung
   Alle Bins gemäß Vorgabe:

   1. Map/Karte          → 6ae28568ac6210605a5a8f1b
   2. Heiler             → 6ae20785ac6210605a595590
   3. Events-Bin         → 6ae18121ffd5d1605391c7c7
      (events, birthdays, calendar, disabledHolidays, weather, characterEvents)
   4. Characters-Bin     → 6ae17c9cffd5d1605391c27b
      (characters, characterSheets)
   5. Main/Wiki-Bin      → 6ae177efffd5d1605391bc4e
      (wiki, bibliothek, voelker, berufe, kreaturen, goetter)
   ============================================================ */
(function (global) {
  const MAIN_BIN_ID   = "6ae177efffd5d1605391bc4e";
  const HEALER_BIN_ID = "6ae20785ac6210605a595590";
  const MAP_BIN_ID    = "6ae28568ac6210605a5a8f1b";
  const EVENTS_BIN_ID = "6ae18121ffd5d1605391c7c7";
  const CHARS_BIN_ID  = "6ae17c9cffd5d1605391c27b";

  const MASTER_KEY = "$2a$10$UtTY0igLD.IvUKF5WDV89uC7/zf7h2HP3R3jXC/mghWJDo20hRpqO";

  const APIS = {
    main:   "https://api.jsonbin.io/v3/b/" + MAIN_BIN_ID,
    healer: "https://api.jsonbin.io/v3/b/" + HEALER_BIN_ID,
    map:    "https://api.jsonbin.io/v3/b/" + MAP_BIN_ID,
    events: "https://api.jsonbin.io/v3/b/" + EVENTS_BIN_ID,
    chars:  "https://api.jsonbin.io/v3/b/" + CHARS_BIN_ID
  };

  // Welcher Key gehört in welchen Bin
  const KEY_TO_BIN = {
    // Main / Wiki-Bin
    wiki: "main",
    bibliothek: "main",
    voelker: "main",
    berufe: "main",
    goetter: "main",
    kreaturen: "main",

    // Events-Bin
    events: "events",
    characterEvents: "events",
    birthdays: "events",
    calendar: "events",
    disabledHolidays: "events",
    weather: "events",

    // Characters-Bin
    characters: "chars",
    characterSheets: "chars",

    // Spezial-Bins
    heiler: "healer",
    map: "map"
  };

  // Keys die als Objekt gespeichert werden (nicht Array)
  const OBJECT_KEYS = ["kreaturen", "weather"];

  // Default-Struktur pro Bin
  const BIN_DEFAULTS = {
    main: {
      wiki: [], bibliothek: [], voelker: [], berufe: [], goetter: [],
      kreaturen: null
    },
    events: {
      events: [], characterEvents: [], birthdays: [],
      calendar: [], disabledHolidays: [], weather: null
    },
    chars: {
      characters: [], characterSheets: []
    },
    healer: { heiler: [] },
    map: { map: [] }
  };

  const caches = { main: null, healer: null, map: null, events: null, chars: null };

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  async function fetchBin(api) {
    const res = await fetch(api + "/latest", {
      headers: { "X-Master-Key": MASTER_KEY, "X-Bin-Meta": "false" }
    });
    if (!res.ok) throw new Error("JSONBin lesen fehlgeschlagen: " + res.status);
    const data = await res.json();
    return (data && data.record !== undefined) ? data.record : (data || {});
  }

  async function putBin(api, record) {
    const res = await fetch(api, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": MASTER_KEY
      },
      body: JSON.stringify(record)
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error("JSONBin speichern fehlgeschlagen: " + res.status + " " + body);
    }
    return res.json();
  }

  function normalizeRecord(binName, record) {
    const defaults = BIN_DEFAULTS[binName] || {};
    const out = Object.assign({}, defaults);
    Object.keys(defaults).forEach(function (k) {
      if (OBJECT_KEYS.includes(k)) {
        out[k] = isObj(record[k]) ? record[k] : null;
      } else {
        out[k] = Array.isArray(record[k]) ? record[k] : [];
      }
    });
    // Extra-Keys aus dem Record behalten
    Object.keys(record || {}).forEach(function (k) {
      if (!(k in out)) out[k] = record[k];
    });
    return out;
  }

  async function ensureBin(binName) {
    if (caches[binName]) return caches[binName];
    const raw = await fetchBin(APIS[binName]);
    caches[binName] = normalizeRecord(binName, raw && typeof raw === "object" ? raw : {});
    return caches[binName];
  }

  async function ensureMain() { return ensureBin("main"); }
  async function ensureHealer() { return ensureBin("healer"); }
  async function ensureMap() { return ensureBin("map"); }
  async function ensureEvents() { return ensureBin("events"); }
  async function ensureChars() { return ensureBin("chars"); }

  /**
   * Wird von chroniken-data.js erwartet.
   * Lädt den Main-Bin und gibt die Collections zurück.
   */
  async function ensureCache() {
    return ensureMain();
  }

  function binFor(name) {
    return KEY_TO_BIN[name] || "main";
  }

  async function load(name) {
    const bin = binFor(name);
    const data = await ensureBin(bin);

    if (name === "map") return Array.isArray(data.map) ? data.map : [];
    if (name === "heiler") return Array.isArray(data.heiler) ? data.heiler : [];

    if (OBJECT_KEYS.includes(name)) {
      return isObj(data[name]) ? data[name] : null;
    }
    return Array.isArray(data[name]) ? data[name] : [];
  }

  async function save(name, value) {
    const bin = binFor(name);
    const api = APIS[bin];

    // Immer frisch vom Server holen, damit parallele Änderungen nicht überschrieben werden
    const latest = await fetchBin(api);
    const record = (latest && typeof latest === "object") ? Object.assign({}, latest) : {};

    if (name === "map") {
      record.map = Array.isArray(value) ? value : [];
    } else if (name === "heiler") {
      record.heiler = Array.isArray(value) ? value : [];
    } else if (OBJECT_KEYS.includes(name)) {
      record[name] = isObj(value) ? value : null;
    } else {
      record[name] = Array.isArray(value) ? value : [];
    }

    // Cache aktualisieren
    caches[bin] = normalizeRecord(bin, record);
    await putBin(api, record);

    if (name === "map") return caches[bin].map;
    if (name === "heiler") return caches[bin].heiler;
    if (OBJECT_KEYS.includes(name)) return caches[bin][name];
    return caches[bin][name];
  }

  async function refresh(name) {
    const bin = binFor(name);
    caches[bin] = null;
    return load(name);
  }

  /** Cache für einen bestimmten Bin leeren */
  function invalidate(binName) {
    if (binName) caches[binName] = null;
    else Object.keys(caches).forEach(function (k) { caches[k] = null; });
  }

  global.ChronikenStorage = {
    load,
    save,
    refresh,
    ensureMain,
    ensureHealer,
    ensureMap,
    ensureEvents,
    ensureChars,
    ensureCache,          // ← fehlte vorher → Sync in chroniken-data.js ging kaputt
    invalidate,
    MAIN_BIN_ID,
    HEALER_BIN_ID,
    MAP_BIN_ID,
    EVENTS_BIN_ID,
    CHARS_BIN_ID
  };
})(typeof window !== "undefined" ? window : globalThis);

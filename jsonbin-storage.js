/* ============================================================
   Chroniken – zentrale Speicherung über JSONBin
   Bin-ID und Master-Key hier pflegen.
   ============================================================ */
(function (global) {
  const BIN_ID = "6ae177efffd5d1605391bc4e";
  const MASTER_KEY = "$2a$10$UtTY0igLD.IvUKF5WDV89uC7/zf7h2HP3R3jXC/mghWJDo20hRpqO";
  const API_BASE = "https://api.jsonbin.io/v3/b/" + BIN_ID;

  // In-Memory Cache, damit die UI schnell bleibt
  let cache = null;
  let loadingPromise = null;

  async function fetchBin() {
    const res = await fetch(API_BASE + "/latest", {
      headers: {
        "X-Master-Key": MASTER_KEY
      }
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error("JSONBin lesen fehlgeschlagen: " + res.status + " " + err);
    }
    const data = await res.json();
    return data.record || {};
  }

  async function saveBin(record) {
    const res = await fetch(API_BASE, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": MASTER_KEY
      },
      body: JSON.stringify(record)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error("JSONBin speichern fehlgeschlagen: " + res.status + " " + err);
    }
    return res.json();
  }

  function normalizeKreaturen(val) {
    // Kreaturen ist ein Objekt mit Kategorien, kein Array
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return val;
    }
    return null; // leer / ungültig → wird später mit Defaults befüllt
  }

  async function ensureCache() {
    if (cache) return cache;
    if (loadingPromise) return loadingPromise;

    loadingPromise = fetchBin()
      .then(record => {
        cache = {
          wiki: Array.isArray(record.wiki) ? record.wiki : [],
          bibliothek: Array.isArray(record.bibliothek) ? record.bibliothek : [],
          voelker: Array.isArray(record.voelker) ? record.voelker : [],
          berufe: Array.isArray(record.berufe) ? record.berufe : [],
          goetter: Array.isArray(record.goetter) ? record.goetter : [],
          kreaturen: normalizeKreaturen(record.kreaturen)
        };
        return cache;
      })
      .finally(() => {
        loadingPromise = null;
      });

    return loadingPromise;
  }

  /**
   * Lädt eine Collection.
   * wiki/bibliothek/voelker/berufe/goetter → Array
   * kreaturen → Objekt oder null
   */
  async function loadCollection(name) {
    const data = await ensureCache();
    if (name === "kreaturen") {
      return data.kreaturen; // Objekt oder null
    }
    return Array.isArray(data[name]) ? data[name] : [];
  }

  /**
   * Speichert eine Collection und schreibt den gesamten Bin zurück.
   */
  async function saveCollection(name, items) {
    const data = await ensureCache();

    if (name === "kreaturen") {
      // Objekt erlauben
      data.kreaturen = (items && typeof items === "object" && !Array.isArray(items))
        ? items
        : null;
    } else {
      data[name] = Array.isArray(items) ? items : [];
    }

    cache = data;
    await saveBin(data);
  }

  function setCache(newCache) {
    cache = newCache;
  }

  function clearCache() {
    cache = null;
  }

  global.ChronikenStorage = {
    load: loadCollection,
    save: saveCollection,
    ensureCache,
    clearCache,
    setCache,
    BIN_ID,
    MASTER_KEY
  };
})(typeof window !== "undefined" ? window : globalThis);

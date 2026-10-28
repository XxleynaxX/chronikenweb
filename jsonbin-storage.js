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

  async function ensureCache() {
    if (cache) return cache;
    if (loadingPromise) return loadingPromise;

    loadingPromise = fetchBin()
      .then(record => {
        // Sicherstellen, dass alle erwarteten Keys existieren
        cache = {
          wiki: Array.isArray(record.wiki) ? record.wiki : [],
          bibliothek: Array.isArray(record.bibliothek) ? record.bibliothek : [],
          voelker: Array.isArray(record.voelker) ? record.voelker : [],
          berufe: Array.isArray(record.berufe) ? record.berufe : [],
          goetter: Array.isArray(record.goetter) ? record.goetter : [],
          kreaturen: Array.isArray(record.kreaturen) ? record.kreaturen : []
        };
        return cache;
      })
      .finally(() => {
        loadingPromise = null;
      });

    return loadingPromise;
  }

  /**
   * Lädt eine Collection (z.B. "wiki", "bibliothek", "voelker" ...)
   * @returns {Promise<Array>}
   */
  async function loadCollection(name) {
    const data = await ensureCache();
    return Array.isArray(data[name]) ? data[name] : [];
  }

  /**
   * Speichert eine Collection und schreibt den gesamten Bin zurück.
   * @returns {Promise<void>}
   */
  async function saveCollection(name, items) {
    const data = await ensureCache();
    data[name] = Array.isArray(items) ? items : [];
    cache = data;
    await saveBin(data);
  }

  /**
   * Kompletten Cache manuell aktualisieren (z.B. nach Admin-Änderungen)
   */
  function setCache(newCache) {
    cache = newCache;
  }

  /**
   * Cache leeren (z.B. für erzwungenes Neuladen)
   */
  function clearCache() {
    cache = null;
  }

  // Öffentliche API
  global.ChronikenStorage = {
    load: loadCollection,
    save: saveCollection,
    ensureCache,
    clearCache,
    setCache,
    // Direktzugriff für spezielle Fälle
    BIN_ID,
    MASTER_KEY
  };
})(typeof window !== "undefined" ? window : globalThis);

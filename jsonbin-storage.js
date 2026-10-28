/* ============================================================
   Chroniken – zentrale JSONBin-Speicherung
   Haupt-Bin + separater Heiler-Bin
   ============================================================ */
(function (global) {
  const MAIN_BIN_ID = "6ae177efffd5d1605391bc4e";
  const HEALER_BIN_ID = "6ae20785ac6210605a595590";

  const MASTER_KEY = "$2a$10$UtTY0igLD.IvUKF5WDV89uC7/zf7h2HP3R3jXC/mghWJDo20hRpqO";

  const MAIN_API = "https://api.jsonbin.io/v3/b/" + MAIN_BIN_ID;
  const HEALER_API = "https://api.jsonbin.io/v3/b/" + HEALER_BIN_ID;

  const mainCollections = [
    "wiki","bibliothek","voelker","berufe","goetter","calendar",
    "birthdays","characterEvents","disabledHolidays"
  ];

  let mainCache = null;
  let healerCache = null;

  async function fetchBin(api) {
    const res = await fetch(api + "/latest", {
      headers: {"X-Master-Key": MASTER_KEY}
    });
    if (!res.ok) throw new Error("JSONBin lesen fehlgeschlagen: " + res.status);
    const data = await res.json();
    return data.record || {};
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

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  const OBJECT_KEYS = ["kreaturen", "weather"];

  function defaults(record) {
    const out = {};
    mainCollections.forEach(name => {
      out[name] = Array.isArray(record[name]) ? record[name] : [];
    });
    out.kreaturen = record.kreaturen && typeof record.kreaturen === "object" && !Array.isArray(record.kreaturen)
      ? record.kreaturen : null;
    out.weather = isObj(record.weather) ? record.weather : null;
    return out;
  }

  async function ensureMain() {
    if (mainCache) return mainCache;
    mainCache = defaults(await fetchBin(MAIN_API));
    return mainCache;
  }

  async function ensureHealer() {
    if (healerCache) return healerCache;
    const record = await fetchBin(HEALER_API);
    healerCache = {
      heiler: Array.isArray(record.heiler) ? record.heiler : []
    };
    return healerCache;
  }

  async function load(name) {
    if (name === "heiler") {
      return (await ensureHealer()).heiler;
    }
    const data = await ensureMain();
    return OBJECT_KEYS.includes(name) ? data[name] : (Array.isArray(data[name]) ? data[name] : []);
  }

  async function save(name, value) {
    if (name === "heiler") {
      const latest = await fetchBin(HEALER_API);
      latest.heiler = Array.isArray(value) ? value : [];
      healerCache = {heiler: latest.heiler};
      await putBin(HEALER_API, latest);
      return healerCache.heiler;
    }

    const data = await ensureMain();
    const latest = await fetchBin(MAIN_API);
    latest[name] = OBJECT_KEYS.includes(name)
      ? (isObj(value) ? value : null)
      : (Array.isArray(value) ? value : []);
    data[name] = latest[name];
    mainCache = data;
    await putBin(MAIN_API, latest);
    return data[name];
  }

  async function refresh(name) {
    if (name === "heiler") {
      healerCache = null;
      return load("heiler");
    }
    mainCache = null;
    return load(name);
  }

  global.ChronikenStorage = {
    load, save, refresh, ensureMain, ensureHealer,
    MAIN_BIN_ID, HEALER_BIN_ID
  };
})(typeof window !== "undefined" ? window : globalThis);

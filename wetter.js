/**
 * Chroniken – Wetter-Kern
 * =======================
 * Config-Priorität:
 *   1. localStorage (Admin-Änderungen, nur Browser)
 *   2. weather-config.js (Defaults + Discord)
 *
 * Live-Steuerung (nur Browser, localStorage):
 *   forceWeather / skipWeather / resetTimer / clearOverride
 *
 * Discord (GitHub Action) sieht nur weather-config.js + Zeitslots.
 * Nach Admin-Änderungen: „Für Repo exportieren“ → weather-config.js.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "chroniken_weather_config_v2";
  const OVERRIDE_KEY = "chroniken_weather_override_v1";

  function getFileConfig() {
    const raw =
      (typeof CHRONIKEN_WEATHER_CONFIG !== "undefined" && CHRONIKEN_WEATHER_CONFIG) ||
      (typeof globalThis !== "undefined" && globalThis.CHRONIKEN_WEATHER_CONFIG) ||
      null;

    if (!raw || !Array.isArray(raw.weather) || !raw.weather.length) {
      return {
        intervalHours: 6,
        weather: [
          {
            name: "Klarer Himmel",
            icon: "☀️",
            description: "Ein ruhiger, heller Tag liegt über dem Land.",
            weight: 12
          }
        ]
      };
    }

    return normalizeConfig(raw);
  }

  function normalizeConfig(raw) {
    return {
      intervalHours: Math.max(1, Number(raw.intervalHours) || 6),
      weather: (raw.weather || []).map(function (w) {
        return {
          name: String(w.name || "Unbekannt").trim() || "Unbenannt",
          icon: String(w.icon || "🌤️").trim() || "🌤️",
          description: String(w.description || "").trim(),
          weight: Math.max(0, Number(w.weight) || 0)
        };
      })
    };
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.weather) && parsed.weather.length) {
          return normalizeConfig(parsed);
        }
      }
    } catch (e) {}
    return getFileConfig();
  }

  function saveConfig(cfg) {
    const clean = normalizeConfig(cfg || {});
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch (e) {
      console.warn("[ChronikenWeather] localStorage speichern fehlgeschlagen:", e);
    }
    emitChange(get());
    return clean;
  }

  function clearLocalConfig() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    emitChange(get());
    return getFileConfig();
  }

  function exportConfigJs(cfg) {
    cfg = normalizeConfig(cfg || loadConfig());
    const lines = cfg.weather.map(function (w) {
      return (
        "      { name: " +
        JSON.stringify(w.name) +
        ", icon: " +
        JSON.stringify(w.icon) +
        ", description: " +
        JSON.stringify(w.description) +
        ", weight: " +
        w.weight +
        " }"
      );
    });

    return [
      "/**",
      " * Chroniken – zentrale Wetter-Config",
      " * Generiert aus Admin – in weather-config.js ersetzen und deployen.",
      " */",
      "(function (root) {",
      '  "use strict";',
      "",
      "  const WEATHER_CONFIG = {",
      "    intervalHours: " + cfg.intervalHours + ",",
      "    weather: [",
      lines.join(",\n"),
      "    ]",
      "  };",
      "",
      '  if (typeof root !== "undefined") {',
      "    root.CHRONIKEN_WEATHER_CONFIG = WEATHER_CONFIG;",
      "  }",
      '  if (typeof module !== "undefined" && module.exports) {',
      "    module.exports = WEATHER_CONFIG;",
      "  }",
      '})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);',
      ""
    ].join("\n");
  }

  function slotMs(cfg) {
    return (cfg.intervalHours || 6) * 60 * 60 * 1000;
  }

  function currentSlot(cfg) {
    return Math.floor(Date.now() / slotMs(cfg));
  }

  function randomIndex(seed, length) {
    let x = (seed * 1103515245 + 12345) >>> 0;
    x = ((x ^ (x >>> 16)) * 2246822519) >>> 0;
    return x % length;
  }

  function pickWeighted(seed, list) {
    const total = list.reduce(function (sum, w) {
      return sum + Math.max(0, Number(w.weight) || 0);
    }, 0);

    if (total <= 0) {
      return list[randomIndex(seed, list.length)] || list[0];
    }

    let r = randomIndex(seed, total);
    for (let i = 0; i < list.length; i++) {
      r -= Math.max(0, Number(list[i].weight) || 0);
      if (r < 0) return list[i];
    }
    return list[list.length - 1];
  }

  /** Zufällige Lage (echte Zufallszahl), optional ohne aktuellen Namen */
  function pickRandom(list, excludeName) {
    const pool = (list || []).filter(function (w) {
      if (!w) return false;
      if (excludeName && w.name === excludeName) return false;
      return true;
    });
    const use = pool.length ? pool : list || [];
    if (!use.length) {
      return {
        name: "Unbekannt",
        icon: "🌤️",
        description: "",
        weight: 1
      };
    }
    const total = use.reduce(function (s, w) {
      return s + Math.max(0, Number(w.weight) || 0);
    }, 0);
    if (total <= 0) {
      return use[Math.floor(Math.random() * use.length)];
    }
    let r = Math.random() * total;
    for (let i = 0; i < use.length; i++) {
      r -= Math.max(0, Number(use[i].weight) || 0);
      if (r < 0) return use[i];
    }
    return use[use.length - 1];
  }

  // ---------- Override (Admin Live-Steuerung, nur Browser) ----------

  function readOverride() {
    try {
      const raw = localStorage.getItem(OVERRIDE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.until || !o.name) return null;
      if (Date.now() >= Number(o.until)) {
        try {
          localStorage.removeItem(OVERRIDE_KEY);
        } catch (e) {}
        return null;
      }
      return o;
    } catch (e) {
      return null;
    }
  }

  function writeOverride(o) {
    try {
      if (!o) localStorage.removeItem(OVERRIDE_KEY);
      else localStorage.setItem(OVERRIDE_KEY, JSON.stringify(o));
    } catch (e) {
      console.warn("[ChronikenWeather] Override speichern fehlgeschlagen:", e);
    }
  }

  function stateFromOverride(o, cfg) {
    cfg = cfg || loadConfig();
    return {
      slot: "override",
      name: o.name,
      icon: o.icon || "🌤️",
      description: o.description || "",
      weight: o.weight || 0,
      changedAt: new Date(o.startedAt || Date.now()).toISOString(),
      intervalHours: cfg.intervalHours,
      forced: true,
      until: o.until
    };
  }

  function getWeatherState(s, cfg) {
    cfg = cfg || loadConfig();
    const list =
      cfg.weather && cfg.weather.length ? cfg.weather : getFileConfig().weather;
    const w = pickWeighted(s, list);
    const ms = slotMs(cfg);
    return {
      slot: s,
      name: w.name,
      icon: w.icon,
      description: w.description,
      weight: w.weight,
      changedAt: new Date(s * ms).toISOString(),
      intervalHours: cfg.intervalHours,
      forced: false
    };
  }

  function get() {
    const cfg = loadConfig();
    const o = readOverride();
    if (o) return stateFromOverride(o, cfg);
    return getWeatherState(currentSlot(cfg), cfg);
  }

  function msNext() {
    const o = readOverride();
    if (o) return Math.max(0, Number(o.until) - Date.now());
    const cfg = loadConfig();
    const ms = slotMs(cfg);
    return ms - (Date.now() % ms);
  }

  function format(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return (
      String(h).padStart(2, "0") +
      ":" +
      String(m).padStart(2, "0") +
      ":" +
      String(s).padStart(2, "0")
    );
  }

  function nextChangeTime() {
    return new Date(Date.now() + msNext());
  }

  let lastSlot = null;
  let lastForcedUntil = null;

  function emitChange(state) {
    state = state || get();
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(
        new CustomEvent("chroniken-weather-changed", { detail: state })
      );
    }
  }

  function watch() {
    const cfg = loadConfig();
    const o = readOverride();

    if (o) {
      // Override aktiv: nur ablaufen lassen
      if (lastForcedUntil !== o.until) {
        lastForcedUntil = o.until;
      }
      return;
    }

    // Override gerade abgelaufen?
    if (lastForcedUntil !== null) {
      lastForcedUntil = null;
      lastSlot = currentSlot(cfg);
      emitChange(getWeatherState(lastSlot, cfg));
      return;
    }

    const current = currentSlot(cfg);
    if (lastSlot === null) {
      lastSlot = current;
      return;
    }
    if (current !== lastSlot) {
      lastSlot = current;
      emitChange(getWeatherState(current, cfg));
    }
  }

  /** Wetter erzwingen für ein volles Intervall (ab jetzt) */
  function forceWeather(w) {
    const cfg = loadConfig();
    const ms = slotMs(cfg);
    const now = Date.now();
    const entry = {
      name: String((w && w.name) || "Unbekannt"),
      icon: String((w && w.icon) || "🌤️"),
      description: String((w && w.description) || ""),
      weight: Math.max(0, Number(w && w.weight) || 0),
      startedAt: now,
      until: now + ms
    };
    writeOverride(entry);
    lastForcedUntil = entry.until;
    lastSlot = null;
    const state = stateFromOverride(entry, cfg);
    emitChange(state);
    return state;
  }

  /**
   * Skip: neues Zufalls-Wetter (anders als aktuell), Timer neu auf volles Intervall
   */
  function skipWeather() {
    const cfg = loadConfig();
    const cur = get();
    const next = pickRandom(cfg.weather, cur && cur.name);
    return forceWeather(next);
  }

  /**
   * Timer Reset: aktuelles Wetter behalten, Countdown wieder auf volles Intervall
   */
  function resetTimer() {
    const cfg = loadConfig();
    const cur = get();
    return forceWeather({
      name: cur.name,
      icon: cur.icon,
      description: cur.description,
      weight: cur.weight
    });
  }

  /** Override beenden → wieder normaler Zeitslot */
  function clearOverride() {
    writeOverride(null);
    lastForcedUntil = null;
    const cfg = loadConfig();
    lastSlot = currentSlot(cfg);
    const state = getWeatherState(lastSlot, cfg);
    emitChange(state);
    return state;
  }

  if (typeof setInterval !== "undefined") {
    setInterval(watch, 1000);
  }

  const api = {
    get: get,
    getWeatherState: function (s) {
      const cfg = loadConfig();
      const o = readOverride();
      if (o && s == null) return stateFromOverride(o, cfg);
      return getWeatherState(s == null ? currentSlot(cfg) : s, cfg);
    },
    msNext: msNext,
    format: format,
    nextChangeTime: nextChangeTime,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    clearLocalConfig: clearLocalConfig,
    exportConfigJs: exportConfigJs,
    getFileConfig: getFileConfig,
    getWeatherList: function () {
      return loadConfig().weather;
    },
    forceWeather: forceWeather,
    skipWeather: skipWeather,
    resetTimer: resetTimer,
    clearOverride: clearOverride,
    DEFAULT_CONFIG: getFileConfig(),
    STORAGE_KEY: STORAGE_KEY,
    OVERRIDE_KEY: OVERRIDE_KEY
  };

  if (typeof window !== "undefined") {
    window.ChronikenWeather = api;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();

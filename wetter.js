/**
 * Chroniken – Wetter-Kern
 * =======================
 * Config-Priorität:
 *   1. localStorage (Admin-Änderungen, nur Browser)
 *   2. weather-config.js (Defaults + Discord)
 *
 * Discord (GitHub Action) sieht nur weather-config.js.
 * Nach Admin-Änderungen: im Admin „Für Repo exportieren“
 * und Inhalt in weather-config.js einfügen + deployen.
 *
 * Admin-Override (Skip / Erzwingen / Timer-Reset):
 *   localStorage-Key chroniken_weather_override_v1
 *   { mode: "force"|"skip", weather?: {...}, until: ms, startedAt: ms }
 *   Gilt nur im Browser, nicht für Discord.
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
          { name: "Klarer Himmel", icon: "☀️", description: "Ein ruhiger, heller Tag liegt über dem Land.", weight: 12 }
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
    return clean;
  }

  function clearLocalConfig() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    return getFileConfig();
  }

  /** Erzeugt den Inhalt für weather-config.js (zum Kopieren ins Repo) */
  function exportConfigJs(cfg) {
    cfg = normalizeConfig(cfg || loadConfig());
    const lines = cfg.weather.map(function (w) {
      return (
        "      { name: " + JSON.stringify(w.name) +
        ", icon: " + JSON.stringify(w.icon) +
        ", description: " + JSON.stringify(w.description) +
        ", weight: " + w.weight + " }"
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
      "})(typeof globalThis !== \"undefined\" ? globalThis : typeof window !== \"undefined\" ? window : this);",
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

  /* ========== Override (Admin: Skip / Force / Timer-Reset) ========== */

  function loadOverride() {
    try {
      const raw = localStorage.getItem(OVERRIDE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.until !== "number") return null;
      if (Date.now() >= o.until) {
        clearOverride();
        return null;
      }
      return o;
    } catch (e) {
      return null;
    }
  }

  function saveOverride(o) {
    try {
      if (!o) {
        localStorage.removeItem(OVERRIDE_KEY);
        return null;
      }
      localStorage.setItem(OVERRIDE_KEY, JSON.stringify(o));
      return o;
    } catch (e) {
      console.warn("[ChronikenWeather] Override speichern fehlgeschlagen:", e);
      return null;
    }
  }

  function clearOverride() {
    try {
      localStorage.removeItem(OVERRIDE_KEY);
    } catch (e) {}
  }

  /**
   * Erzwingt ein bestimmtes Wetter für die angegebene Dauer (ms).
   * durationMs weglassen → volles aktuelles Intervall.
   */
  function forceWeather(weatherObj, durationMs) {
    const cfg = loadConfig();
    const ms = slotMs(cfg);
    const until = Date.now() + (durationMs != null ? Math.max(1000, durationMs) : ms);
    const o = {
      mode: "force",
      weather: {
        name: String(weatherObj.name || "Unbekannt"),
        icon: String(weatherObj.icon || "🌤️"),
        description: String(weatherObj.description || ""),
        weight: Number(weatherObj.weight) || 0
      },
      startedAt: Date.now(),
      until: until
    };
    saveOverride(o);
    emitChanged();
    return o;
  }

  /**
   * Skip: wählt sofort ein neues (gewichtetes) Wetter und startet den Timer neu.
   * Optional: seedOffset, damit es sich vom aktuellen Slot unterscheidet.
   */
  function skipWeather() {
    const cfg = loadConfig();
    const list = cfg.weather && cfg.weather.length ? cfg.weather : getFileConfig().weather;
    const seed = Date.now() ^ (currentSlot(cfg) * 7919);
    const w = pickWeighted(seed, list);
    const ms = slotMs(cfg);
    const o = {
      mode: "skip",
      weather: {
        name: w.name,
        icon: w.icon,
        description: w.description,
        weight: w.weight
      },
      startedAt: Date.now(),
      until: Date.now() + ms
    };
    saveOverride(o);
    emitChanged();
    return o;
  }

  /**
   * Timer-Reset: behält das aktuelle Wetter, setzt aber die Restzeit auf ein volles Intervall.
   */
  function resetTimer() {
    const cfg = loadConfig();
    const state = get(); // aktuelles (ggf. Override)
    const ms = slotMs(cfg);
    const o = {
      mode: "force",
      weather: {
        name: state.name,
        icon: state.icon,
        description: state.description,
        weight: state.weight
      },
      startedAt: Date.now(),
      until: Date.now() + ms
    };
    saveOverride(o);
    emitChanged();
    return o;
  }

  function getWeatherState(s, cfg) {
    cfg = cfg || loadConfig();
    const list = cfg.weather && cfg.weather.length ? cfg.weather : getFileConfig().weather;
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
    const ov = loadOverride();
    if (ov && ov.weather) {
      return {
        slot: -1,
        name: ov.weather.name,
        icon: ov.weather.icon,
        description: ov.weather.description,
        weight: ov.weather.weight || 0,
        changedAt: new Date(ov.startedAt || Date.now()).toISOString(),
        intervalHours: cfg.intervalHours,
        forced: true,
        overrideMode: ov.mode,
        until: ov.until
      };
    }
    return getWeatherState(currentSlot(cfg), cfg);
  }

  function msNext() {
    const ov = loadOverride();
    if (ov && typeof ov.until === "number") {
      return Math.max(0, ov.until - Date.now());
    }
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
      String(h).padStart(2, "0") + ":" +
      String(m).padStart(2, "0") + ":" +
      String(s).padStart(2, "0")
    );
  }

  function nextChangeTime() {
    return new Date(Date.now() + msNext());
  }

  function emitChanged() {
    if (typeof window === "undefined") return;
    const state = get();
    window.dispatchEvent(
      new CustomEvent("chroniken-weather-changed", { detail: state })
    );
  }

  let lastSlot = null;
  let lastOverrideUntil = null;

  function watch() {
    const cfg = loadConfig();
    const ov = loadOverride();
    const current = currentSlot(cfg);
    const until = ov ? ov.until : null;

    // Override abgelaufen?
    if (lastOverrideUntil != null && (until == null || Date.now() >= lastOverrideUntil)) {
      lastOverrideUntil = null;
      lastSlot = current;
      emitChanged();
      return;
    }

    if (ov) {
      lastOverrideUntil = ov.until;
      return; // während Override kein Slot-Wechsel
    }

    if (lastSlot === null) {
      lastSlot = current;
      return;
    }
    if (current !== lastSlot) {
      lastSlot = current;
      emitChanged();
    }
  }

  if (typeof setInterval !== "undefined") {
    setInterval(watch, 1000);
  }

  const api = {
    get: get,
    getWeatherState: function (s) {
      const cfg = loadConfig();
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
    // Admin-Steuerung
    forceWeather: forceWeather,
    skipWeather: skipWeather,
    resetTimer: resetTimer,
    clearOverride: function () {
      clearOverride();
      emitChanged();
    },
    getOverride: loadOverride,
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

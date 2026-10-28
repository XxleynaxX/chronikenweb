/**
 * Chroniken – zentrale Wetter-Config
 * ==================================
 * EINZIGE Quelle für:
 *   - Intervall (Stunden)
 *   - Wetterlagen + Gewichte
 *
 * Wird von wetter.js (Webseite) und von
 * chroniken-discord-proxy/weather.js (Discord-Meldung auf Render) gelesen.
 * Liegt Render nur im Proxy-Ordner, nutzt er die Kopie
 * chroniken-discord-proxy/weather-config.js – Änderungen dort mit übernehmen.
 *
 * Änderungen nur hier vornehmen und deployen.
 * Kein localStorage.
 */
(function (root) {
  "use strict";

  const WEATHER_CONFIG = {
    /** Stunden bis zum nächsten Wetterwechsel (z. B. 6) */
    intervalHours: 6,

    /**
     * Wetterlagen.
     * weight = relative Chance (höher = kommt öfter).
     * weight 0 = wird nie gewählt.
     */
    weather: [
      { name: "Klarer Himmel",     icon: "☀️",  description: "Ein ruhiger, heller Tag liegt über dem Land.",                    weight: 12 },
      { name: "Leichter Wind",     icon: "🍃",  description: "Ein sanfter Wind zieht durch Wälder und Gassen.",                 weight: 12 },
      { name: "Bewölkt",           icon: "☁️",  description: "Wolken ziehen über den Himmel, doch es bleibt trocken.",          weight: 12 },
      { name: "Nebel",             icon: "🌫️",  description: "Dichter Nebel liegt über dem Land und verschluckt die Ferne.",   weight: 8 },
      { name: "Leichter Regen",    icon: "🌦️",  description: "Feiner Regen fällt und lässt die Straßen glänzen.",               weight: 10 },
      { name: "Starker Regen",     icon: "🌧️",  description: "Kräftiger Regen prasselt auf Dächer und Wege.",                  weight: 6 },
      { name: "Gewitter",          icon: "⛈️",  description: "Donner grollt am Horizont und Blitze erhellen die Wolken.",       weight: 4 },
      { name: "Starker Wind",      icon: "🌬️",  description: "Böen ziehen durch das Land und lassen Äste rauschen.",           weight: 8 },
      { name: "Schneefall",        icon: "🌨️",  description: "Leiser Schnee fällt vom Himmel und bedeckt die Landschaft.",     weight: 5 },
      { name: "Starker Schneefall",icon: "❄️",  description: "Dichter Schnee fällt und macht Wege langsam schwer passierbar.", weight: 3 },
      { name: "Frost",             icon: "🥶",  description: "Klare Kälte liegt in der Luft und Reif bedeckt die Landschaft.", weight: 5 },
      { name: "Dunstiger Morgen",  icon: "🌤️",  description: "Heller Dunst liegt über dem Land und löst sich langsam auf.",    weight: 5 }
    ]
  };

  // Browser
  if (typeof root !== "undefined") {
    root.CHRONIKEN_WEATHER_CONFIG = WEATHER_CONFIG;
  }

  // Node (Render-Proxy)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = WEATHER_CONFIG;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);

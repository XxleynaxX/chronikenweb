(function () {
  const SLOT_MS = 6 * 60 * 60 * 1000;

  /*
   * EINZIGE WETTERLISTE FÜR CHRONIKEN
   *
   * Diese Liste muss mit weather-notify.js identisch bleiben.
   */
  const WEATHER = [
    [
      "Klarer Himmel",
      "☀️",
      "Ein ruhiger, heller Tag liegt über dem Land."
    ],
    [
      "Leichter Wind",
      "🍃",
      "Ein sanfter Wind zieht durch Wälder und Gassen."
    ],
    [
      "Bewölkt",
      "☁️",
      "Wolken ziehen über den Himmel, doch es bleibt trocken."
    ],
    [
      "Nebel",
      "🌫️",
      "Dichter Nebel liegt über dem Land und verschluckt die Ferne."
    ],
    [
      "Leichter Regen",
      "🌦️",
      "Feiner Regen fällt und lässt die Straßen glänzen."
    ],
    [
      "Starker Regen",
      "🌧️",
      "Kräftiger Regen prasselt auf Dächer und Wege."
    ],
    [
      "Gewitter",
      "⛈️",
      "Donner grollt am Horizont und Blitze erhellen die Wolken."
    ],
    [
      "Starker Wind",
      "🌬️",
      "Böen ziehen durch das Land und lassen Äste rauschen."
    ],
    [
      "Schneefall",
      "🌨️",
      "Leiser Schnee fällt vom Himmel und bedeckt die Landschaft."
    ],
    [
      "Starker Schneefall",
      "❄️",
      "Dichter Schnee fällt und macht Wege langsam schwer passierbar."
    ],
    [
      "Frost",
      "🥶",
      "Klare Kälte liegt in der Luft und Reif bedeckt die Landschaft."
    ],
    [
      "Dunstiger Morgen",
      "🌤️",
      "Heller Dunst liegt über dem Land und löst sich langsam auf."
    ]
  ];

  /*
   * Der 6-Stunden-Slot ist die Grundlage
   * für die Wetterauswahl.
   */
  function slot() {
    return Math.floor(Date.now() / SLOT_MS);
  }

  /*
   * Deterministische Zufallsberechnung.
   *
   * Gleicher Slot + gleiche Wetterliste
   * = immer dasselbe Wetter.
   */
  function randomIndex(seed, length) {
    let x = (seed * 1103515245 + 12345) >>> 0;
    x = ((x ^ (x >>> 16)) * 2246822519) >>> 0;

    return x % length;
  }

  /*
   * Wetter für einen bestimmten Slot auswählen.
   */
  function pickWeather(s) {
    if (!WEATHER.length) {
      throw new Error("Keine Wetterlagen vorhanden.");
    }

    return WEATHER[randomIndex(s, WEATHER.length)];
  }

  /*
   * Vollständigen Wetterzustand erstellen.
   */
  function getWeatherState(s) {
    const w = pickWeather(s);

    return {
      slot: s,
      name: w[0],
      icon: w[1],
      description: w[2],
      changedAt: new Date(s * SLOT_MS).toISOString()
    };
  }

  /*
   * Aktuelles Wetter.
   */
  function get() {
    return getWeatherState(slot());
  }

  /*
   * Zeit bis zum nächsten Wetterwechsel.
   */
  function msNext() {
    return SLOT_MS - (Date.now() % SLOT_MS);
  }

  /*
   * Countdown formatieren.
   */
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

  /*
   * Prüfen, ob ein neuer 6-Stunden-Slot begonnen hat.
   *
   * wetter.html kann dadurch sofort reagieren.
   */
  let lastSlot = slot();

  function watch() {
    const currentSlot = slot();

    if (currentSlot !== lastSlot) {
      lastSlot = currentSlot;

      const state = getWeatherState(currentSlot);

      window.dispatchEvent(
        new CustomEvent("chroniken-weather-changed", {
          detail: state
        })
      );
    }
  }

  setInterval(watch, 1000);

  /*
   * Öffentliche API für wetter.html.
   */
  window.ChronikenWeather = {
    get,
    getWeatherState,
    msNext,
    format,
    getWeatherList: function () {
      return WEATHER.map(function (w) {
        return {
          name: w[0],
          icon: w[1],
          description: w[2]
        };
      });
    },
    WEATHER,
    SLOT_MS
  };
})();

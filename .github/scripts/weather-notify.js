/**
 * Chroniken Wetter → Discord
 *
 * WICHTIG:
 * Diese Wetterliste und die Berechnung müssen
 * identisch mit wetter.js sein.
 *
 * Wetterwechsel: alle 6 Stunden
 *
 * GitHub Secret:
 * DISCORD_WEATHER_WEBHOOK
 *
 * Optional:
 * WEATHER_TITLE
 * WEATHER_TEXT
 */

const SLOT_MS = 6 * 60 * 60 * 1000;


/*
 * ==========================================================
 * DIESELBE WETTERLISTE WIE IN wetter.js
 * ==========================================================
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
 * ==========================================================
 * 6-STUNDEN-SLOT
 * ==========================================================
 */

function slot() {
  return Math.floor(Date.now() / SLOT_MS);
}


/*
 * ==========================================================
 * EXAKT DIESELBE ZUFALLSBERECHNUNG WIE wetter.js
 * ==========================================================
 */

function randomIndex(seed, length) {
  let x = (seed * 1103515245 + 12345) >>> 0;

  x = ((x ^ (x >>> 16)) * 2246822519) >>> 0;

  return x % length;
}


/*
 * ==========================================================
 * WETTER AUSWÄHLEN
 * ==========================================================
 */

function pickWeather(s) {

  if (!WEATHER.length) {
    throw new Error("Keine Wetterlagen vorhanden.");
  }

  return WEATHER[
    randomIndex(s, WEATHER.length)
  ];
}


/*
 * ==========================================================
 * WETTERZUSTAND
 * ==========================================================
 */

function getWeatherState() {

  const s = slot();

  const w =
    pickWeather(s);

  return {
    slot: s,
    name: w[0],
    icon: w[1],
    description: w[2],
    changedAt:
      new Date(
        s * SLOT_MS
      ).toISOString()
  };
}


/*
 * ==========================================================
 * ZEIT BIS ZUM NÄCHSTEN WECHSEL
 * ==========================================================
 */

function msNext() {

  return (
    SLOT_MS -
    (Date.now() % SLOT_MS)
  );
}


function format(ms) {

  const total =
    Math.max(
      0,
      Math.floor(ms / 1000)
    );

  const h =
    Math.floor(
      total / 3600
    );

  const m =
    Math.floor(
      (total % 3600) / 60
    );

  const s =
    total % 60;

  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0")
  );
}


/*
 * ==========================================================
 * VARIABLEN FÜR DISCORD
 * ==========================================================
 */

function replaceVars(text, weather) {

  const now =
    new Date();

  const vars = {

    wetter:
      weather.name,

    wetter_icon:
      weather.icon,

    wetter_beschreibung:
      weather.description,

    naechster_wetterwechsel:
      format(msNext()),

    datum:
      now.toLocaleDateString(
        "de-DE"
      ),

    zeit:
      now.toLocaleTimeString(
        "de-DE"
      )

  };

  return String(
    text || ""
  ).replace(
    /%([a-zA-Z0-9_]+)%/g,
    function (_, key) {

      return vars[key] !== undefined
        ? vars[key]
        : "%" + key + "%";

    }
  );
}


/*
 * ==========================================================
 * DISCORD
 * ==========================================================
 */

async function main() {

  const webhook =
    process.env.DISCORD_WEATHER_WEBHOOK;

  if (!webhook) {

    console.error(
      "❌ DISCORD_WEATHER_WEBHOOK fehlt."
    );

    process.exit(1);
  }


  /*
   * Exakt derselbe Slot und
   * exakt dieselbe Berechnung wie wetter.js.
   */

  const weather =
    getWeatherState();


  const title =
    process.env.WEATHER_TITLE ||
    "🌦️ Wetter in Chroniken";


  const text =
    process.env.WEATHER_TEXT ||
    "%wetter_icon% %wetter% ist jetzt bei Chroniken.\n\n%wetter_beschreibung%\n\nNächster Wechsel: %naechster_wetterwechsel%";


  const payload = {

    username:
      "Chroniken Wetter",

    embeds: [

      {

        title:
          replaceVars(
            title,
            weather
          ),

        description:
          replaceVars(
            text,
            weather
          ),

        color:
          0x7c3aed,

        footer: {
          text:
            "Chroniken · Wetter"
        },

        timestamp:
          new Date().toISOString()

      }

    ]

  };


  const response =
    await fetch(
      webhook,
      {

        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            payload
          )

      }
    );


  if (!response.ok) {

    const body =
      await response.text();

    console.error(
      "Discord Fehler:",
      response.status,
      body
    );

    process.exit(1);
  }


  console.log(
    `✅ Wetter gemeldet: ${weather.icon} ${weather.name} (Slot ${weather.slot})`
  );

}


main().catch(
  function (error) {

    console.error(
      "❌ Wetter-Fehler:",
      error
    );

    process.exit(1);

  }
);

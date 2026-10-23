function slot() {
  return Math.floor(Date.now() / SLOT_MS);
}

function randomIndex(seed, length) {
  let x = (seed * 1103515245 + 12345) >>> 0;
  x = ((x ^ (x >>> 16)) * 2246822519) >>> 0;

  return x % length;
}

function pickWeather(s, WEATHER) {
  if (!WEATHER.length) {
    throw new Error("Keine Wetterlagen vorhanden.");
  }

  return WEATHER[randomIndex(s, WEATHER.length)];
}

function getWeatherState(WEATHER) {
  const s = slot();
  const w = pickWeather(s, WEATHER);

  return {
    slot: s,
    name: w[0],
    icon: w[1],
    description: w[2],
    changedAt: new Date(s * SLOT_MS).toISOString()
  };
}

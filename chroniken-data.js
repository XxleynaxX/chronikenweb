/* ============================================================
   Chroniken – zentrale Stammdaten (localStorage)
   Keys: voelker · berufe · goetter · wetter
   Admin-Status: sessionStorage "portal_admin_auth" === "1"
   ============================================================ */
(function () {
  const DEFAULT_VOELKER = [
    { name:"Mensch", emoji:"🧑", size:"M: 155-195 cm | F: 150-185 cm", age:"60-100 Jahre", subraces:["Königreichsmensch","Freier Mensch","Küstenmensch","Steppenmensch","Nordmensch","Wüstenmensch","Magiermensch","Blutgebundener Mensch","Naturmensch","Kriegerkult-Mensch"], description:"Wandelbarstes Volk mit hoher Anpassungsfähigkeit.", strengths:"Hohe Anpassungsfähigkeit, schnelles Lernen, großer emotionaler Spielraum.", weaknesses:"Keine angeborene Spezialisierung.", minM:1.55,maxM:1.95,minF:1.50,maxF:1.85 },
    { name:"Elf", emoji:"🧝", size:"M: 150-210 cm | F: 150-195 cm", age:"300-900 Jahre", subraces:["Waldelf","Hochelf","Dunkelelf","Eiself","Seeelf","Mondelf","Sonnenelf"], description:"Alte Völker, eng mit Magie und Natur verbunden.", strengths:"Hohe Magieaffinität, Beweglichkeit, Resistenz gegen Krankheiten, geistige Disziplin.", weaknesses:"Oft Arroganz, langsame Anpassung an urbane Chaos-Zustände.", minM:1.50,maxM:2.10,minF:1.50,maxF:1.95 },
    { name:"Zwerg", emoji:"⛏️", size:"M: 120-155 cm | F: 115-150 cm", age:"250-500 Jahre", subraces:["Bergzwerg","Feuerzwerg","Frostzwerg","Tiefenzwerg","Küstenzwerg","Blutgeschworener Zwerg"], description:"Kinder von Stein, Erz und Feuer.", strengths:"Hohe physische Widerstandskraft, Affinität zu Metall/Stein, Handwerkskunst.", weaknesses:"Starrheit bei Traditionen, oft misstrauisch gegenüber Neuem.", minM:1.20,maxM:1.55,minF:1.15,maxF:1.50 },
    { name:"Orc", emoji:"👹", size:"M: 180-230 cm | F: 170-215 cm", age:"60-90 Jahre", subraces:["Kriegsorc","Steppenorc","Bergorc","Grünorc","Blutorc"], description:"Kriegerische Urvölker.", strengths:"Hohe körperliche Stärke, natürliche Schmerztoleranz, starke Willenskraft.", weaknesses:"Schnelle Alterung, oft Vorurteile durch kriegerische Kultur.", minM:1.80,maxM:2.30,minF:1.70,maxF:2.15 },
    { name:"Kitsune", emoji:"🦊", size:"Variabel (menschlich / tierisch)", age:"150-400 Jahre", subraces:["Weiße Kitsune","Schwarze Kitsune","Feuerfuchs","Geisterfuchs"], description:"Mystisches Fuchsvolk mit Verbindung zu Illusionen und Gestaltwandel.", strengths:"Illusionen, Gestaltwandel, Fuchsfeuer, Naturverbundenheit.", weaknesses:"Eisen/magische Siegel behindern Verwandlung, Stolz.", minM:1.40,maxM:2.00,minF:1.40,maxF:1.90 },
    { name:"Wolf", emoji:"🐺", size:"M: 200-250 cm | F: 160-220 cm", age:"bis 1200 Jahre", subraces:["Silberwolf","Schwarzwolf","Weißer Geistwolf","Dämonischer Wolf"], description:"Uralte Geschöpfe, verbunden mit dem Mond.", strengths:"Erhöhte Sinne, Schattenschritt, Mondbindung.", weaknesses:"Empfindlich gegenüber Silber, Blutmond kann Instinkte stören.", minM:2.00,maxM:2.50,minF:1.60,maxF:2.20 },
    { name:"Troll", emoji:"🧌", size:"200 - 250 cm", age:"80-250 Jahre", subraces:["Waldtroll","Bergtroll"], description:"Robuste Natur und starke Regeneration.", strengths:"Regeneration, Erdmagie, physische Stärke.", weaknesses:"Grobe Art führt oft zu Missverständnissen.", minM:2.00,maxM:2.50,minF:2.00,maxF:2.50 },
    { name:"Tiefling", emoji:"😈", size:"150 - 220 cm", age:"100-200 Jahre", subraces:["Feuertiefling","Schattentiefling"], description:"Stark auf Elementar- und Illusionsmagie fokussiert.", strengths:"Feuermagie, Illusionsmagie, feurige Wandelform.", weaknesses:"Misstrauen anderer Rassen.", minM:1.50,maxM:2.20,minF:1.50,maxF:2.10 },
    { name:"Gnom", emoji:"🛠️", size:"M: 80-160 cm | F: 90-140 cm", age:"200-400 Jahre", subraces:["Felsgnom","Waldgnom","Tüftlergnom"], description:"Enge Verbindung zu Natur, Handwerk und Magie.", strengths:"Illusionsmagie, Mechanomagie, Erfindungsreichtum.", weaknesses:"Exzentrische Art, körperliche Unterlegenheit.", minM:0.80,maxM:1.60,minF:0.90,maxF:1.40 },
    { name:"Halbling", emoji:"🌾", size:"M: 80-160 cm | F: 90-140 cm", age:"80-150 Jahre", subraces:["Leichtfuss","Starkherz"], description:"Friedliche Lebensweise, Gastfreundschaft.", strengths:"Heilmagie, Naturmagie, Gemeinschaftsgefühl, Glück.", weaknesses:"Werden oft unterschätzt.", minM:0.80,maxM:1.60,minF:0.90,maxF:1.40 },
    { name:"Minotaurus", emoji:"🐂", size:"M: 210-280 cm | F: 180-260 cm", age:"80-150 Jahre", subraces:["Bergminotaurus","Labyrinthminotaurus"], description:"Robuste Konstitution und Erdverbundenheit.", strengths:"Erdmagie, Kraftmagie, Schutzmagie, Wucht.", weaknesses:"Imposante Präsenz, schnelle Reizbarkeit.", minM:2.10,maxM:2.80,minF:1.80,maxF:2.60 },
    { name:"Drachengeborener", emoji:"🐉", size:"M: 150-270 cm | F: 150-220 cm", age:"150-300 Jahre", subraces:["Rotdrachen-Blut","Eisdrachen-Blut","Blitzdrachen-Blut"], description:"Drakonische Abstammung.", strengths:"Feuermagie, Drachenatem, Sturm-/Blitzmagie.", weaknesses:"Enorme Kraft kann zu Spannungen führen, Arroganz.", minM:1.50,maxM:2.70,minF:1.50,maxF:2.20 },
    { name:"Dämon", emoji:"🔥", size:"M: 150-270 cm | F: 150-240 cm", age:"200-1500 Jahre", subraces:["Flammendämon","Seelendämon","Schattenfeind"], description:"Übernatürliche Kräfte und Regeneration.", strengths:"Flammenmagie, Seelenmagie, Blutmagie.", weaknesses:"Misstrauen anderer Rassen, heilige Magie.", minM:1.50,maxM:2.70,minF:1.50,maxF:2.40 },
    { name:"Fee", emoji:"🧚", size:"M: 80-150 cm | F: 80-140 cm", age:"300-1000 Jahre", subraces:["Lichtfee","Waldfee","Schattenfee"], description:"Magische Verbindung zur Natur.", strengths:"Naturmagie, Illusionsmagie, Größenveränderung, Flug.", weaknesses:"Körperlich sehr zerbrechlich, unzuverlässig.", minM:0.80,maxM:1.50,minF:0.80,maxF:1.40 },
    { name:"Halbgigant", emoji:"🏔️", size:"M: 200-270 cm | F: 200-250 cm", age:"150-300 Jahre", subraces:["Stein-Halbgigant","Frost-Halbgigant"], description:"Erdenmagie und physische Stärke.", strengths:"Erdenmagie, Kraftmagie, Schutzmagie, gigantische Kraft.", weaknesses:"Territoriale Natur, Langsamkeit.", minM:2.00,maxM:2.70,minF:2.00,maxF:2.50 },
    { name:"Goblin", emoji:"👺", size:"M: 50-160 cm | F: 50-130 cm", age:"40-70 Jahre", subraces:["Höhlengoblin","Waldgoblin"], description:"Schläue und Alchemie.", strengths:"Illusionsmagie, Alchemie, Erdmagie, Schnelligkeit.", weaknesses:"Verschlagenheit, geringer Respekt.", minM:0.50,maxM:1.60,minF:0.50,maxF:1.30 },
    { name:"Wasserwesen", emoji:"🌊", size:"M: 80-220 cm | F: 110-200 cm", age:"100-400 Jahre", subraces:["Meereswesen","Flusswesen"], description:"Heimat im nassen Element.", strengths:"Wassermagie, Eismagie, Heilmagie, Unterwasseratmung.", weaknesses:"Trockenheit, spezielle Anforderungen.", minM:0.80,maxM:2.20,minF:1.10,maxF:2.00 },
    { name:"Vogelwesen", emoji:"🦅", size:"M: 110-230 cm | F: 110-190 cm", age:"80-200 Jahre", subraces:["Falkenwesen","Eulenwesen","Greifenblut"], description:"Verbindung zum Himmel und den Winden.", strengths:"Luftmagie, Lichtmagie, Flugverwandlung, Weitblick.", weaknesses:"Hohle Knochen (Verletzlichkeit).", minM:1.10,maxM:2.30,minF:1.10,maxF:1.90 },
    { name:"Tierwesen", emoji:"🐾", size:"M: 110-240 cm | F: 80-200 cm", age:"60-150 Jahre", subraces:["Katzenwesen","Bärenwesen","Hirschwesen"], description:"Geschärfte Instinkte.", strengths:"Naturmagie, Tiermagie, geschärfte Sinne.", weaknesses:"Instinktives Verhalten, tierische Triebe.", minM:1.10,maxM:2.40,minF:0.80,maxF:2.00 },
    { name:"Halborc", emoji:"🛡️", size:"M: 160-220 cm | F: 160-210 cm", age:"60-90 Jahre", subraces:["Stadt-Halborc","Stamm-Halborc"], description:"Mischung aus Kraft und Flexibilität.", strengths:"Blutmagie, Pragmatismus, Anpassungsfähigkeit, Zähigkeit.", weaknesses:"Vorurteile, innere Zerrissenheit.", minM:1.60,maxM:2.20,minF:1.60,maxF:2.10 },
    { name:"Halbelf", emoji:"🏹", size:"M: 150-210 cm | F: 150-195 cm", age:"200-300 Jahre", subraces:["Wald-Halbelf","Stadt-Halbelf"], description:"Brückenbauer zwischen den Welten.", strengths:"Vielseitige Magie, diplomatisches Geschick.", weaknesses:"Fühlen sich oft als Außenseiter.", minM:1.50,maxM:2.10,minF:1.50,maxF:1.95 },
    { name:"Wargwandler", emoji:"🐺", size:"200 - 240 cm (humanoid)", age:"500-5000 Jahre", subraces:["Nord-Raubtier","Süd-Raubtier","Grenzgänger","Schattenwarg","Blutwarg"], description:"Gestaltwandler ohne Magieaffinität.", strengths:"Gestaltwandlung, animalische Sinne, Selbstheilung.", weaknesses:"Keine Magieaffinität – Magie stürzt sie in Raserei. Vollmond-Unruhe.", minM:2.00,maxM:2.40,minF:1.80,maxF:2.20 }
  ];

  const DEFAULT_BERUFE = [
    { name:"Tierpfleger", category:"Hauptberuf", description:"Versteht und pflegt Tiere aller Art, zähmt und erzieht sie." },
    { name:"Feinschmied", category:"Hauptberuf", description:"Meister der filigranen Metallarbeiten, Schmuck und Beschläge." },
    { name:"Bogner", category:"Hauptberuf", description:"Baut und verfeinert Bögen, Armbrüste und Munition." },
    { name:"Alchemist", category:"Hauptberuf", description:"Arbeitet mit Tränken, Essenzen, Giften und Reagenzien." },
    { name:"Waffenschmied", category:"Hauptberuf", description:"Schmiedet Schwerter, Äxte und verlässliche Nahkampfwaffen." },
    { name:"Rüstungsschmied", category:"Hauptberuf", description:"Baut Plattenpanzer, Kettenhemden und Schilde." },
    { name:"Mönch und Priester", category:"Nebenberuf", description:"Führt spirituelle Handlungen, Segnungen und Tempeldienste aus." },
    { name:"Heiler", category:"Nebenberuf", description:"Versorgt Wunden, lindert Krankheiten und hilft Verletzten." },
    { name:"Schneider", category:"Nebenberuf", description:"Arbeitet mit Stoffen, Mustern und feinen Textilien." },
    { name:"Koch und Wirt", category:"Nebenberuf", description:"Versorgt Reisende und Abenteurer mit nahrhaften Mahlzeiten." },
    { name:"Sucher nach Arbeitern", category:"Nebenberuf", description:"Vermittelt Arbeitskräfte und Kontakte." },
    { name:"Landwirt", category:"Nebenberuf", description:"Baut Getreide an und pflegt Nutztiere." }
  ];

  const DEFAULT_GOETTER = [
    { name:"Aurelion", domain:"Licht • Ordnung • Sonne", short:"Der strahlende Herrscher des Tages. Seine Anhänger streben nach Gerechtigkeit und Klarheit.", full:"Der strahlende Herrscher des Tages. Seine Anhänger streben nach Gerechtigkeit und Klarheit. Tempel des Aurelion sind oft auf Anhöhen errichtet und von goldenen Symbolen geziert." },
    { name:"Nyxara", domain:"Nacht • Geheimnisse • Träume", short:"Die verschleierte Göttin der Nacht. Sie bewahrt verborgenes Wissen und schenkt Visionen.", full:"Die verschleierte Göttin der Nacht. Sie bewahrt verborgenes Wissen und schenkt Visionen denen, die in der Stille lauschen." },
    { name:"Thalor", domain:"Meer • Sturm • Wandel", short:"Der unberechenbare Herr der Gezeiten. Seeleute und Wanderer opfern ihm vor großen Reisen.", full:"Der unberechenbare Herr der Gezeiten. Seeleute und Wanderer opfern ihm vor großen Reisen." },
    { name:"Veyra", domain:"Leben • Wachstum • Heilung", short:"Die nährende Mutter. Ihre Priesterinnen und Priester heilen Wunden und segnen die Ernten.", full:"Die nährende Mutter. Ihre Priesterinnen und Priester heilen Wunden und segnen die Ernten." },
    { name:"Mordak", domain:"Krieg • Ehre • Stahl", short:"Der unerbittliche Kriegsgott. Nur wer mit Mut und Disziplin kämpft, findet seine Gunst.", full:"Der unerbittliche Kriegsgott. Nur wer mit Mut und Disziplin kämpft, findet seine Gunst." },
    { name:"Syleth", domain:"Schatten • Verrat • Verfall", short:"Der gefürchtete Gott der Finsternis. Sein Kult operiert im Verborgenen.", full:"Der gefürchtete Gott der Finsternis. Sein Kult operiert im Verborgenen." }
  ];

  const DEFAULT_WETTER = [
    { name:"Klarer Himmel", icon:"☀️", description:"Ein ruhiger, heller Tag liegt über dem Land." },
    { name:"Leichter Wind", icon:"🍃", description:"Ein sanfter Wind zieht durch Wälder und Gassen." },
    { name:"Bewölkt", icon:"☁️", description:"Wolken ziehen über den Himmel, doch es bleibt trocken." },
    { name:"Nebel", icon:"🌫️", description:"Dichter Nebel liegt über dem Land und verschluckt die Ferne." },
    { name:"Leichter Regen", icon:"🌦️", description:"Feiner Regen fällt und lässt die Straßen glänzen." },
    { name:"Starker Regen", icon:"🌧️", description:"Kräftiger Regen prasselt auf Dächer und Wege." },
    { name:"Gewitter", icon:"⛈️", description:"Donner grollt am Horizont und Blitze erhellen die Wolken." },
    { name:"Starker Wind", icon:"🌬️", description:"Böen ziehen durch das Land und lassen Äste rauschen." },
    { name:"Schneefall", icon:"🌨️", description:"Leiser Schnee fällt vom Himmel und bedeckt die Landschaft." },
    { name:"Starker Schneefall", icon:"❄️", description:"Dichter Schnee fällt und macht Wege langsam schwer passierbar." },
    { name:"Frost", icon:"🥶", description:"Klare Kälte liegt in der Luft und Reif bedeckt die Landschaft." },
    { name:"Dunstiger Morgen", icon:"🌤️", description:"Heller Dunst liegt über dem Land und löst sich langsam auf." }
  ];

  const DEFAULTS = { voelker: DEFAULT_VOELKER, berufe: DEFAULT_BERUFE, goetter: DEFAULT_GOETTER, wetter: DEFAULT_WETTER };

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // Keys die über Supabase geteilt werden
  const SHARED_KEYS = ["voelker", "berufe", "goetter"];

  // Lokaler Cache (wird von Supabase befüllt)
  const memCache = {};

  function loadFromLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return null;
  }

  function saveToLocal(key, arr) {
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
  }

  /**
   * Synchrones load – gibt Cache oder localStorage oder Defaults zurück.
   * Im Hintergrund wird von Supabase aktualisiert.
   */
  function load(key) {
    if (memCache[key]) return clone(memCache[key]);

    const local = loadFromLocal(key);
    if (local && local.length > 0) {
      memCache[key] = local;
      return clone(local);
    }

    const seed = clone(DEFAULTS[key] || []);
    memCache[key] = seed;
    saveToLocal(key, seed);
    return clone(seed);
  }

  /**
   * Speichert lokal + (falls shared) asynchron zu Supabase.
   */
  function save(key, arr) {
    const data = Array.isArray(arr) ? arr : [];
    memCache[key] = data;
    saveToLocal(key, data);

    if (SHARED_KEYS.includes(key) && window.ChronikenStorage) {
      // Im Hintergrund speichern, UI blockiert nicht
      ChronikenStorage.save(key, data).catch(err => {
        console.warn("Supabase-Save für", key, "fehlgeschlagen:", err);
      });
    }
  }

  function resetDefaults(key) {
    const seed = clone(DEFAULTS[key] || []);
    save(key, seed);
    return seed;
  }

  function isAdmin() {
    try { return sessionStorage.getItem("portal_admin_auth") === "1"; } catch (e) { return false; }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /**
   * Einmalig: Daten von Supabase holen und mit lokalen Defaults mergen.
   * Wird beim Laden der Seite aufgerufen.
   */
  async function syncFromRemote() {
    if (!window.ChronikenStorage) return false;
    let changed = false;

    try {
      // Jeden SHARED_KEY einzeln laden (richtige Bin-Zuordnung)
      for (const key of SHARED_KEYS) {
        try {
          const remoteList = await ChronikenStorage.load(key);
          if (Array.isArray(remoteList) && remoteList.length > 0) {
            const before = JSON.stringify(memCache[key] || loadFromLocal(key) || []);
            memCache[key] = remoteList;
            saveToLocal(key, remoteList);
            if (before !== JSON.stringify(remoteList)) changed = true;
          } else {
            // Remote leer → lokale/Defaults hochladen (nur wenn etwas da ist)
            const local = loadFromLocal(key) || clone(DEFAULTS[key] || []);
            if (local.length > 0) {
              memCache[key] = local;
              await ChronikenStorage.save(key, local);
              changed = true;
            }
          }
        } catch (err) {
          console.warn("Supabase-Sync für", key, "fehlgeschlagen:", err);
        }
      }
    } catch (e) {
      console.warn("Supabase-Sync fehlgeschlagen, nutze lokale Daten:", e);
    }

    try {
      document.dispatchEvent(new CustomEvent("chroniken-data-synced", { detail: { changed: changed } }));
    } catch (e) {}
    return changed;
  }

  // Beim Laden der Seite sofort synchronisieren (nicht-blockierend)
  if (typeof window !== "undefined") {
    // Kleiner Delay, damit supabase-storage.js schon geladen ist
    setTimeout(() => { syncFromRemote(); }, 80);
  }

  window.ChronikenData = {
    load, save, resetDefaults, isAdmin, esc,
    DEFAULTS,
    syncFromRemote   // falls man manuell neu laden will
  };
})();

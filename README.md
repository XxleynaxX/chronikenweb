# 🛡️ Chroniken – Rollenspiel-Website

Was als **digitaler Charakterbogen** begann, ist zu einer **kompletten Webseite fürs Rollenspiel** gewachsen: Portal, Wiki, Kalender, Events, Götter, Kreaturen und mehr – alles im Browser, ohne Server.

Der Charakterbogen bleibt das Herzstück; darum herum entstand das **Chroniken**-Portal.

---

## ✨ Was die Website bietet

### Aus dem Charakterbogen
- **👤 Allgemeine Daten & Völker** – Völker, Unterrassen, Größenprüfung inkl. Warnung bei Abweichungen
- **✨ Magie & Regeln** – optionale Magie, Bestätigung der Server-Magieregeln
- **🛠️ Berufe & Handwerk** – Haupt- und Nebenberuf
- **👁️ Aussehen & Merkmale** – Haare, Augen, besondere Merkmale
- **⚖️ Gesinnung** – von „Sehr gut“ bis „Böse“
- **🔒 OOC-Sicherheit** – Grenzen, Phobien, sensible Themen
- **🎂 Ingame-Geburtstag** – Berechnung und Anzeige im Kalender / bei Events
- **💾 JSON Import & Export** – plus automatische Sicherung im Browser (`localStorage`)
- **🖼️ PNG-Export** – fertiger Charakterbogen als Bild (`html2canvas`)

### Als Website ergänzt
- **Startportal** mit Live-News und Bereichen
- **Wiki** und **Bibliothek** (eigene Passwörter zum Schreiben)
- **Events** und **News**
- **Ingame-Kalender** (15 reale Tage = 1 Monat, ab Frostmond 1400)
- **Götter & Kulte**, **Kreaturen**, **Berufe**, **Regeln**
- **Admin-Login** (unten links) → extra Kachel **Charakterverwaltung** mit laufenden IDs, Verwarnungen, Regelverstößen und Notizen
- Einheitliches dunkles Design, Navigation, © Kiyasha

---

## 🚀 Schnellstart

Reine **Client-Web-App** – kein Node.js, kein Backend nötig.

1. Ordner entpacken.
2. `index.html` im Browser öffnen (oder direkt `charakterbogen.html`).
3. Charakter ausfüllen, speichern, JSON oder PNG exportieren – oder die anderen Bereiche der Website nutzen.

**Admin-Zugang** (unten links auf der Startseite): Benutzer `admin` · Passwort `chroniken2026`  
(Zugangsdaten in `index.html` und `admin.html` änderbar – Suche nach `ADMIN_USER` / `ADMIN_PASS`.)

```text
portal-website/
├── index.html            # Portal-Start
├── charakterbogen.html   # Digitaler Charakterbogen (Ursprung)
├── kalender.html         # Ingame-Kalender
├── events.html           # Events & Geburtstage
├── wiki.html / bibliothek.html / …
├── style.css
└── README.md
```

---

## 📅 Ingame-Zeitrechnung

| Real | Ingame |
|------|--------|
| 1 realer Tag | 2 Ingame-Tage |
| 15 reale Tage | 1 Monat (30 Ingame-Tage) |
| 12 Monate | 1 Jahr |
| **Start** | **17.10.2026** = **1. Frostmond 1400** |

---


## 💡 Kurz gesagt

- **Früher:** ein einzelner Charakterbogen als HTML-Datei  
- **Jetzt:** eine kleine Rollenspiel-Website mit Charakterbogen, Kalender, Lore und Tools  
- Daten bleiben im **Browser** (localStorage); PNG/JSON zum Mitnehmen  

---

## 📄 Copyright

© Kiyasha · Chroniken

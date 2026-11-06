# 🛡️ Die Chroniken

**Die Chroniken – Das Zeitalter der Asche** ist eine webbasierte Plattform für ein Conan-Exiles-Rollenspiel.  
Das Projekt verbindet Charakterverwaltung, Lore, Regeln, Kalender, Events, Wetter, Heilerakten und administrative Werkzeuge in einer gemeinsamen Oberfläche.

Was ursprünglich als digitaler Charakterbogen begonnen hat, ist inzwischen zu einer vollständigen RP-Verwaltungs- und Wissensplattform gewachsen.

---

## 🌑 Die Welt

Vor mehr als 300 Jahren wurde die alte Welt durch den Krieg der Götter zerstört.

Aus den Überresten entstand eine neue Zeitrechnung, neue Reiche und neue Geschichten.  
**Die Chroniken** dienen dabei als digitales Gedächtnis dieser Welt.

Die Website stellt Wissen, Regeln und Werkzeuge bereit, damit Spieler und Team die gemeinsame RP-Welt übersichtlich verwalten können.

---

## ✨ Öffentlicher Bereich

Die normale Website enthält unter anderem:

- 🏠 **Startseite** mit Übersicht und aktuellen Informationen
- 📰 **News** für Neuigkeiten rund um das RP
- 📜 **Events** und besondere Ereignisse
- 📅 **Ingame-Kalender**
- 📖 **Wiki** für Wissen und Hintergrundinformationen
- 📚 **Bibliothek** für Schriften und Archive
- 👥 **Völker & Rassen**
- 🛠️ **Berufe**
- 🐺 **Kreaturen**
- 📜 **Regelwerk**
- ⚜️ **Götter & Kulte**
- 🗺️ **Karte**
- 👤 **Charakterbogen**
- 🩺 **Heilerakte**
- 🌦️ **Fantasy-Wetter**

Der administrative Bereich ist bewusst **nicht Bestandteil der öffentlichen Navigation**.

---

## 👤 Charakterbogen

Der digitale Charakterbogen bildet die Grundlage des Projekts.

Er unterstützt unter anderem:

- Charakterdaten
- Völker und Rassen
- Berufe und Handwerk
- Aussehen und Merkmale
- Gesinnung
- Magie
- OOC-Hinweise und persönliche Grenzen
- Ingame-Geburtstage
- JSON-Import und -Export
- Charakterdarstellung und Exportfunktionen

---

## 📜 Regelwerk

Das Regelwerk ist in einzelne Kategorien gegliedert und kann administrativ gepflegt werden.

Jede einzelne Regel kann eine eindeutige Kennung erhalten, zum Beispiel:

`R-1-A`  
`R-1-B`  
`R-1-C`

Dadurch können Regelverstöße eindeutig referenziert werden.

Bei der Charakterverwaltung werden diese IDs intern verwendet. In Tabellen und Discord-Meldungen wird dagegen der **eigentliche Regeltext** angezeigt, damit Teammitglieder nicht erst nach der Bedeutung einer ID suchen müssen.

---

## 🛡️ Administration

Der Admin-Bereich ist vom öffentlichen Bereich getrennt.

Dort befinden sich unter anderem:

- 📊 Dashboard
- 📝 Aufgaben
- 📁 Projekte
- 🛡️ Charakterverwaltung
- 🚫 Spieler-Blacklist
- 📜 Aktivitäten
- Charakterbögen und laufende Charakter-IDs
- Verwarnungen und Regelverstöße
- administrative Notizen
- weitere Verwaltungsbereiche

Administrative Funktionen werden nur nach entsprechender Anmeldung bzw. Berechtigung zugänglich gemacht.

Die öffentliche Navigation enthält **keinen direkten Admin-Link**.

---

## 👥 Charakterverwaltung

Die Charakterverwaltung ermöglicht dem Team unter anderem:

- laufende Charakter-IDs
- Charaktername und Spieler
- Steam-ID
- Volk/Rasse
- Verwarnungen
- Status
- Regelverstöße
- interne Notizen
- Bearbeiten und Löschen von Charaktereinträgen

Bei einem Regelverstoß können mehrere Regel-IDs angegeben werden.

Beispiel:

`R-1-A, R-1-C`

Das System löst diese IDs automatisch in die hinterlegten Regeltexte auf.

---

## 💬 Discord-Anbindung

Die Website kann mit Discord verbunden werden.

Administrative Ereignisse können an den zuständigen Discord-Bereich weitergegeben werden, beispielsweise:

- 🆕 neuer Charakter
- ✏️ Änderung eines Charakters
- ⚠️ Regelverstoß oder Verwarnung
- 🗑️ Löschung eines Charakters

Bei Regelverstößen wird nicht nur die interne ID übertragen. Discord erhält den hinterlegten **Regeltext**.

---

## 💾 Datenspeicherung

Das Projekt verwendet eine zentrale Datenspeicherung für die gemeinsam genutzten Inhalte.

Dazu gehören unter anderem:

- Charaktere
- Regeln
- Völker
- Berufe
- Götter
- Kreaturen
- Events
- Kalenderdaten
- Wetter
- Heilerakten
- Bibliothek
- Wiki-Inhalte
- News

Die Website und administrative Werkzeuge greifen dabei auf die gemeinsame Chroniken-Datenstruktur zurück.

---

## 📅 Ingame-Zeitrechnung

Die Welt besitzt eine eigene Zeitrechnung.

| Realität | Die Chroniken |
|---|---|
| 1 realer Tag | 2 Ingame-Tage |
| 15 reale Tage | 1 Ingame-Monat |
| 30 Ingame-Tage | 1 Ingame-Monat |
| 12 Ingame-Monate | 1 Ingame-Jahr |
| 17.10.2026 | 1. Frostmond 1400 |

Der Kalender bildet diese Zeitrechnung für das RP ab.

---

## 🌦️ Fantasy-Wetter

Das Wetter ist Bestandteil der Welt und nicht an reale Wetterdaten gebunden.

Es können eigene Wetterzustände verwendet werden, beispielsweise:

- Klarer Himmel
- Leichter Wind
- Regen
- Nebel
- Frost
- Gewitter
- besondere Fantasy-Wetterlagen

Das Wetter kann administrativ gesteuert und für das RP verwendet werden.

---

## 🏗️ Technischer Aufbau

Das Projekt besteht überwiegend aus:

- HTML
- CSS
- JavaScript
- Node.js für serverseitige bzw. Proxy-Funktionen
- MySQL bzw. zentrale Datenspeicherung
- Discord OAuth
- Discord-Anbindung
- GitHub Pages
- Render

Wichtige Bestandteile sind unter anderem:

`chroniken-data.js`  
`chroniken-storage.js`  
`chroniken-sync.js`  
`chroniken-auth.js`

Die öffentlichen Seiten und der geschützte Admin-Bereich sind voneinander getrennt.

---

## 📁 Projektstruktur

Eine vereinfachte Übersicht:

```text
chronikenweb/
├── index.html
├── charakterbogen.html
├── kalender.html
├── events.html
├── news.html
├── wiki.html
├── bibliothek.html
├── voelker.html
├── berufe.html
├── kreaturen.html
├── regeln.html
├── goetter.html
├── karte.html
├── heilerakte.html
├── wetter.html
│
├── admin/
│   ├── index.html
│   ├── charaktere.html
│   ├── charakterverwaltung.js
│   ├── aufgaben.html
│   ├── projekte.html
│   ├── blacklist.html
│   └── aktivitaeten.html
│
├── chroniken-data.js
├── chroniken-storage.js
├── chroniken-sync.js
├── chroniken-auth.js
├── style.css
└── README.md
```

---

## 🚀 Entwicklung

Das Projekt befindet sich in aktiver Entwicklung.

Neue Funktionen werden direkt in die bestehende RP-Struktur integriert. Dabei liegt der Fokus auf:

- einer übersichtlichen Bedienung
- klarer Trennung zwischen Spieler- und Admin-Bereich
- zentraler Datenspeicherung
- nachvollziehbarer Verwaltung
- Discord-Integration
- einer lebendigen und erweiterbaren RP-Welt

---

## 🔗 Projekt

**GitHub:**  
https://github.com/XxleynaxX/chronikenweb

**Website:**  
https://xxleynaxx.github.io/chronikenweb/

**Projektname:**  
**Die Chroniken – Das Zeitalter der Asche**

**Entwicklung & Pflege:** Kiyasha

---

## 📜 Copyright

© Kiyasha – Die Chroniken

Die Inhalte, Texte, Weltenelemente und individuellen Systeme dieses Projekts sind Bestandteil des Projekts **Die Chroniken**.

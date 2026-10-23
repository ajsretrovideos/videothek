# Videothek - Setup & Pflege

Du pflegst nur die Liste. Alles andere passiert automatisch.

---

## Dein einziger Job

In `data/wishes.txt` stehen Zeilen in dieser Form:

```
Titel | Jahr | Regal | Link
```

Beispiel:

```
Du+Ich: Allein gegen alle | 1996 | Drama | https://www.amazon.de/gp/video/detail/B0HHQYP1TZ
```

Mehr nicht. Poster, Laufzeit, Regie, Bewertung und Kurzbeschreibung holt das
Build-Script automatisch von TMDB.

- **Jahr ist Pflicht.** "Dune" gibt es dreimal, "The Thing" zweimal - ohne Jahr
  erwischt die Suche die falsche Fassung.
- **Der Link ist frei.** Prime Video, Netflix, Disney+, eine Disc bei Amazon,
  was du willst. Das Script sieht die Zielseite nie an, es reicht den Link nur
  an die Kachel weiter. Der Nutzer landet nach einem Klick direkt dort.
- **Klicks öffnen in einem neuen Tab**, damit man beim Stöbern die Auswahl
  nicht verliert.

---

## Dateien

```
index.html                  Die Startseite
style.css                   Der Videothek-Look
app.js                      Baut die Regale aus den Daten
movies.json                 Die Filmdaten (wird automatisch erzeugt)
data/wishes.txt             Deine Liste - hier arbeitest du
scripts/build.mjs           Holt alle Infos von TMDB
package.json                npm-Befehle
.github/workflows/build.yml Läuft automatisch alle 12 Stunden
netlify.toml / vercel.json  Deployment-Konfiguration
scratch/tmdb-cache.json     Zwischenspeicher, damit Builds schnell bleiben
```

---

## Loslegen

```bash
cp .env.example .env      # TMDB-Key eintragen (einmalig)
npm install
npm run build             # erzeugt movies.json
npm run dev               # http://localhost:3000
```

Den TMDB-Key bekommst du kostenlos: themoviedb.org -> Account -> Einstellungen
-> API -> "API Key (v3 auth)". Nimm den **v3 auth Key**, nicht den langen Read
Access Token.

### Beim Bearbeiten der Liste

```bash
npm run build             # nach jeder Änderung an wishes.txt
```

Danach im Browser neu laden - fertig. Der Vorschau-Server muss dafür nicht neu
starten.

---

## Automatik auf GitHub

`.github/workflows/build.yml` läuft alle 12 Stunden und bei jeder Änderung an
`wishes.txt`. Es baut `movies.json` neu und committet sie. Netlify und Vercel
deployen bei jedem Commit automatisch.

Einmalig im Repository eintragen: **Settings -> Secrets and variables ->
Actions -> New repository secret**, Name `TMDB_API_KEY`, Wert dein Key.

---

## Regeln, die in der Seite stecken

- **Genau 24 Kacheln pro Regal.** Kein Nachladen, kein "mehr anzeigen", kein
  horizontales Endlos-Scrollen. Ist ein Regal voll, muss ein anderer Titel raus.
  Das Script warnt am Ende, wenn ein Regal mehr als 24 Einträge hat.
- **Ein Klick = Film.** Öffnet in neuem Tab.
- **Kein Login, keine Filter, keine Suche.** Der Sinn ist die kleine Auswahl.
- **Poster kommen direkt von TMDB** und werden nicht lokal gespeichert.
- **Attribution** steht im Footer: "This product uses the TMDB API but is not
  endorsed or certified by TMDB." Das ist Bedingung für die kostenlose Nutzung.

---

## Wenn etwas nicht klappt

**"bei TMDB nicht gefunden"** - Titel anders schreiben, oder das Jahr prüfen.
Der Originaltitel hilft manchmal, wenn die deutsche Fassung unter anderem Namen
läuft.

**Zeile wird übersprungen** - es fehlt ein `|`. Das Script listet solche Zeilen
direkt unter der Überschrift auf.

**Kachel bleibt, aber ohne Poster** - der Titel war bei TMDB nicht auffindbar.
Der Link funktioniert trotzdem.

**Änderung wirkt nicht** - `npm run build` vergessen. Die Seite liest immer nur
`movies.json`, nie `wishes.txt`.

**Terminal meldet `EPERM: uv_cwd`** - das Terminal steht in einem Ordner, den es
nicht mehr gibt. Neues Terminal öffnen, frisch in den Projektordner wechseln.

**Fehlerhafte Titel-Korrektur wirkt nicht** - der Zwischenspeicher hält den
alten Treffer. Löschen und neu bauen:

```bash
rm -f scratch/tmdb-cache.json && npm run build
```

---

## Später: Verdienen

Aktuell sind keine Affiliate-Links im Spiel und kein Tag wird angehängt. Wenn du
das später willst, sind es zwei Schritte: über das Amazon-PartnerNet einen
Affiliate-Tag holen, und im Script die Tag-Anhängung wieder aktivieren. Die
Links in `wishes.txt` können unverändert bleiben, der Tag wird automatisch
ergänzt.

Zu beachten wäre dann: Amazon vergütet nur Käufe physischer Produkte.
Prime-Video-Streamingseiten sind davon ausgenommen, dort verdienst du nichts.
Für eine Vergütung müsste der Link auf die DVD-/Blu-ray-Produktseite zeigen.

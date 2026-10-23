// build.mjs — liest data/wishes.txt und data/rooms.txt, baut movies.json
// Aufruf:  node scripts/build.mjs       (oder: npm run build)
//
// wishes.txt:  Titel | Jahr | Regal | Link
// rooms.txt:   Regal | Raum [| Wand]   ("---" erzwingt den naechsten Wandabschnitt)
//
// Amazon wird NICHT abgefragt. Alle Filminfos kommen von TMDB.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WISHES = resolve(ROOT, "data/wishes.txt");
const ROOMS = resolve(ROOT, "data/rooms.txt");
const OUT = resolve(ROOT, "movies.json");
const CACHE = resolve(ROOT, "scratch/tmdb-cache.json");

// Bei jeder Aenderung an den abgerufenen Feldern hochzaehlen:
// dann wirft das Script den Zwischenspeicher von selbst weg.
const CACHE_VERSION = 2;

loadEnv(resolve(ROOT, ".env"));

const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";

function loadEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    value = value.replace(/\r$/, "").replace(/\s+#.*$/, "").trim();

    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

if (!TMDB_KEY) {
  console.error("Fehlt: TMDB_API_KEY. Einmalig in .env eintragen - siehe README.");
  process.exit(1);
}

// ---------- data/rooms.txt lesen ----------
// Regal | Raum          -> Raum-Zugehoerigkeit
// Regal | Raum | Wand   -> zusaetzlich die Wand vorgeben (back/left/right)
// "---" auf eigener Zeile -> naechstes Regal kommt an die naechste Wand.

const WALLS = ["back", "left", "right"];
const WALL_DE = { back: "hinten", left: "links", right: "rechts" };

function parseRooms(text) {
  const out = [];
  const byRoom = { 1: [], 2: [] };
  const counters = { 1: 0, 2: 0 };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    // Trennlinie: naechstes Regal rueckt an die naechste Wand.
    if (/^-{2,}$/.test(line)) {
      const room = 1;
      counters[room]++;
      continue;
    }

    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 2 || !parts[0]) continue;

    const room = Number(parts[1]) === 2 ? 2 : 1;
    let wall = null;
    if (parts[2]) {
      const w = parts[2].toLowerCase();
      if (WALLS.includes(w)) wall = w;
      else if (w === "hier" || w === "vorne") wall = "back";
    }

    byRoom[room].push({ genre: parts[0], room, wall, tick: counters[room] });
    if (wall) counters[room] = Math.max(counters[room], WALLS.indexOf(wall) + 1);
  }

  for (const room of [1, 2]) {
    // Wand je Regal bestimmen: eigene Angabe > Trennzeilen > gleichmaessig.
    const list = byRoom[room];
    const walls = list.map((s) => {
      if (s.wall) return s.wall;
      return WALLS[Math.min(s.tick, 2)];
    });

    // Leere Plaetze gleichmaessig auffuellen.
    const used = WALLS.map((w) => walls.filter((x) => x === w).length);
    walls.forEach((w, i) => {
      if (w) return;
      let best = 0;
      for (let k = 1; k < 3; k++) if (used[k] < used[best]) best = k;
      walls[i] = WALLS[best];
      used[best]++;
    });

    list.forEach((s, i) => out.push({ genre: s.genre, room, wall: walls[i] }));
  }

  return out;
}

// ---------- data/wishes.txt lesen ----------

function parseWishes(text) {
  const out = [];
  const broken = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 4) {
      broken.push(line);
      continue;
    }

    const [title, year, genre, link] = parts;
    if (!title || !genre || !link) {
      broken.push(line);
      continue;
    }

    out.push({ title, year, genre, url: link });
  }

  return { out, broken };
}

// ---------- TMDB ----------

let cache = {};
if (existsSync(CACHE)) {
  try {
    const raw = JSON.parse(readFileSync(CACHE, "utf8"));
    if (raw && raw.version === CACHE_VERSION && raw.entries) cache = raw.entries;
    else console.log("Zwischenspeicher passt nicht mehr zur Version - wird neu geholt.\n");
  } catch {
    cache = {};
  }
}

async function tmdb(path, params = {}) {
  const qs = new URLSearchParams({ api_key: TMDB_KEY, language: "de-DE", ...params });
  const res = await fetch(`${TMDB}${path}?${qs}`);
  if (!res.ok) throw new Error(`TMDB ${res.status} bei ${path}`);
  return res.json();
}

async function findOnTmdb(title, year, genre) {
  const cacheKey = `${title}::${year}`;
  if (cache[cacheKey]) return { ...cache[cacheKey], genre };

  const search = await tmdb("/search/movie", year ? { query: title, year } : { query: title });
  const hit = (search.results || [])[0];
  if (!hit) return null;

  const details = await tmdb(`/movie/${hit.id}`, { append_to_response: "credits" });
  const credits = details.credits || {};

  const dir = (credits.crew || []).find((c) => c.job === "Director")?.name || null;

  // Die drei wichtigsten Darsteller. TMDB sortiert die Besetzung bereits
  // nach Wichtigkeit; wir nehmen nur die ersten Namen.
  const cast = (credits.cast || [])
    .slice(0, 3)
    .map((c) => c.name)
    .filter(Boolean);

  const entry = {
    title: details.title || hit.title,
    originalTitle: details.original_title || null,
    year: (details.release_date || "").slice(0, 4) || year || "",
    genres: (details.genres || []).map((g) => g.name),
    runtime: details.runtime ? String(details.runtime) : null,
    rating: details.vote_average ? details.vote_average.toFixed(1) : null,
    overview: details.overview || "",
    poster: details.poster_path ? IMG + details.poster_path : null,
    director: dir,
    cast,
    tmdbId: details.id,
  };

  cache[cacheKey] = entry;
  return { ...entry, genre };
}

// ---------- Hauptlauf ----------

const roomPlan = parseRooms(readFileSync(ROOMS, "utf8"));
const parsed = parseWishes(readFileSync(WISHES, "utf8"));
const wishes = parsed.out;

console.log(`${roomPlan.length} Regale in data/rooms.txt`);
console.log(`${wishes.length} Filme in data/wishes.txt\n`);

if (parsed.broken.length) {
  console.log("--- Zeilen im falschen Format (uebersprungen) ---");
  for (const b of parsed.broken) console.log("  " + b);
  console.log("  Erwartet:  Titel | Jahr | Regal | Link\n");
}

const movies = [];
const problems = [];

let i = 0;
for (const wish of wishes) {
  i++;
  process.stdout.write(`[${i}/${wishes.length}] ${wish.title} ... `);

  let entry = null;
  try {
    entry = await findOnTmdb(wish.title, wish.year, wish.genre);
  } catch (err) {
    problems.push(`${wish.title}: TMDB-Fehler - ${err.message}`);
  }

  if (entry) {
    entry.url = wish.url;
    movies.push(entry);
    console.log(`${entry.title} (${entry.year}) -> ${entry.genre}`);
  } else {
    movies.push({
      title: wish.title,
      genre: wish.genre,
      url: wish.url,
      poster: null,
      year: wish.year || "",
      runtime: null,
      rating: null,
      overview: "",
    });
    problems.push(`${wish.title} (${wish.year}): bei TMDB nicht gefunden`);
    console.log("nicht gefunden (Kachel bleibt, aber ohne Infos)");
  }
}

const shelves = roomPlan.map((s) => ({
  genre: s.genre,
  room: s.room,
  wall: s.wall,
  count: movies.filter((m) => m.genre === s.genre).length,
}));

const known = new Set(roomPlan.map((r) => r.genre));
for (const m of movies) {
  if (!known.has(m.genre)) problems.push(`${m.title}: Regal "${m.genre}" fehlt in data/rooms.txt`);
}

mkdirSync(dirname(OUT), { recursive: true });
mkdirSync(dirname(CACHE), { recursive: true });
writeFileSync(CACHE, JSON.stringify({ version: CACHE_VERSION, entries: cache }, null, 2));

writeFileSync(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), shelves, movies }, null, 2)
);

for (const room of [1, 2]) {
  console.log(`\n--- Raum ${room}${room === 1 ? " (Hauptraum)" : " (hinter der Tuer)"} ---`);
  const list = shelves.filter((s) => s.room === room);
  for (const wall of WALLS) {
    const onWall = list.filter((s) => s.wall === wall);
    if (!onWall.length) continue;
    console.log(`  ${WALL_DE[wall]}:`);
    for (const s of onWall) {
      const n = s.count;
      const flag = n > 24 ? "  ! ZU VIELE (max 24)" : n === 0 ? "  (leer)" : `  (${n}/24)`;
      console.log(`    ${s.genre.padEnd(18)} ${String(n).padStart(3)}${flag}`);
    }
  }
}

if (problems.length) {
  console.log("\n--- Hinweise ---");
  for (const p of problems) console.log("  " + p);
}

console.log(`\nmovies.json geschrieben: ${movies.length} Filme, ${shelves.length} Regale`);

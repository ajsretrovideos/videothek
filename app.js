/* ===========================================================
   app.js – Tür, zwei Räume, Regale, Zoom, Nahansicht
   Daten aus movies.json (npm run build).
   Anordnung und Raum-Zuordnung der Regale kommen aus data/rooms.txt.

   Klicks: Die Regale im 3D-Raum sind reine Deko. Klickbar sind
   flache Buttons in #hotspots, die auf der Bildschirmposition des
   jeweiligen Regals liegen. Grund: Klicks auf 3D-transformierte
   Kinder mit backface-visibility:hidden kommen unzuverlässig an.
   =========================================================== */

const MAX_PER_SHELF = 24;
const ZOOM_MS = 1000;
const ROOM_MS = 700;          // Wechsel zwischen den beiden Räumen
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhone = () => window.matchMedia("(max-width: 760px)").matches;

const $ = (id) => document.getElementById(id);
const els = {
  door: $("door"),
  enter: $("enter"),
  zoom: $("zoom"),
  hud: $("hud"),
  hotspots: $("hotspots"),
  backdoor: $("backdoor"),
  backdoorHot: $("backdoor-hot"),
  backroom: $("backroom"),
  detail: $("detail"),
  detailTitle: $("detail-title"),
  detailCount: $("detail-count"),
  detailGrid: $("detail-grid"),
  detailBack: $("detail-back"),
  lens: $("lens"),
  rooms: {
    1: { el: $("room1"), walls: { back: $("r1-back"), left: $("r1-left"), right: $("r1-right") } },
    2: { el: $("room2"), walls: { back: $("r2-back"), left: $("r2-left"), right: $("r2-right") } },
  },
};

let shelves = [];
let current = null;      // offenes Regal
let activeRoom = 1;      // welcher Raum gerade sichtbar ist
let busy = false;

init();

async function init() {
  setupDoor();

  let data;
  try {
    const res = await fetch("movies.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (err) {
    console.error("movies.json konnte nicht geladen werden:", err);
    showWallNotice("Die Filmdaten konnten nicht geladen werden. Erst „npm run build“ ausführen, dann neu laden.");
    return;
  }

  const movies = (data.movies || []).filter(Boolean);
  const plan = (data.shelves || []).filter((s) => s && s.genre);

  shelves = plan
    .map((s) => ({
      genre: s.genre,
      room: s.room === 2 ? 2 : 1,
      slug: slugify(s.genre),
      items: movies.filter((m) => m.genre === s.genre).slice(0, MAX_PER_SHELF),
      empty: !movies.some((m) => m.genre === s.genre),
      wallHint: s.wall || null,   // "back" | "left" | "right", wenn rooms.txt es vorgibt
    }));

  if (!shelves.some((s) => s.items.length)) {
    showWallNotice("Noch keine Filme in den Regalen. Trag welche in data/wishes.txt ein.");
    return;
  }

  buildRooms();
  showRoom(1, false);
  layoutHotspots();
  fitSigns();

  window.addEventListener("load", () => followHotspots(600));

  let t;
  const relayout = () => {
    clearTimeout(t);
    t = setTimeout(() => { layoutHotspots(); fitSigns(); }, 150);
  };
  window.addEventListener("resize", relayout);

  window.addEventListener("hashchange", () => route(true));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (current) leaveShelf();
    else if (activeRoom === 2) showRoom(1, true);
  });

  els.detailBack.addEventListener("click", leaveShelf);
  els.backdoorHot.addEventListener("click", () => showRoom(2, true));
  els.backroom.addEventListener("click", () => showRoom(1, true));

  route(false);
}

/* ---------- Tür ---------- */

function setupDoor() {
  let seen = false;
  try { seen = sessionStorage.getItem("vt-entered") === "1"; } catch {}

  if (seen) {
    els.door.remove();
    els.zoom.classList.remove("entering");
    return;
  }

  els.zoom.setAttribute("inert", "");
  els.hotspots.setAttribute("inert", "");
  els.hud.setAttribute("inert", "");
  els.enter.focus();

  els.enter.addEventListener("click", () => {
    try { sessionStorage.setItem("vt-entered", "1"); } catch {}
    els.door.classList.add("open");
    els.zoom.classList.remove("entering");
    els.zoom.removeAttribute("inert");
    els.hotspots.removeAttribute("inert");
    els.hud.removeAttribute("inert");
    followHotspots(reduceMotion ? 0 : 1400);
    setTimeout(() => els.door.remove(), reduceMotion ? 0 : 1200);
  });
}

/* ---------- Räume aufbauen ---------- */

// Wände für die Regale eines Raums bestimmen.
// Vorgabe aus rooms.txt (Spalte 3) hat Vorrang. Wo nichts steht, wird
// gleichmäßig gefüllt: bei 10 Regalen 4-3-3, bei 6 Regalen 2-2-2.
function assignWalls(list) {
  const walls = ["back", "left", "right"];
  const out = list.map((s) => s.wallHint);

  // Positionen ohne Vorgabe nachtragen – gleichmäßig auf die freien Plätze.
  const free = [];
  out.forEach((w, i) => { if (!w) free.push(i); });

  if (free.length) {
    // Zuerst die Vorgaben zählen, dann die Restlichen gleichmäßig auffüllen.
    const used = walls.map((w) => out.filter((x) => x === w).length);
    for (const i of free) {
      // die Wand mit den bisher wenigsten Regalen bekommt das nächste
      let best = 0;
      for (let k = 1; k < 3; k++) if (used[k] < used[best]) best = k;
      out[i] = walls[best];
      used[best]++;
    }
  }

  return out;
}

function buildRooms() {
  for (const room of [1, 2]) {
    const list = shelves.filter((s) => s.room === room);
    // Trennzeilen aus rooms.txt in eine Wandaufteilung übersetzen.
    const assign = assignWalls(list);
    list.forEach((s, i) => {
      const wall = assign[i];
      const host = els.rooms[room].walls[wall];

      // 1) Deko im 3D-Raum (nicht klickbar)
      const unit = document.createElement("div");
      unit.className = "unit";
      unit.setAttribute("aria-hidden", "true");

      const sign = document.createElement("span");
      sign.className = "unit-sign";
      sign.innerHTML =
        `<span class="unit-genre">${esc(s.genre)}</span>` +
        `<span class="unit-count">${s.empty ? "bald" : s.items.length + " Filme"}</span>`;

      const rack = document.createElement("span");
      rack.className = "unit-rack";

      for (let k = 0; k < MAX_PER_SHELF; k++) {
        const m = s.items[k];
        const mini = document.createElement("span");
        mini.className = m ? "mini" : "mini empty";
        if (m && m.poster) {
          mini.style.backgroundImage = `url("${m.poster.replace("/w500/", "/w154/")}")`;
        }
        rack.appendChild(mini);
      }

      unit.append(sign, rack);
      host.appendChild(unit);
      s.unit = unit;

      // 2) Klickfläche im flachen Overlay
      const hot = document.createElement("button");
      hot.type = "button";
      hot.className = "hot";
      hot.innerHTML = `<span class="hot-highlight"></span>`;
      hot.setAttribute(
        "aria-label",
        s.items.length
          ? `Regal ${s.genre}, ${s.items.length} Filme – näher herangehen`
          : `Regal ${s.genre} – hier kommt bald was dazu`
      );

      hot.addEventListener("click", () => {
        openedByClick = true;
        location.hash = "regal/" + s.slug;
      });
      hot.addEventListener("focus", () => unit.classList.add("is-hot"));
      hot.addEventListener("blur", () => unit.classList.remove("is-hot"));

      els.hotspots.appendChild(hot);
      s.hot = hot;
      s.room = room;
      s.wall = wall;
      s.hasItems = s.items.length > 0;
    });
  }
}

let openedByClick = false;

// Die Klickflächen auf die Bildschirmpositionen der Regale legen.
// Regale des gerade nicht sichtbaren Raums werden ausgeblendet,
// damit sie keine Klicks abfangen.
function layoutHotspots() {
  if (isPhone()) {
    els.hotspots.style.height = "";
    return;
  }
  for (const s of shelves) {
    const visible = s.room === activeRoom;
    s.hot.hidden = !visible;
    if (!visible) continue;

    const r = s.unit.getBoundingClientRect();
    s.hot.style.left = r.left + "px";
    s.hot.style.top = r.top + "px";
    s.hot.style.width = r.width + "px";
    s.hot.style.height = r.height + "px";
    s.hot.disabled = !s.hasItems;
    s.hot.style.cursor = s.hasItems ? "pointer" : "default";
  }
  layoutBackdoor();
}

// Die Klickfläche des Durchgangs auf die Bildschirmposition der Tür legen.
function layoutBackdoor() {
  const art = $("backdoor");
  const btn = els.backdoorHot;
  if (!art || !btn) return;

  const show = activeRoom === 1;
  btn.hidden = !show;
  if (!show) return;

  const r = art.getBoundingClientRect();
  btn.style.left = r.left - 8 + "px";
  btn.style.top = r.top - 8 + "px";
  btn.style.width = r.width + 16 + "px";
  btn.style.height = r.height + 16 + "px";
}

// Während einer laufenden Animation wandern die Regale - die Klickflächen
// müssen mit. Sonst treffen die ersten Klicks daneben.
let followTimer = null;
function followHotspots(ms) {
  const until = performance.now() + ms;
  clearInterval(followTimer);
  followTimer = setInterval(() => {
    layoutHotspots();
    if (performance.now() > until) {
      clearInterval(followTimer);
      followTimer = null;
      layoutHotspots();
    }
  }, 40);
}

// Genre-Schilder so verkleinern, dass lange Namen ganz draufpassen.
function fitSigns() {
  document.querySelectorAll(".unit-genre").forEach((g) => {
    g.style.fontSize = "";
    let size = parseFloat(getComputedStyle(g).fontSize);
    while (g.scrollWidth > g.clientWidth && size > 12) {
      size -= 2;
      g.style.fontSize = size + "px";
    }
  });
}

/* ---------- Raumwechsel ---------- */

function showRoom(room, animate) {
  if (room === activeRoom) return;
  activeRoom = room;

  const from = els.rooms[room === 1 ? 2 : 1].el;
  const to = els.rooms[room].el;

  els.zoom.classList.toggle("in-room-two", room === 2);
  els.backroom.hidden = room !== 2;
  els.backdoor.hidden = room === 2;

  if (reduceMotion || !animate) {
    from.hidden = true;
    to.hidden = false;
    layoutHotspots();
    followHotspots(300);
    return;
  }

  busy = true;
  // kurz herausgehen, Raum tauschen, wieder hineingehen
  els.zoom.classList.add("switching");
  setTimeout(() => {
    from.hidden = true;
    to.hidden = false;
    els.zoom.classList.remove("switching");
    layoutHotspots();
    followHotspots(ROOM_MS);
    setTimeout(() => { busy = false; }, ROOM_MS);
  }, ROOM_MS / 2);
}

/* ---------- Navigation (#regal/<name>) ---------- */

function route(animate) {
  const m = location.hash.match(/^#regal\/(.+)$/);
  const slug = m ? decodeURIComponent(m[1]) : null;

  if (slug) {
    const s = shelves.find((x) => x.slug === slug);
    if (!s || s === current) return;
    if (current) closeDetail();
    // Regal liegt im anderen Raum? Erst dort hinein, dann zoomen.
    enterShelf(s, animate);
  } else if (current) {
    closeDetail();
  }
}

async function enterShelf(s, animate) {
  if (busy) await waitWhileBusy();

  if (s.room !== activeRoom) {
    showRoom(s.room, false);
    await wait(80);
  }

  current = s;
  busy = true;

  if (animate && !reduceMotion) {
    const r = s.unit.getBoundingClientRect();
    const scale = Math.min((innerWidth * 0.92) / r.width, (innerHeight * 0.86) / r.height);
    const tx = innerWidth / 2 - scale * (r.left + r.width / 2);
    const ty = innerHeight / 2 - scale * (r.top + r.height / 2);
    els.zoom.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    els.hud.hidden = true;
    followHotspots(ZOOM_MS);
    await wait(ZOOM_MS);
  }

  renderDetail(s);
  els.detail.classList.add("open");
  els.detail.removeAttribute("inert");
  els.detail.setAttribute("aria-hidden", "false");
  els.zoom.setAttribute("inert", "");
  els.hotspots.setAttribute("inert", "");
  els.hud.hidden = true;
  els.detail.scrollTop = 0;
  els.detailBack.focus({ preventScroll: true });
  busy = false;
}

function leaveShelf() {
  if (!current) return;
  if (openedByClick) {
    openedByClick = false;
    history.back();
  } else {
    history.replaceState(null, "", location.pathname + location.search);
    closeDetail();
  }
}

function closeDetail() {
  const s = current;
  current = null;
  busy = true;

  els.detail.classList.remove("open");
  els.detail.setAttribute("inert", "");
  els.detail.setAttribute("aria-hidden", "true");
  els.zoom.removeAttribute("inert");
  els.hotspots.removeAttribute("inert");
  els.zoom.style.transform = "";
  els.hud.hidden = false;

  followHotspots(reduceMotion ? 0 : ZOOM_MS);
  setTimeout(() => {
    layoutHotspots();
    if (s) s.hot.focus({ preventScroll: true });
    busy = false;
  }, reduceMotion ? 0 : ZOOM_MS);
}

/* ---------- Nahansicht ---------- */

function renderDetail(s) {
  els.detailTitle.textContent = s.genre;
  els.detailCount.textContent = `${s.items.length} von ${MAX_PER_SHELF}`;
  els.detailGrid.innerHTML = "";
  s.items.forEach((m, i) => {
    const card = buildCard(m);
    card.style.animationDelay = `${Math.min(i, 23) * 25}ms`;
    els.detailGrid.appendChild(card);
  });
}

function buildCard(m) {
  const a = document.createElement("a");
  a.className = "card";
  a.href = m.url || "#";
  a.target = "_blank";
  a.rel = "noopener";

  const name = m.title || "Film ansehen";
  a.setAttribute("aria-label", `${name}${m.year ? " (" + m.year + ")" : ""} – beim Anbieter ansehen, neuer Tab`);

  const box = document.createElement("div");
  box.className = "poster-box";

  if (m.poster) {
    const img = document.createElement("img");
    img.src = m.poster;
    img.alt = `Filmplakat: ${name}`;
    img.loading = "lazy";
    img.decoding = "async";
    box.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "no-poster";
    ph.textContent = name;
    box.appendChild(ph);
  }

  a.appendChild(box);

  const meta = document.createElement("div");
  meta.className = "meta";

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = name;
  meta.appendChild(title);

  const factsEl = document.createElement("div");
  factsEl.className = "facts";
  factsEl.innerHTML = factsLine(m);
  meta.appendChild(factsEl);

  const castList = (m.cast || []).filter(Boolean).slice(0, 3);
  if (castList.length) {
    const castEl = document.createElement("div");
    castEl.className = "cast";
    castEl.textContent = castList.join(" · ");
    meta.appendChild(castEl);
  }

  a.appendChild(meta);

  const openLens = () => showLens(a, m, factsLine(m));
  a.addEventListener("mouseenter", openLens);
  a.addEventListener("focus", openLens);
  a.addEventListener("mouseleave", hideLens);
  a.addEventListener("blur", hideLens);

  return a;
}

// Jahr · Laufzeit · Regie · Bewertung
function factsLine(m) {
  const parts = [];
  if (m.year) parts.push(m.year);
  if (m.runtime) parts.push(m.runtime + " Min");
  if (m.director) parts.push(m.director);
  return (
    parts.map((f) => `<span>${esc(f)}</span>`).join("") +
    (m.rating ? `<span class="rating">★ ${esc(m.rating)}</span>` : "")
  );
}

/* ---------- Lupe ---------- */

let lensHideTimer = null;

function showLens(card, m, factsHtml) {
  clearTimeout(lensHideTimer);
  const lens = els.lens;

  lens.querySelector(".lens-name").textContent = m.title || "Film";
  lens.querySelector(".lens-facts").innerHTML = factsHtml || "";

  const castList = (m.cast || []).filter(Boolean).slice(0, 3);
  const castEl = lens.querySelector(".lens-cast");
  castEl.textContent = castList.length ? "Mit " + castList.join(", ") : "";
  castEl.hidden = !castList.length;

  lens.querySelector(".lens-text").textContent = m.overview || "";

  lens.classList.add("show");
  lens.setAttribute("aria-hidden", "false");
  card.classList.add("has-lens");

  placeLens(card);
}

function placeLens(card) {
  const lens = els.lens;
  const c = card.getBoundingClientRect();

  const lw = lens.offsetWidth;
  const lh = lens.offsetHeight;

  let left = c.right + 14;
  if (left + lw > innerWidth - 12) left = c.left - lw - 14;
  if (left < 12) left = Math.min(Math.max(12, c.left), innerWidth - lw - 12);

  let top = c.top + c.height / 2 - lh / 2;
  top = Math.max(12, Math.min(top, innerHeight - lh - 12));

  lens.style.left = left + "px";
  lens.style.top = top + "px";

  const tail = Math.max(18, Math.min(c.left + c.width / 2 - left, lw - 18));
  lens.style.setProperty("--tail", tail + "px");
}

function hideLens() {
  lensHideTimer = setTimeout(() => {
    els.lens.classList.remove("show");
    els.lens.setAttribute("aria-hidden", "true");
    document.querySelectorAll(".card.has-lens").forEach((c) => c.classList.remove("has-lens"));
  }, 60);
}

/* ---------- Helfer ---------- */

function showWallNotice(text) {
  const p = document.createElement("p");
  p.className = "wall-notice";
  p.textContent = text;
  els.rooms[1].walls.back.appendChild(p);
}

function waitWhileBusy() {
  return new Promise((r) => {
    const check = () => (busy ? setTimeout(check, 50) : r());
    check();
  });
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

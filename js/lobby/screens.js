/* =========================================================================
 *  SCREENS  (js/lobby/screens.js)
 *  -------------------------------------------------------------------------
 *  Everything that touches the DOM: populating the four screens from data,
 *  and the fade/drift transition between them. app.js owns *when* to call
 *  these; this module only knows *how*.
 * ======================================================================= */

const $ = (id) => document.getElementById(id);

const el = {
  loading: $("lobbyLoading"),
  error: $("lobbyError"),
  errorMessage: $("lobbyErrorMessage"),
  screens: {
    screen1: $("screen1"),
    screen2: $("screen2"),
    screen3: $("screen3"),
    screen4: $("screen4"),
  },

  composerShelf: $("composerShelf"),
  shelfPrev: $("shelfPrev"),
  shelfNext: $("shelfNext"),

  s2Portrait: $("s2Portrait"), s2Name: $("s2Name"), s2Lifespan: $("s2Lifespan"), s2Era: $("s2Era"),
  songList: $("songList"),

  s3Portrait: $("s3Portrait"), s3Name: $("s3Name"),
  s3Lifespan: $("s3Lifespan"), s3Era: $("s3Era"), s3Origin: $("s3Origin"), s3Bio: $("s3Bio"),

  s4Portrait: $("s4Portrait"), s4ComposerName: $("s4ComposerName"),
  s4Lifespan: $("s4Lifespan"), s4Era: $("s4Era"),
  s4DifficultyLabel: $("s4DifficultyLabel"), s4SongTitle: $("s4SongTitle"), s4Score: $("s4Score"),
};

/* A silhouette-and-initials placeholder, used only if a portraitUrl 404s —
 * every composer in game_data.json ships with a real (generated) SVG, so
 * this is a defensive fallback for whatever data you plug in later. */
function placeholderPortrait(name) {
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 3).join("").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 420">
    <rect width="340" height="420" fill="#241609"/>
    <circle cx="170" cy="160" r="62" fill="#0b0704" fill-opacity=".55"/>
    <path d="M62 410c0-64 44-116 108-116s108 52 108 116" fill="#0b0704" fill-opacity=".55"/>
    <text x="170" y="168" font-family="Georgia, serif" font-size="42" font-weight="700"
          fill="#c8a24d" text-anchor="middle" dominant-baseline="middle">${initials}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function setPortrait(img, composer) {
  img.src = composer.portraitUrl || placeholderPortrait(composer.name);
  img.alt = `Portrait of ${composer.name}`;
  img.onerror = () => { img.onerror = null; img.src = placeholderPortrait(composer.name); };
}

function formatScore(myScore) {
  return myScore > 0 ? myScore.toLocaleString() : "";
}

/* =====================================================================
 *  SCREEN 1 — composer shelf
 * =================================================================== */
export function renderComposerShelf(composers, onSelect) {
  el.composerShelf.innerHTML = "";
  composers.forEach((composer, i) => {
    const li = document.createElement("li");
    li.style.setProperty("--stagger", `${Math.min(i, 10) * 45}ms`);

    const btn = document.createElement("button");
    btn.className = "composer-card";
    btn.type = "button";
    btn.setAttribute("aria-label", `${composer.name} — ${composer.songs.length} piece${composer.songs.length === 1 ? "" : "s"}`);
    btn.innerHTML = `
      <span class="card-frame">
        <img class="card-portrait" alt="" />
      </span>
      <span class="card-plate">
        <span class="name">${escapeHtml(composer.name)}</span>
        <span class="era">${escapeHtml(composer.era)}</span>
      </span>
    `;
    setPortrait(btn.querySelector(".card-portrait"), composer);
    btn.addEventListener("click", () => onSelect(composer));

    li.appendChild(btn);
    el.composerShelf.appendChild(li);
  });
}

export function bindShelfNav() {
  const scrollByCards = (dir) => {
    const amount = Math.min(el.composerShelf.clientWidth * 0.7, 600) * dir;
    el.composerShelf.scrollBy({ left: amount, behavior: "smooth" });
  };
  el.shelfPrev.addEventListener("click", () => scrollByCards(-1));
  el.shelfNext.addEventListener("click", () => scrollByCards(1));
}

/* =====================================================================
 *  SCREEN 2 — song selection
 * =================================================================== */
export function renderComposerSummary(composer) {
  setPortrait(el.s2Portrait, composer);
  el.s2Name.textContent = composer.name;
  el.s2Lifespan.textContent = composer.lifespan;
  el.s2Era.textContent = composer.era;
}

export function renderSongList(composer, onSelect) {
  el.songList.innerHTML = "";

  if (!composer.songs.length) {
    const li = document.createElement("li");
    li.className = "song-list-empty";
    li.textContent = "No pieces are available for this composer yet.";
    el.songList.appendChild(li);
    return;
  }

  composer.songs.forEach((song) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "song-row";

    const score = formatScore(song.myScore);
    btn.innerHTML = `
      <span class="song-title">${escapeHtml(song.title)}</span>
      <span class="song-score${score ? " has-score" : ""}">${score ? "Best " + score : "Not played yet"}</span>
      <span class="difficulty-badge ${song.difficulty.toLowerCase()}">${titleCase(song.difficulty)}</span>
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
    `;
    btn.addEventListener("click", () => onSelect(song));
    li.appendChild(btn);
    el.songList.appendChild(li);
  });
}

/* =====================================================================
 *  SCREEN 3 — biography
 * =================================================================== */
export function renderBiography(composer) {
  setPortrait(el.s3Portrait, composer);
  el.s3Name.textContent = composer.name;
  el.s3Lifespan.textContent = composer.lifespan;
  el.s3Era.textContent = composer.era;
  el.s3Origin.textContent = composer.origin;

  el.s3Bio.innerHTML = "";
  const paragraphs = composer.biography.split(/\n{2,}/);
  for (const p of paragraphs) {
    const para = document.createElement("p");
    para.textContent = p.trim();
    para.style.margin = "0 0 1.1em";
    el.s3Bio.appendChild(para);
  }
}

/* =====================================================================
 *  SCREEN 4 — pre-play
 * =================================================================== */
export function renderPreplay(composer, song) {
  setPortrait(el.s4Portrait, composer);
  el.s4ComposerName.textContent = composer.name;
  el.s4Lifespan.textContent = composer.lifespan;
  el.s4Era.textContent = composer.era;

  el.s4DifficultyLabel.textContent = titleCase(song.difficulty) + " difficulty";
  el.s4SongTitle.textContent = song.title;

  const score = formatScore(song.myScore);
  el.s4Score.textContent = score || "Not yet played";
  el.s4Score.classList.toggle("is-empty", !score);
}

/* =====================================================================
 *  SCREEN STACK / TRANSITIONS / LOADING / ERROR
 * =================================================================== */
let current = null;

/** @param {"screen1"|"screen2"|"screen3"|"screen4"} name
 *  @param {"forward"|"back"} [direction] */
export function showScreen(name, direction = "forward") {
  const dirClass = direction === "back" ? "enter-back" : "enter-forward";

  for (const [key, node] of Object.entries(el.screens)) {
    node.classList.remove("enter-forward", "enter-back");
    if (key === name) {
      node.classList.add(dirClass);
      // force layout so the transition plays even if it was already display:none
      void node.offsetWidth;
      node.classList.add("is-active");
    } else {
      node.classList.remove("is-active");
    }
  }
  current = name;
}

export function currentScreen() { return current; }

export function showLoading() {
  el.loading.hidden = false;
  el.error.hidden = true;
}

export function showLobbyError(message) {
  el.loading.hidden = true;
  el.error.hidden = false;
  el.errorMessage.textContent = message;
}

export function hideLoadingAndError() {
  el.loading.hidden = true;
  el.error.hidden = true;
}

export function onRetry(handler) {
  $("retryBtn").addEventListener("click", handler);
}

/* ---- tiny helpers ------------------------------------------------------ */
function titleCase(s) { return s.charAt(0) + s.slice(1).toLowerCase(); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* =========================================================================
 *  INTEGRATION  (js/integration.js)
 *  -------------------------------------------------------------------------
 *  The only file in this project that knows both the lobby and the
 *  gameplay engine exist. js/lobby/* and js/game.js never import from each
 *  other — they talk entirely through DOM events and `window.game` (see
 *  LOBBY.md, "Hooking up the real gameplay"). Delete this file and its
 *  <script> tag in index.html and each half still works on its own: the
 *  lobby falls back to its mock "gameplay" panel, and the game falls back
 *  to showing its own setup screen.
 *
 *  Loaded after js/main.js (so window.game already exists) and after
 *  js/lobby/app.js (so #lobby-root's screens already exist) — see the
 *  <script> order at the bottom of index.html.
 * ======================================================================= */

const byId = (id) => document.getElementById(id);
const hideLobby = () => byId("lobby-root").classList.add("is-hidden");
const showLobby = () => byId("lobby-root").classList.remove("is-hidden");

/* The lobby is the front door now, so the game's own setup screen starts
 * hidden. It's still fully there for anyone who wants to load their own
 * audio, record a chart by ear, or open the piano-roll editor — reachable
 * via the lobby's quiet "Load your own song" link, with its own quiet
 * "Back to composers" link to return. */
byId("startScreen").hidden = true;

/* ---- Lobby → gameplay --------------------------------------------------- */
document.addEventListener("lobby:play", async (e) => {
  const { song } = e.detail;
  hideLobby();

  const loaded = await window.game.loadChartFromURL(song.chartUrl);
  if (!loaded) return;   // game.js already shows why in #chartReport

  try {
    await window.game.conductor.loadURL(song.audioUrl);
  } catch (err) {
    console.warn(`Couldn't load ${song.audioUrl} — playing with the built-in harpsichord instead.`, err);
  }
  window.game.startRun();
});

/* ---- Gameplay → lobby ---------------------------------------------------
 * game.js dispatches a cancelable "game:exit" from toMenu() instead of
 * unconditionally showing its own setup screen. Claiming it here (via
 * preventDefault) means that fallback never runs. */
document.addEventListener("game:exit", (e) => {
  e.preventDefault();
  showLobby();
});

/* ---- the two escape hatches between the lobby and the setup screen ----- */
byId("customChartLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  hideLobby();
  byId("startScreen").hidden = false;
});

byId("backToLobbyBtn")?.addEventListener("click", (e) => {
  e.preventDefault();
  byId("startScreen").hidden = true;
  showLobby();
});

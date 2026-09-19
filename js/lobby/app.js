/* =========================================================================
 *  APP  (js/lobby/app.js)
 *  -------------------------------------------------------------------------
 *  Bootstraps the lobby: fetch game_data.json, wire the four screens'
 *  navigation, and hand off to gameplay when Play is pressed.
 *
 *  ── HOOKING UP THE REAL 3D GAMEPLAY ───────────────────────────────────────
 *  Pressing Play does two things, either of which is enough to integrate:
 *
 *    1. Dispatches a CustomEvent on `document`:
 *         document.addEventListener('lobby:play', (e) => {
 *           const { composer, song } = e.detail;
 *           // song.chartUrl and song.audioUrl are exactly what
 *           // game.loadChartFromURL() / game.conductor.loadURL() expect
 *         });
 *
 *    2. Calls `window.onLobbyPlay(detail)` if you've defined it — a plain
 *       function is sometimes simpler to wire up than an event listener.
 *
 *  Concretely, against the gameplay module already in this project:
 * *    document.addEventListener('lobby:play', async ({ detail }) => {
 *      document.getElementById('lobby-root').classList.add('is-hidden');
 *      if (await game.loadChartFromURL(detail.song.chartUrl)) {
 *        // if this rejects, startRun() still plays — just with the
 *        // built-in harpsichord instead of the song's own recording
 *        await game.conductor.loadURL(detail.song.audioUrl).catch(() => {});
 *        game.startRun();
 *      }
 *    });
 *
 *  Everything below the "MOCK GAMEPLAY HANDOFF" comment exists only so this
 *  file is self-demonstrating without a real gameplay module attached — it
 *  checks for `window.game` and quietly does nothing once one exists, so
 *  there's nothing to delete. In this project, `js/integration.js` is what
 *  actually implements hook #1 above for `index.html` — see LOBBY.md.
 * ======================================================================= */

import { loadGameData, GameDataError } from "./data.js";
import {
  renderComposerShelf, bindShelfNav,
  renderComposerSummary, renderSongList,
  renderBiography, renderPreplay,
  showScreen, currentScreen,
  showLoading, showLobbyError, hideLoadingAndError, onRetry,
} from "./screens.js";

const state = {
  composers: [],
  currentComposer: null,
  currentSong: null,
};

async function init() {
  showLoading();
  try {
    state.composers = await loadGameData("game_data.json");
  } catch (err) {
    const message = err instanceof GameDataError
      ? err.message
      : "An unexpected error kept the programme from loading.";
    showLobbyError(message);
    return;
  }
  hideLoadingAndError();
  renderComposerShelf(state.composers, goToComposer);
  showScreen("screen1");
}

/* ---- navigation ------------------------------------------------------- */
function goToComposer(composer) {
  state.currentComposer = composer;
  renderComposerSummary(composer);
  renderSongList(composer, goToSong);
  showScreen("screen2", "forward");
}

function goToSong(song) {
  state.currentSong = song;
  renderPreplay(state.currentComposer, song);
  showScreen("screen4", "forward");
}

function goToBiography() {
  renderBiography(state.currentComposer);
  showScreen("screen3", "forward");
}

function back() {
  const from = currentScreen();
  if (from === "screen2") showScreen("screen1", "back");
  else if (from === "screen3" || from === "screen4") showScreen("screen2", "back");
}

document.getElementById("backTo1").addEventListener("click", back);
document.getElementById("backTo2FromBio").addEventListener("click", back);
document.getElementById("backTo2FromPreplay").addEventListener("click", back);
document.getElementById("infoBtn").addEventListener("click", goToBiography);
onRetry(init);
bindShelfNav();

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && currentScreen() !== "screen1") back();
});

/* ---- the Play handoff --------------------------------------------------
 * This is the one function a real integration needs to know about: it
 * always fires the event and the callback. Everything after that line is
 * the mock demo panel, and only runs when no real gameplay module has
 * attached itself (i.e. window.game doesn't exist) — see the file header. */
document.getElementById("playBtn").addEventListener("click", () => {
  const detail = { composer: state.currentComposer, song: state.currentSong };

  document.dispatchEvent(new CustomEvent("lobby:play", { detail, bubbles: true }));
  if (typeof window.onLobbyPlay === "function") window.onLobbyPlay(detail);

  /* ============================================================
   *  MOCK GAMEPLAY HANDOFF — demo only, present only in lobby.html.
   *  index.html's real gameplay module sets window.game before this
   *  ever runs, so this block is dead code there — nothing to delete.
   * ============================================================ */
  const mock = document.getElementById("mockGameplay");
  if (mock && !window.game) {
    document.getElementById("lobby-root").classList.add("is-hidden");
    document.getElementById("mockSongTitle").textContent = detail.song.title;
    document.getElementById("mockComposerName").textContent = detail.composer.name;
    mock.hidden = false;
  }
});

document.getElementById("mockBackBtn")?.addEventListener("click", () => {
  document.getElementById("mockGameplay").hidden = true;
  document.getElementById("lobby-root").classList.remove("is-hidden");
});
/* ============================================================
 *  END MOCK GAMEPLAY HANDOFF
 * ============================================================ */

init();

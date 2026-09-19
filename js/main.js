import { Game } from "./game.js";

/* =========================================================================
 *  MAIN  (js/main.js)
 * ======================================================================= */
const game = new Game();

/* Handy in the devtools console:
 *   game.loadChartFromURL("charts/my-song.json")
 *   game.conductor.loadURL("assets/audio/my-song.mp3")
 *   game.nudgeOffset(0.02)
 */
window.game = game;

/* ---------------------------------------------------------------------
 *  AUTO-LOAD
 *  Once you're serving the folder over http(s), point these at your own
 *  files and the game starts ready to play — no pickers needed. They are
 *  skipped on file:// because fetch() can't read local files there.
 * ------------------------------------------------------------------- */
const AUTOLOAD = {
  chart: "",   // e.g. "charts/my-song.json"
  audio: "",   // e.g. "assets/audio/my-song.mp3"  (or read it from the chart)
};

if (location.protocol.startsWith("http")) {
  (async () => {
    /* ?chart=charts/other.json overrides the constant above, which makes
       testing several charts a matter of editing the URL. */
    const q = new URLSearchParams(location.search);
    const chartURL = q.get("chart") || AUTOLOAD.chart;
    if (!chartURL) return;

    const ok = await game.loadChartFromURL(chartURL);
    if (!ok) return;

    document.getElementById("chartName").textContent = chartURL;
    document.getElementById("chartName").className = "slot-value ok";

    /* The chart names its own audio, so one URL is usually enough. */
    const audioURL = q.get("audio") || AUTOLOAD.audio || game.chart.song.audio;
    if (!audioURL) return;
    try {
      await game.conductor.loadURL(audioURL);
      document.getElementById("audioName").textContent = audioURL;
      document.getElementById("audioName").className = "slot-value ok";
      game.reset();
    } catch (err) {
      document.getElementById("audioName").textContent =
        "couldn't load " + audioURL + " — " + err.message;
      document.getElementById("audioName").className = "slot-value bad";
    }
  })();
}

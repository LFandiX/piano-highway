/* =========================================================================
 *  build-unified.mjs — bundle the ENTIRE project (lobby + gameplay + editor)
 *  into one standalone, self-contained HTML file.
 *  -------------------------------------------------------------------------
 *      node build-unified.mjs
 *
 *  Writes dist/piano-classics-unified.html: both stylesheets inlined, every
 *  JS module concatenated (import/export stripped, same technique as
 *  build.mjs and build-lobby.mjs), game_data.json embedded with every
 *  portrait as a data: URI, and js/integration.js wiring the two halves
 *  together exactly as it does in the served project.
 *
 *  This is the file to open with a double-click, or to publish/share as one
 *  page, when you want the whole thing — Lobby, real 3D gameplay, and the
 *  piano-roll editor — with zero server and zero external files. Only
 *  Handel's "Alla Hornpipe" has a real chart bundled in (js/demo-chart.js);
 *  the other four composers' songs use the same placeholder chartUrl/audioUrl
 *  paths as the served project, so picking one shows the chart-loading
 *  error UI rather than a crash — exactly as it would in the served version
 *  before you've added real charts for them.
 * ======================================================================= */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const strip = (src) =>
  src
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*["']\.\/[^"']+["'];?/g, "")
    .split("\n")
    .map((l) => l.replace(/^(\s*)export\s+(const|let|class|function|async)\b/, "$1$2"))
    .join("\n");

const section = (name, src) => `\n/* ===== ${name} ${"=".repeat(Math.max(0, 66 - name.length))} */\n${strip(src)}`;

/* ---- embed every chart file that actually exists on disk ---- */
import { readdirSync } from "node:fs";
const embeddedCharts = {};
for (const f of readdirSync("charts")) {
  if (f.endsWith(".json")) embeddedCharts[`charts/${f}`] = JSON.parse(readFileSync(`charts/${f}`, "utf8"));
}
const embeddedChartsJs = `const EMBEDDED_CHARTS = ${JSON.stringify(embeddedCharts)};\n`;

/* chart.js's loadChartURL always fetch()es, but fetch() of a relative path
   is rejected under file:// — the whole reason this bundle exists. Any
   song whose chartUrl matches a real file above (in this dataset, that's
   just Handel's) now loads from memory instead; a song whose chartUrl was
   only ever a placeholder still attempts the fetch, still fails, and still
   surfaces the same "couldn't load" message in #chartReport as it does in
   the served project — nothing about that path changes. */
let chartJs = readFileSync("js/chart.js", "utf8");
chartJs = chartJs.replace(
  /export async function loadChartURL\(url\) \{[\s\S]*?\n\}/,
  `async function loadChartURL(url) {
  if (EMBEDDED_CHARTS[url]) return parseChart(EMBEDDED_CHARTS[url]);
  const res = await fetch(url);
  if (!res.ok) throw new Error(\`Chart fetch failed: \${res.status} \${url}\`);
  return parseChart(await res.json());
}`
);

/* ---- embed game_data.json, with every portrait inlined ---- */
const composers = JSON.parse(readFileSync("game_data.json", "utf8"));
for (const c of composers) {
  if (c.portraitUrl && c.portraitUrl.endsWith(".svg")) {
    c.portraitUrl = "data:image/svg+xml;utf8," + encodeURIComponent(readFileSync(c.portraitUrl, "utf8"));
  }
}
const embeddedData = `const EMBEDDED_GAME_DATA = ${JSON.stringify(composers)};\n`;

/* ---- lobby's data.js: swap the fetch for the embedded array ---- */
let lobbyDataJs = readFileSync("js/lobby/data.js", "utf8");
lobbyDataJs = lobbyDataJs.replace(
  /export async function loadGameData\([\s\S]*?\n\}/,
  `async function loadGameData() {
  const raw = EMBEDDED_GAME_DATA;
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.composers) ? raw.composers : null;
  if (!list) throw new GameDataError("Embedded game data should be an array of composers.");
  if (!list.length) throw new GameDataError("Embedded game data has no composers in it.");
  return list.map(normalizeComposer);
}`
);

/* ---- every module, in dependency order (gameplay, then lobby, then the glue) ---- */
const modules = [
  section("js/config.js", readFileSync("js/config.js", "utf8")),
  section("js/chart.js", chartJs),
  section("js/demo-chart.js", readFileSync("js/demo-chart.js", "utf8")),
  section("js/audio.js", readFileSync("js/audio.js", "utf8")),
  section("js/render.js", readFileSync("js/render.js", "utf8")),
  section("js/input.js", readFileSync("js/input.js", "utf8")),
  section("js/recorder.js", readFileSync("js/recorder.js", "utf8")),
  section("js/editor.js", readFileSync("js/editor.js", "utf8")),
  section("js/game.js", readFileSync("js/game.js", "utf8")),
  section("js/lobby/data.js", lobbyDataJs),
  section("js/lobby/screens.js", readFileSync("js/lobby/screens.js", "utf8")),
  section("js/lobby/app.js", readFileSync("js/lobby/app.js", "utf8")),
  section("js/integration.js", readFileSync("js/integration.js", "utf8")),
].join("\n");

const boot = `
/* ===== boot ==================================================== */
const game = new Game();
window.game = game;
`;

const html = readFileSync("index.html", "utf8");
const styleCss = readFileSync("css/style.css", "utf8");
const lobbyCss = readFileSync("css/lobby.css", "utf8");

let out = html
  .replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${styleCss}\n</style>`)
  .replace(/\s*<!-- LOBBY:START -->\s*<link rel="stylesheet" href="css\/lobby\.css">\s*<!-- LOBBY:END -->/, `\n<style>\n${lobbyCss}\n</style>`)
  .replace(/<!-- LOBBY:START -->|<!-- LOBBY:END -->/g, "")   // markup markers themselves are just kept inline here
  .replace(
    '<script type="module" src="js/main.js"></script>',
    `<script>\n"use strict";\n(function(){\n${embeddedChartsJs}\n${embeddedData}\n${modules}\n${boot}\n})();\n<\/script>`
  )
  .replace('<script type="module" src="js/lobby/app.js"></script>', "")
  .replace('<script type="module" src="js/integration.js"></script>', "")
  .replace("<title>Piano Highway</title>", "<title>Piano Classics — unified</title>");

/* game.js's demo-chart dynamic import has no meaning once inlined */
out = out.replace(
  'const { DEMO_CHART } = await import("./demo-chart.js");',
  "/* DEMO_CHART is inlined above */"
);

mkdirSync("dist", { recursive: true });
writeFileSync("dist/piano-classics-unified.html", out);
console.log(`dist/piano-classics-unified.html — ${(out.length / 1024).toFixed(0)} KB`);

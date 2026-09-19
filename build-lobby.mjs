/* =========================================================================
 *  build-lobby.mjs — bundle the lobby into one standalone, self-contained
 *  HTML file for preview/sharing.
 *  -------------------------------------------------------------------------
 *      node build-lobby.mjs
 *
 *  Writes dist/lobby-standalone.html: CSS inlined, the three lobby modules
 *  concatenated (import/export stripped, same technique as build.mjs),
 *  game_data.json embedded as a JS constant, and every portrait SVG
 *  embedded as a data: URI — so the file has zero external dependencies
 *  and works from a single static page with no server and no fetch().
 *
 *  The real project still fetches game_data.json normally when served
 *  (see js/lobby/data.js) — this script only affects the bundled copy.
 * ======================================================================= */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";

const composers = JSON.parse(readFileSync("game_data.json", "utf8"));

/* ---- inline every portrait as a data: URI ---- */
for (const c of composers) {
  if (c.portraitUrl && c.portraitUrl.endsWith(".svg")) {
    const svg = readFileSync(c.portraitUrl, "utf8");
    c.portraitUrl = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }
}

const embeddedData = `const EMBEDDED_GAME_DATA = ${JSON.stringify(composers)};\n`;

/* ---- strip import/export from a module's source, same rule as build.mjs ---- */
const strip = (src) =>
  src
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*["']\.\/[^"']+["'];?/g, "")
    .split("\n")
    .map((l) => l.replace(/^(\s*)export\s+(const|let|class|function|async)\b/, "$1$2"))
    .join("\n");

let dataJs = readFileSync("js/lobby/data.js", "utf8");
/* Swap the network fetch for the embedded array — everything after the
 * fetch (validation, normalization) is unchanged and still runs. */
dataJs = dataJs.replace(
  /export async function loadGameData\([\s\S]*?\n\}/,
  `async function loadGameData() {
  const raw = EMBEDDED_GAME_DATA;
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.composers) ? raw.composers : null;
  if (!list) throw new GameDataError("Embedded game data should be an array of composers.");
  if (!list.length) throw new GameDataError("Embedded game data has no composers in it.");
  return list.map(normalizeComposer);
}`
);

const screensJs = readFileSync("js/lobby/screens.js", "utf8");
const appJs = readFileSync("js/lobby/app.js", "utf8");

const modules = [
  ["js/lobby/data.js", strip(dataJs)],
  ["js/lobby/screens.js", strip(screensJs)],
  ["js/lobby/app.js", strip(appJs)],
]
  .map(([name, src]) => `\n/* ===== ${name} ${"=".repeat(Math.max(0, 66 - name.length))} */\n${src}`)
  .join("\n");

const html = readFileSync("lobby.html", "utf8");
const css = readFileSync("css/lobby.css", "utf8");

const out = html
  .replace('<link rel="stylesheet" href="css/lobby.css">', `<style>\n${css}\n</style>`)
  .replace(
    '<script type="module" src="js/lobby/app.js"></script>',
    `<script>\n"use strict";\n(function(){\n${embeddedData}\n${modules}\n})();\n<\/script>`
  )
  .replace("<title>Piano Classics — Lobby</title>", "<title>Piano Classics — Lobby (standalone)</title>");

mkdirSync("dist", { recursive: true });
writeFileSync("dist/lobby-standalone.html", out);
console.log(`dist/lobby-standalone.html — ${(out.length / 1024).toFixed(0)} KB`);

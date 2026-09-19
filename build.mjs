/* =========================================================================
 *  build.mjs — bundle the project into one standalone HTML file
 *  -------------------------------------------------------------------------
 *      node build.mjs
 *
 *  Writes dist/piano-highway.html: CSS and every module inlined, so it runs
 *  from a double-click with no server. The modular source under js/ stays
 *  the thing you edit; this is only for sharing a single file.
 *
 *  It concatenates the modules in dependency order and strips the import /
 *  export keywords, which works because nothing here uses namespace imports,
 *  renamed exports, or circular references.
 * ======================================================================= */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const ORDER = [
  "js/config.js",
  "js/chart.js",
  "js/demo-chart.js",
  "js/audio.js",
  "js/render.js",
  "js/input.js",
  "js/recorder.js",
  "js/editor.js",
  "js/game.js",
];

const strip = (src) =>
  src
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*["']\.\/[^"']+["'];?/g, "")
    .split("\n")
    .map((l) => l.replace(/^(\s*)export\s+(const|let|class|function|async)\b/, "$1$2"))
    .join("\n");

const modules = ORDER.map(
  (f) => `\n/* ===== ${f} ${"=".repeat(Math.max(0, 62 - f.length))} */\n` + strip(readFileSync(f, "utf8"))
).join("\n");

/* game.js dynamically imports demo-chart.js; inlined, DEMO_CHART is already
   in scope, so the await import() has to become a plain object. */
const boot = `
/* ===== boot ==================================================== */
const game = new Game();
window.game = game;
`;

const html = readFileSync("index.html", "utf8")
  /* index.html is also the unified lobby+game entry point (see LOBBY.md).
     This bundle is the lobby-free "just the game" one, so strip every
     region the lobby merge marked off — its <link>, its markup, its two
     <script> tags — before the usual inlining below. */
  .replace(/\s*<!-- LOBBY:START -->[\s\S]*?<!-- LOBBY:END -->\n?/g, "");
const css = readFileSync("css/style.css", "utf8");

const out = html
  .replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}\n</style>`)
  .replace(
    '<script type="module" src="js/main.js"><\/script>',
    `<script>\n"use strict";\n(function(){\n${modules}\n${boot}\n})();\n<\/script>`
  )
  .replace("<title>Piano Highway</title>", "<title>Piano Highway — standalone</title>");

/* the dynamic import inside bindUI has no meaning once bundled */
const patched = out.replace(
  'const { DEMO_CHART } = await import("./demo-chart.js");',
  "/* DEMO_CHART is inlined above */"
);

mkdirSync("dist", { recursive: true });
writeFileSync("dist/piano-highway.html", patched);
console.log(`dist/piano-highway.html — ${(patched.length / 1024).toFixed(0)} KB`);

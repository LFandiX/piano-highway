# Piano Highway

A six-lane rhythm game with a 3D wooden highway, taps, chords and hold notes.
Charts are plain JSON files timed in seconds, so you can point it at any song
you like.

**`index.html` is the whole thing, unified**: it opens on the Lobby (browse
composers, pick a piece), and pressing Play drops straight into the real 3D
gameplay for that song. The three parts are still separate *files* under the
hood — nothing in `js/lobby/*` imports from `js/game.js` or vice versa, they
only talk through one DOM event — so each remains easy to reason about or
reuse on its own:

- **Lobby** (`css/lobby.css`, `js/lobby/`) — composer and song selection.
  See **LOBBY.md**. Also runnable on its own via `lobby.html`.
- **Gameplay** (`css/style.css`, `js/game.js`, `js/render.js`, `js/input.js`,
  `js/audio.js`, `js/chart.js`) — the 3D highway itself.
- **Editor** (`js/editor.js`, `js/recorder.js`) — the piano-roll chart editor.
- **`js/integration.js`** — the glue between the first two. It's the only
  file that knows both exist; delete it and each half still works alone
  (the lobby falls back to a mock "gameplay" panel, the game falls back to
  showing its own setup screen). See LOBBY.md, "Hooking up the real gameplay".

Either front door still reaches everything: the Lobby has a quiet **Load
your own song** link to the game's own setup screen (upload your own audio
and chart, record one by ear, or open the piano-roll editor), and that
screen has a matching **Back to composers** link.

## Run it

```bash
cd game
npx serve .          # or: python3 -m http.server 8000
```

Open `index.html` — that's the whole game, starting at the Lobby. (`lobby.html`
on its own is a preview/demo copy that stands in a mock "gameplay" panel where
the real thing would go — useful for working on the lobby in isolation.) A
server is required either way, because ES modules and `fetch()` are blocked
on `file://`.

If you just want to click a file and play with no server, three options:
- `dist/piano-classics-unified.html` — everything: Lobby, real 3D gameplay,
  and the editor, all in one file (`node build-unified.mjs` to regenerate).
  Only Handel's "Alla Hornpipe" has a real chart bundled in, so it's the
  one worth picking from the shelf — the other four composers' songs use
  placeholder file paths and will show the same "couldn't load" message
  they'd show in the served version once you add real charts for them.
- `dist/piano-highway.html` — gameplay + editor, no lobby.
- `dist/lobby-standalone.html` — the lobby alone, with a mock "gameplay" panel.

Regenerate any of the three with `node build.mjs`, `node build-lobby.mjs`, or
`node build-unified.mjs` after making changes.

## Use your own song

1. Drop the audio in `assets/audio/`.
2. Copy `charts/template.json` to `charts/my-song.json`, point `song.audio` at
   your file, and fill in `notes`. The format is in **CHART-FORMAT.md**; the
   short version is `{ "t": seconds, "lane": 0-5, "d": holdSeconds }`.
3. Load both with the pickers on the setup screen — click **Load your own
   song** on the Lobby to reach it — or skip the pickers:

```js
// js/main.js
const AUTOLOAD = {
  chart: "charts/my-song.json",
  audio: "assets/audio/my-song.mp3",   // or leave blank to use song.audio
};
```

You can also pass them in the URL, which is quicker while iterating:

```
http://localhost:3000/?chart=charts/my-song.json
```

### Don't want to type timestamps?

Load your audio, hit **Record a chart by ear**, and tap along. Every press
becomes a note at the second you pressed it; hold a key and you get a hold of
that length. Set the BPM first so your taps snap to the grid.

Stopping the recording drops you straight into the **piano roll editor** —
your six lanes laid out against the waveform, so you can fix anything the
first pass got wrong before saving:

| Action | How |
|---|---|
| Add a tap | click an empty spot in a lane |
| Add a hold | click-drag across an empty spot |
| Move a note | drag its body — up/down changes lane, left/right changes time |
| Resize a hold | drag either end |
| Delete one note | click it, then <kbd>Delete</kbd>; or right-click it |
| Select several | Shift-drag a box around them, then <kbd>Delete</kbd> |
| Nudge precisely | click a note, then the arrow keys |
| Undo / redo | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> |
| Play / pause | <kbd>Space</kbd>, or click the ruler to scrub |
| Zoom | <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + scroll |

Notes that overlap in the same lane get outlined in red so you can spot a
mistake before it blocks Play. When it looks right, **Download .json** to
save the file, or **Use this chart** to jump straight into a run.

The same editor opens on *any* loaded chart — click **Open piano roll
editor** on the setup screen to touch up the demo, an uploaded chart, or
start one completely from scratch.

## Calibrate

Play, press <kbd>Esc</kbd>, and nudge the offset ±5 ms until the notes land on
the beat. Copy the result into `song.offset` (in seconds — +40 ms is `0.04`).

## Controls

| | |
|---|---|
| Lanes | <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> |
| Touch | press the lower half of a lane; multi-touch for chords |
| Pause | <kbd>Esc</kbd> or the button top-right |
| Speed | the `1X` button, bottom-right |
| Undo while recording | <kbd>Backspace</kbd> |

## Files

```
game/
├── index.html                    the unified game — Lobby, then real gameplay
├── lobby.html                    the Lobby alone, with a mock gameplay panel
├── build.mjs                     `node build.mjs` → dist/piano-highway.html (game+editor, no lobby)
├── build-lobby.mjs               `node build-lobby.mjs` → dist/lobby-standalone.html
├── build-unified.mjs             `node build-unified.mjs` → dist/piano-classics-unified.html (everything)
├── game_data.json                composers + songs, drives the Lobby
├── css/
│   ├── lobby.css
│   └── style.css
├── js/
│   ├── lobby/
│   │   ├── data.js               fetch + validate game_data.json
│   │   ├── screens.js            DOM rendering for all four lobby screens
│   │   └── app.js                lobby state, navigation, the Play handoff
│   ├── integration.js            the only file that knows both halves exist
│   ├── config.js                 engine constants, key layouts, judgment windows
│   ├── chart.js                  the JSON format: parse, validate, serialise
│   ├── demo-chart.js             the demo chart as a module, so it works offline
│   ├── audio.js                  Conductor — AudioContext clock + file loading
│   ├── render.js                 3D projection, wood texture, notes, hold bodies
│   ├── input.js                  keyboard + multi-touch, unified
│   ├── recorder.js               tap-to-mark charting: raw capture, handed to the editor
│   ├── editor.js                 the piano-roll editor: waveform, drag/resize/delete, undo
│   ├── game.js                   state machine, judging, scoring, the frame loop
│   └── main.js                   boot and autoload
├── charts/
│   ├── demo-alla-hornpipe.json   168 notes, 20 holds — Handel
│   ├── example-annotated.json    every feature of the format in 22 notes
│   └── template.json             empty, ready to fill in
└── assets/
    ├── audio/                    put your .mp3 / .ogg here
    └── portraits/*.svg           generated placeholder composer portraits
```

## How it works

The highway is a flat plane under a one-point camera, so a single number drives
everything:

```
scale = FOCAL / (FOCAL + z)      // 1 at the hit line, → 0 at the vanishing point
y     = horizonY + trackH * scale
x     = centreX  + laneCentreAtHitLine * scale
```

with `z = (note.time - songTime) * Z_PER_SEC * speed`. Motion is constant
velocity in 3D, so the acceleration you see is real perspective. Judging
compares timestamps and never touches position, which is why changing the speed
multiplier can't change the difficulty.

Hold bodies can't be straight quads, because scale is hyperbolic in `z`. They're
subdivided into 26 segments sampled evenly in *scale* space, which spaces the
vertices evenly on screen and stays smooth even when a note stretches to the
horizon.

Input is one code path. Every source emits an id — `"k:2"` for a key, `"p:7"`
for a pointer — and a lane counts as down while at least one id sits on it, so
a second finger can't double-trigger and chords across lanes just work.

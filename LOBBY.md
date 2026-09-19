# The Lobby

The composer/song browser — Main Menu → Song Selection → Biography /
Pre-Play — that sits in front of the gameplay. It's a separate,
self-contained module: its own stylesheet (`css/lobby.css`), its own JS
(`js/lobby/`), and its own data file (`game_data.json`). Nothing in it
imports from or depends on `game.js`, `editor.js`, or any other gameplay
file — the only thing connecting the two is `js/integration.js` (see
"Hooking up the real gameplay" below).

Two ways to open it:
- **`index.html`** — the real, unified page. The Lobby is the front door;
  pressing Play loads that song into the actual 3D gameplay.
- **`lobby.html`** — the same Lobby alone, for working on it in isolation.
  Pressing Play here shows a placeholder "gameplay" panel instead, since
  there's no gameplay module on this page to hand off to.

## Screens

1. **Main Menu** — a horizontally-scrolling shelf of composer cards.
2. **Song Selection** — the chosen composer's portrait and vitals on the
   left; their pieces, with difficulty and your best score, on the right.
   An **(i)** button leads to their biography.
3. **Biography** — a bigger portrait and the full write-up.
4. **Pre-Play** — the chosen song's title, your score, and the Play button.

Back always returns one level (Song Selection is the hub both Biography and
Pre-Play return to). All four screens exist in the DOM at once and cross-fade
via CSS classes (`.is-active`, `.enter-forward` / `.enter-back`) — see
`showScreen()` in `js/lobby/screens.js`.

A quiet **Load your own song** link sits in the corner of every lobby
screen (`#customChartLink`), reaching the gameplay engine's own setup
screen — upload your own audio and chart, record one by ear, or open the
piano-roll editor. That screen has a matching **Back to composers** link
(`#backToLobbyBtn`) the other way. Both are wired in `js/integration.js`,
not in the lobby's own code.

## `game_data.json`

The root of the file is the array of composers itself:

```jsonc
[
  {
    "id": "bach",
    "name": "Johann Sebastian Bach",
    "lifespan": "1685 - 1750",
    "era": "Baroque",
    "origin": "Eisenach, Germany",
    "portraitUrl": "assets/portraits/bach.svg",
    "biography": "Bach spent most of his working life as a church organist…",
    "songs": [
      {
        "id": "bach-minuet-g",
        "title": "Minuet in G Major",
        "difficulty": "EASY",
        "myScore": 812340,
        "audioUrl": "assets/audio/bach-minuet-g.mp3",
        "chartUrl": "charts/bach-minuet-g.json"
      }
    ]
  }
]
```

| Field | Notes |
|---|---|
| `difficulty` | `EASY` \| `NORMAL` \| `HARD` \| `MASTER` — anything else is normalized to `NORMAL`. |
| `myScore` | `0` renders as "Not played yet" / "Not yet played". Anything higher is formatted with `toLocaleString()`. |
| `portraitUrl` | Any image URL. If it 404s, a generated initials placeholder is swapped in automatically — see `placeholderPortrait()` in `screens.js`. |
| `chartUrl` / `audioUrl` | Passed straight through to the Play handoff, in exactly the shape `game.loadChartFromURL()` / `game.conductor.loadURL()` expect. |

`js/lobby/data.js` validates the shape on load — a missing `id`, a
non-array `songs`, or a fetch/HTTP failure all produce a specific message
in the on-screen error state (with a **Try again** button) rather than a
blank page or a console-only crash.

## Hooking up the real gameplay

`index.html` already does this — it's the unified page, and `js/integration.js`
is the wiring. This section is for anyone reusing the lobby somewhere else,
or wanting to understand what that file does.

Pressing Play does two things, and a real integration only needs to use
one of them:

```js
// Option A — event
document.addEventListener('lobby:play', (e) => {
  const { composer, song } = e.detail;
  // …
});

// Option B — plain callback
window.onLobbyPlay = ({ composer, song }) => {
  // …
};
```

`js/integration.js` uses Option A:

```js
document.addEventListener("lobby:play", async (e) => {
  const { song } = e.detail;
  hideLobby();
  const loaded = await window.game.loadChartFromURL(song.chartUrl);
  if (!loaded) return;   // game.js already shows why in #chartReport
  try { await window.game.conductor.loadURL(song.audioUrl); }
  catch (err) { console.warn("Falling back to the built-in harpsichord:", err); }
  window.game.startRun();
});
```

It also listens the other way — `game.js`'s `toMenu()` dispatches a
cancelable `game:exit` instead of unconditionally showing its own setup
screen, and `integration.js` claims it to show the lobby instead:

```js
document.addEventListener("game:exit", (e) => {
  e.preventDefault();
  showLobby();
});
```

Both listeners, plus the two quiet links between the lobby and the game's
own setup screen (**Load your own song** / **Back to composers**), live in
that one file. Delete `js/integration.js` and its `<script>` tag in
`index.html`, and each half degrades gracefully on its own: the lobby's
Play button falls back to its `MOCK GAMEPLAY HANDOFF` panel (it checks for
`window.game` and only shows the mock when that's absent), and `game.js`'s
`toMenu()` falls back to showing `#startScreen` (since nothing claimed
`game:exit`). Nothing in `js/lobby/*` or `js/game.js` needs to change either
way — that's the point of putting the wiring in its own file.

### Reusing the lobby somewhere else

To drop this lobby in front of a *different* gameplay module:

1. Copy `css/lobby.css`, `js/lobby/`, and the `<div id="lobby-root">…</div>`
   block from `lobby.html` into your page (a sibling of your canvas, not
   inside it).
2. Write your own version of `js/integration.js` — the two listeners above
   are the whole contract.

`#lobby-root` is `position: fixed; inset: 0;` with its own opaque
background, so it fully covers whatever's underneath until you hide it.

## Files

```
lobby.html                    the Lobby alone, with the mock gameplay panel
index.html                    the same Lobby markup, wired to real gameplay
                               (marked off with <!-- LOBBY:START/END --> so
                               build.mjs can strip it for the game-only bundle)
css/lobby.css                 theme, layout, transitions (self-contained)
game_data.json                composer + song data
assets/portraits/*.svg        generated placeholder portraits
js/
  integration.js              the only file that knows the lobby and game.js both exist
  lobby/
    data.js                   fetch + validate game_data.json
    screens.js                DOM rendering for all four screens + transitions
    app.js                    lobby state, navigation wiring, the Play handoff
```

Two build scripts produce standalone, dependency-free copies:
`node build.mjs` → `dist/piano-highway.html` (game + editor, no lobby —
strips everything between the `LOBBY:START`/`END` markers in `index.html`
first) and `node build-lobby.mjs` → `dist/lobby-standalone.html` (the lobby
alone, `game_data.json` and every portrait inlined as `data:` URIs, so it
runs from a double-click with no server and no `fetch()`).

## Accessibility & input

Every clickable thing is a real `<button>` — composer cards, song rows, the
info/back/play buttons — so Tab and Enter/Space work without extra code.
`Escape` also steps back a screen. Touch works through the same click
handlers; the composer shelf scrolls natively (`overflow-x: auto` with
`scroll-snap`), and the previous/next shelf arrows only render on
pointer-fine, hover-capable devices (`@media (hover: hover) and
(pointer: fine)`) since a touchscreen doesn't need them.

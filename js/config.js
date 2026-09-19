/* =========================================================================
 *  CONFIG  (js/config.js)
 *  -------------------------------------------------------------------------
 *  Engine constants. Anything that belongs to a *song* lives in the chart
 *  JSON instead — see js/chart.js.
 * ======================================================================= */
export const CONFIG = {
  laneCount: 6,
  keys: ["s", "d", "f", "j", "k", "l"],

  /* ---- 3D camera ------------------------------------------------------
   * The highway is a flat plane. A point at track-depth z projects with
   * scale = FOCAL / (FOCAL + z).  scale === 1 at the hit line, → 0 at the
   * vanishing point. Screen Y and lane X are both just that scale applied
   * to their hit-line values, which is exactly correct one-point
   * perspective for a ground plane. */
  FOCAL: 3.4,
  Z_PER_SEC: 7.0,      // track units travelled per second at 1X
  Z_FADE: 8.5,         // notes start fading in here
  Z_CULL: 14.0,        // nothing is drawn beyond here (scale ≈ 0.19)
  Z_BEHIND: -0.75,     // notes are dropped once this far past the camera
  NOTE_DEPTH: 0.32,    // physical thickness of a tap note, in z units

  /* ---- screen layout (fractions of canvas height/width) ---- */
  horizonRatio: 0.15,
  hitLineRatio: 0.80,
  trackHalfRatio: 0.44,

  /* ---- judgment windows, in seconds ---- */
  W_MARVELOUS: 0.045,
  W_GREAT: 0.090,
  W_GOOD: 0.140,
  W_MISS: 0.185,
  W_RELEASE: 0.160,    // how early a hold may be released and still count
  MIN_HOLD: 0.18,      // shortest press that authoring tools treat as a hold, not a tap

  /* ---- set from the loaded chart ---- */
  TARGET_SCORE: 950000,
  MAX_SCORE: 1000000,
};

/* Which physical keys map to which lane, per lane count. Lane 0 is always
   leftmost. " " is the spacebar, used as the centre lane in odd layouts. */
export const KEY_LAYOUTS = {
  4: ["d", "f", "j", "k"],
  5: ["d", "f", " ", "j", "k"],
  6: ["s", "d", "f", "j", "k", "l"],
  7: ["s", "d", "f", " ", "j", "k", "l"],
  8: ["a", "s", "d", "f", "j", "k", "l", ";"],
};

/** Switch layouts. Callers must then re-run renderer.resize() and
 *  input.rebuild(), because both cache per-lane arrays. */
export function setLaneCount(n) {
  CONFIG.laneCount = n;
  CONFIG.keys = KEY_LAYOUTS[n] || KEY_LAYOUTS[6];
}

/** What to print on a key cap. */
export const keyLabel = (k) => (k === " " ? "\u2423" : k.toUpperCase());

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3];
export const JUDGMENTS = {
  MARVELOUS: { label: "MARVELOUS", weight: 1.00, color: "#f7e7a8" },
  GREAT:     { label: "GREAT",     weight: 0.72, color: "#7fe3c4" },
  GOOD:      { label: "GOOD",      weight: 0.38, color: "#9db4e8" },
  MISS:      { label: "MISS",      weight: 0.00, color: "#d1616e" },
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** True while the person is typing somewhere — title fields, BPM boxes, the
 *  chart-recorder metadata, etc. Every global keyboard shortcut in the app
 *  (lane keys, Escape, Delete, undo) checks this first, or a "d" typed into
 *  a song-title field would be swallowed as a lane press. */
export function isTypingInField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

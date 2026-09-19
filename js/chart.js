import { CONFIG, clamp } from "./config.js";

/* =========================================================================
 *  CHART  (js/chart.js)
 *  -------------------------------------------------------------------------
 *  Reads a .json chart file, checks it, and turns it into the runtime note
 *  objects the game plays. Nothing else in the codebase knows what a chart
 *  file looks like — if you want to change the format, change it here.
 *
 *  ── THE FORMAT ──────────────────────────────────────────────────────────
 *  {
 *    "format": "piano-highway-chart",
 *    "version": 1,
 *
 *    "song": {
 *      "title":  "Alla Hornpipe",
 *      "artist": "G. F. Handel",
 *      "audio":  "assets/audio/my-song.mp3",   // path, relative to index.html
 *      "offset": 0                             // see below
 *    },
 *
 *    "chart": {
 *      "difficulty":  "MASTER",
 *      "level":       14,
 *      "charter":     "your name",
 *      "lanes":       6,        // 4–8; 6 is the S D F J K L layout
 *      "scrollSpeed": 1,        // starting speed multiplier
 *      "targetScore": 950000,
 *      "bpm":         116       // only needed if you write notes in beats
 *    },
 *
 *    "notes": [
 *      { "t": 4.138, "lane": 2 },              // a tap at 4.138 s in lane 2
 *      { "t": 4.138, "lane": 3 },              // same t = a CHORD with the above
 *      { "t": 8.793, "lane": 2, "d": 0.776 }   // a HOLD: press at t, let go at t+d
 *    ]
 *  }
 *
 *  ── THE THREE FIELDS THAT MATTER ────────────────────────────────────────
 *    t     the second in the song when the note must be struck (a decimal).
 *    lane  0 = leftmost … lanes-1 = rightmost. With 6 lanes: S D F J K L.
 *    d     how long the note is held, in seconds. Leave it out for a tap.
 *
 *  A CHORD is just two or more notes sharing the same t on different lanes.
 *  There is no separate "chord" type — you never need one.
 *
 *  ── SHORTHAND ───────────────────────────────────────────────────────────
 *  Typing hundreds of objects gets old, so an array works too:
 *      [4.138, 2]            same as { "t": 4.138, "lane": 2 }
 *      [8.793, 2, 0.776]     same as { "t": 8.793, "lane": 2, "d": 0.776 }
 *  You can mix both styles in the same file.
 *
 *  ── BEATS INSTEAD OF SECONDS ────────────────────────────────────────────
 *  If you'd rather count beats, set chart.bpm and use "b" / "db":
 *      { "b": 16,   "lane": 2 }             // beat 16
 *      { "b": 19.5, "lane": 4, "db": 3 }    // beat 19.5, held for 3 beats
 *  Seconds and beats can coexist in one file. beat 0 = second 0.
 *
 *  ── OFFSET ──────────────────────────────────────────────────────────────
 *  song.offset shifts every note in the chart, in seconds. If your notes
 *  consistently land early, raise it; if late, go negative. Start at 0 and
 *  adjust in ±0.02 steps. Headphones and Bluetooth need different values,
 *  so the game also lets you nudge it live from the pause screen.
 * ======================================================================= */

export const CHART_FORMAT = "piano-highway-chart";
export const CHART_VERSION = 1;

/** A blank chart, ready to be filled in. Also written to charts/template.json */
export const CHART_TEMPLATE = {
  format: CHART_FORMAT,
  version: CHART_VERSION,
  song: { title: "Untitled", artist: "", audio: "assets/audio/my-song.mp3", offset: 0 },
  chart: { difficulty: "MASTER", level: 1, charter: "", lanes: 6, scrollSpeed: 1, targetScore: 950000, bpm: 0 },
  notes: [],
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Validate and normalise a parsed JSON chart.
 * Never throws on bad note data — it collects problems so you can fix the
 * file, and returns the notes that were usable.
 *
 * @returns {{ song, chart, notes, errors: string[], warnings: string[] }}
 */
export function parseChart(raw) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== "object") {
    return { ...CHART_TEMPLATE, notes: [], errors: ["The file isn't a JSON object."], warnings };
  }
  if (raw.format && raw.format !== CHART_FORMAT) {
    warnings.push(`format is "${raw.format}", expected "${CHART_FORMAT}". Reading it anyway.`);
  }
  if (isNum(raw.version) && raw.version > CHART_VERSION) {
    warnings.push(`This chart is version ${raw.version}; this build understands ${CHART_VERSION}.`);
  }

  /* ---- header ---- */
  const song = { ...CHART_TEMPLATE.song, ...(raw.song || {}) };
  const meta = { ...CHART_TEMPLATE.chart, ...(raw.chart || {}) };

  song.offset = isNum(song.offset) ? song.offset : 0;
  meta.lanes = clamp(Math.round(isNum(meta.lanes) ? meta.lanes : 6), 4, 8);
  meta.scrollSpeed = isNum(meta.scrollSpeed) ? meta.scrollSpeed : 1;
  meta.targetScore = isNum(meta.targetScore) && meta.targetScore > 0 ? meta.targetScore : 950000;
  meta.bpm = isNum(meta.bpm) && meta.bpm > 0 ? meta.bpm : 0;

  if (raw.chart && raw.chart.lanes !== undefined && meta.lanes !== raw.chart.lanes) {
    warnings.push(`chart.lanes must be 4–8; using ${meta.lanes}.`);
  }

  /* ---- notes ---- */
  if (!Array.isArray(raw.notes)) {
    errors.push("notes must be an array.");
    return { song, chart: meta, notes: [], errors, warnings };
  }

  const secPerBeat = meta.bpm ? 60 / meta.bpm : 0;
  const parsed = [];

  raw.notes.forEach((entry, i) => {
    const where = `notes[${i}]`;
    let t, lane, d;

    if (Array.isArray(entry)) {
      [t, lane, d] = entry;                       // [t, lane] or [t, lane, d]
    } else if (entry && typeof entry === "object") {
      lane = entry.lane;
      if (isNum(entry.t)) t = entry.t;
      else if (isNum(entry.b)) {
        if (!secPerBeat) { errors.push(`${where} uses "b" but chart.bpm isn't set.`); return; }
        t = entry.b * secPerBeat;
      }
      if (isNum(entry.d)) d = entry.d;
      else if (isNum(entry.db)) {
        if (!secPerBeat) { errors.push(`${where} uses "db" but chart.bpm isn't set.`); return; }
        d = entry.db * secPerBeat;
      }
    } else {
      errors.push(`${where} must be an object or an array.`);
      return;
    }

    if (!isNum(t)) { errors.push(`${where} is missing a numeric "t" (or "b").`); return; }
    if (t < 0) { errors.push(`${where} has a negative time (${t}).`); return; }
    if (!Number.isInteger(lane)) { errors.push(`${where} needs an integer "lane".`); return; }
    if (lane < 0 || lane >= meta.lanes) {
      errors.push(`${where} is on lane ${lane}; this chart has lanes 0–${meta.lanes - 1}.`);
      return;
    }
    if (d !== undefined && !isNum(d)) { errors.push(`${where} has a non-numeric "d".`); return; }
    if (isNum(d) && d < 0) { errors.push(`${where} has a negative duration.`); return; }

    /* A hold shorter than one judgment window is impossible to play as a
       hold, so treat it as the tap the charter almost certainly meant. */
    if (isNum(d) && d > 0 && d < CONFIG.W_GOOD) {
      warnings.push(`${where} is only ${d.toFixed(3)}s long — too short to hold, turned into a tap.`);
      d = 0;
    }

    parsed.push({
      lane,
      time: t + song.offset,
      dur: isNum(d) ? d : 0,
    });
  });

  /* Charters rarely write notes in order; sort so the engine's early-exit
     scans are valid. Chords keep a stable lane order. */
  parsed.sort((a, b) => a.time - b.time || a.lane - b.lane);

  /* ---- overlap check: one lane can only hold one note at a time ---- */
  const lastEnd = new Array(meta.lanes).fill(-Infinity);
  const lastIdx = new Array(meta.lanes).fill(-1);
  parsed.forEach((n, i) => {
    const end = n.time + n.dur;
    if (n.time < lastEnd[n.lane] - 1e-6) {
      errors.push(
        `Lane ${n.lane}: the note at ${n.time.toFixed(3)}s starts before the one at ` +
        `${parsed[lastIdx[n.lane]].time.toFixed(3)}s has finished.`
      );
    } else if (n.time - lastEnd[n.lane] < 0.04 && lastIdx[n.lane] !== -1) {
      warnings.push(`Lane ${n.lane}: two notes are only ${((n.time - lastEnd[n.lane]) * 1000).toFixed(0)}ms apart at ${n.time.toFixed(3)}s.`);
    }
    lastEnd[n.lane] = end;
    lastIdx[n.lane] = i;
  });

  if (!parsed.length) errors.push("The chart has no playable notes.");

  return { song, chart: meta, notes: parsed, errors, warnings };
}

/** Turn parsed notes into fresh runtime objects. Call this on every retry. */
export function instantiate(notes) {
  return notes.map((n, i) => ({
    id: i,
    lane: n.lane,
    time: n.time,
    dur: n.dur,
    end: n.time + n.dur,
    type: n.dur > 0 ? "hold" : "tap",
    state: "pending",   // pending → held → done | missed
    headJudged: false,
    flash: 0,           // 0..1 head-hit glow
  }));
}

/** Total judgment events: a tap scores once, a hold scores head + release. */
export const countJudgments = (notes) =>
  notes.reduce((s, n) => s + (n.dur > 0 ? 2 : 1), 0);

/** Fetch a chart over http(s). Needs a server — file:// will be blocked. */
export async function loadChartURL(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Chart fetch failed: ${res.status} ${url}`);
  return parseChart(await res.json());
}

/** Read a chart from an <input type="file"> selection. */
export async function loadChartFile(file) {
  return parseChart(JSON.parse(await file.text()));
}

/**
 * Serialise notes back out to the file format, using the compact array
 * shorthand. This is what the recorder's export button writes.
 */
export function serializeChart({ song, chart, notes }) {
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    format: CHART_FORMAT,
    version: CHART_VERSION,
    song: { ...song, offset: round(song.offset || 0) },
    chart: { ...chart },
    notes: notes
      .slice()
      .sort((a, b) => a.time - b.time || a.lane - b.lane)
      .map((n) => {
        /* undo the offset so the file stays independent of it */
        const t = round(n.time - (song.offset || 0));
        return n.dur > 0 ? [t, n.lane, round(n.dur)] : [t, n.lane];
      }),
  };
}

/** Pretty-print with one note per line — diffable and hand-editable. */
export function stringifyChart(obj) {
  const notes = obj.notes.map((n) => "    " + JSON.stringify(n)).join(",\n");
  const head = { ...obj, notes: "__NOTES__" };
  return JSON.stringify(head, null, 2).replace('"__NOTES__"', `[\n${notes}\n  ]`);
}

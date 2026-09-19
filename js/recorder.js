import { CONFIG, clamp } from "./config.js";
import { serializeChart, stringifyChart } from "./chart.js";

/* =========================================================================
 *  RECORDER  (js/recorder.js)
 *  -------------------------------------------------------------------------
 *  Marking hundreds of timestamps by ear in a text editor is miserable, so
 *  this plays your audio and records what you press. Tap a lane → a tap
 *  note. Hold a lane → a hold note of exactly that length. Stop, and it
 *  hands the notes to the Piano Roll editor (js/editor.js) for cleanup —
 *  this pass only needs to be close, not perfect.
 *
 *  It records the *press* time straight from the AudioContext clock, so it
 *  is as accurate as your own timing — which is why the quantiser below
 *  matters more than you'd think.
 * ======================================================================= */


export class Recorder {
  /**
   * @param {Conductor} conductor  supplies the song clock
   */
  constructor(conductor) {
    this.conductor = conductor;
    this.active = false;
    this.notes = [];              // { lane, time, dur }
    this.open = new Map();        // lane → press time, for notes in progress
    this.bpm = 0;                 // 0 = no quantising
    this.gridOffset = 0;          // seconds; where beat 0 sits in the audio
    this.division = 4;            // snap to 1/4 of a beat (a 16th note)
    this.onChange = () => {};
  }

  start() {
    this.active = true;
    this.notes = [];
    this.open.clear();
    this.onChange(this);
  }

  stop() {
    /* close anything still held at the moment you hit stop */
    const t = this.conductor.time;
    for (const lane of [...this.open.keys()]) this.release(lane, t);
    this.active = false;
    this.onChange(this);
  }

  press(lane) {
    if (!this.active) return;
    this.open.set(lane, this.conductor.time);
  }

  release(lane, atTime) {
    if (!this.active || !this.open.has(lane)) return;
    const t0 = this.open.get(lane);
    this.open.delete(lane);
    const t1 = atTime !== undefined ? atTime : this.conductor.time;
    const held = Math.max(0, t1 - t0);

    const time = this.snap(t0);
    let dur = held < CONFIG.MIN_HOLD ? 0 : this.snap(t0 + held) - time;
    if (dur > 0 && dur < CONFIG.MIN_HOLD) dur = 0;   // snapping collapsed it

    this.notes.push({ lane, time: Math.max(0, time), dur: Math.max(0, dur) });
    this.onChange(this);
  }

  /** Remove the most recent note — bound to Backspace while recording. */
  undo() {
    this.notes.pop();
    this.onChange(this);
  }

  /**
   * Pull a time onto the beat grid. Human taps scatter by 20–50 ms; a
   * quantised chart feels far tighter and is much easier to hand-edit
   * afterwards. With bpm = 0 the raw time is kept.
   */
  snap(t) {
    if (!this.bpm) return t;
    const step = 60 / this.bpm / this.division;
    return Math.round((t - this.gridOffset) / step) * step + this.gridOffset;
  }

  get count() { return this.notes.length; }
  get holdCount() { return this.notes.filter((n) => n.dur > 0).length; }

  /** Build the chart object, ready to be stringified and downloaded. */
  toChart({ title = "Untitled", artist = "", audio = "assets/audio/my-song.mp3",
            difficulty = "MASTER", level = 1, charter = "" } = {}) {
    return serializeChart({
      song: { title, artist, audio, offset: 0 },
      chart: {
        difficulty, level, charter,
        lanes: CONFIG.laneCount,
        scrollSpeed: 1,
        targetScore: 950000,
        bpm: this.bpm || 0,
      },
      notes: this.notes,
    });
  }

  /** Trigger a browser download of the chart as a .json file. */
  download(meta) {
    const chart = this.toChart(meta);
    const text = stringifyChart(chart);
    const name = (meta && meta.title ? meta.title : "chart")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chart";
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return text;
  }
}

/**
 * Estimate BPM from the gaps between recorded taps. Rough, but good enough
 * to pre-fill the quantiser field so you aren't guessing from scratch.
 */
export function guessBPM(notes) {
  if (notes.length < 8) return 0;
  const times = notes.map((n) => n.time).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < times.length; i++) {
    const g = times[i] - times[i - 1];
    if (g > 0.08 && g < 2) gaps.push(g);
  }
  if (gaps.length < 6) return 0;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  let bpm = 60 / median;
  while (bpm < 70) bpm *= 2;          // fold into a musical range
  while (bpm > 190) bpm /= 2;
  return clamp(Math.round(bpm), 40, 300);
}

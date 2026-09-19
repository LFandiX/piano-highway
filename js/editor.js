import { CONFIG, clamp, isTypingInField } from "./config.js";

/* =========================================================================
 *  EDITOR  (js/editor.js)
 *  -------------------------------------------------------------------------
 *  A small MIDI-editor-style piano roll, scoped to exactly the game's lanes.
 *  There's no separate "draw" or "select" tool — the cursor figures out what
 *  you mean from where you press:
 *
 *    empty space, click        → add a tap
 *    empty space, drag         → add a hold spanning the drag
 *    a note's body             → select it; drag to move (time + lane)
 *    a note's left/right edge  → drag to resize (cursor becomes ↔)
 *    right-click a note        → delete it immediately
 *    Delete / Backspace        → delete the current selection
 *    Shift + drag empty space  → rubber-band select several notes
 *    arrow keys                → nudge the selection by one grid step
 *    Ctrl/Cmd + Z / Shift+Z    → undo / redo
 *    space                     → play / pause
 *    wheel                     → scroll; Ctrl/Cmd + wheel → zoom
 *
 *  The editor never touches game state or the chart file format — it just
 *  holds a working array of { lane, time, dur } and hands it back through
 *  getNotes(). js/game.js wraps that with chart.js's serializeChart() to
 *  save or play it.
 * ======================================================================= */

const EDGE_PX = 9;            // resize hit-zone at each end of a note
const CLICK_SLOP = 4;         // pointer movement under this = "didn't drag"
const MIN_LANE_H = 46;
const RULER_H = 26;
const WAVE_H = 46;
const GUTTER_W = 54;

const COLOR = {
  bg: "#100a06",
  gutter: "#1a1108",
  rowA: "rgba(255,246,225,.025)",
  rowB: "rgba(255,246,225,.05)",
  gridBeat: "rgba(255,246,225,.08)",
  gridBar: "rgba(255,246,225,.22)",
  wave: "rgba(240,220,154,.55)",
  waveBg: "rgba(0,0,0,.35)",
  playhead: "#f7e7a8",
  tap: "#f6f1e3",
  tapDim: "#a89a7c",
  hold: "rgba(255,238,196,.85)",
  holdCore: "rgba(255,255,255,.9)",
  selected: "#7fe3c4",
  overlap: "#d1616e",
  marquee: "rgba(127,227,196,.18)",
  marqueeEdge: "rgba(127,227,196,.7)",
  label: "#c9a227",
  labelDim: "rgba(201,162,39,.45)",
};

let uid = 1;

export class PianoRollEditor {
  /** @param {HTMLCanvasElement} canvas
   *  @param {Conductor} conductor  the same clock/audio the game plays with */
  constructor(canvas, conductor) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.conductor = conductor;

    this.notes = [];              // working set: { id, lane, time, dur }
    this.selected = new Set();    // ids
    this.laneCount = CONFIG.laneCount;

    this.bpm = 0;
    this.snap = true;
    this.division = 4;

    this.pxPerSec = 130;
    this.scrollX = 0;             // seconds
    this.cursorTime = 0;          // paused-position playhead
    this.playing = false;
    this.tickEnabled = true;
    this._tickCursor = 0;

    this.peaks = null;            // waveform, see buildPeaks()
    this.duration = 0;

    this.history = [];
    this.future = [];

    this.drag = null;             // active pointer interaction, or null
    this.hover = null;            // { note, zone } under the pointer, idle
    this.active = false;          // is this screen currently shown?
    this._raf = null;

    this.onChange = () => {};     // (editor) → update note-count / overlap UI
    this.onTime = () => {};       // (seconds) → update the clock readout

    this._bindEvents();
    this.resize();
    this._pushHistory(true);
  }

  /* =====================================================================
   *  LOADING / EXPORTING
   * =================================================================== */
  /** @param {{lane,time,dur}[]} notes  @param {number} [laneCount] */
  loadNotes(notes, laneCount) {
    if (laneCount) this.laneCount = laneCount;
    this.notes = notes.map((n) => ({ id: uid++, lane: n.lane, time: n.time, dur: n.dur || 0 }));
    this.selected.clear();
    this.history = []; this.future = [];
    this._pushHistory(true);
    this._fit();
    this.onChange(this);
  }

  /** Plain { lane, time, dur }[], sorted, ready for chart.js. */
  getNotes() {
    return this.notes
      .slice()
      .sort((a, b) => a.time - b.time || a.lane - b.lane)
      .map(({ lane, time, dur }) => ({ lane, time, dur }));
  }

  setAudioBuffer(buffer) {
    this.duration = buffer ? buffer.duration : 0;
    this.peaks = buffer ? buildPeaks(buffer) : null;
  }

  setLaneCount(n) {
    this.laneCount = n;
    for (const note of this.notes) note.lane = clamp(note.lane, 0, n - 1);
    this.resize();
  }

  /* =====================================================================
   *  LIFECYCLE
   * =================================================================== */
  start() {
    this.active = true;
    this.cursorTime = 0;
    this.resize();
    const loop = () => {
      if (!this.active) return;
      if (this.playing) {
        const t = this.conductor.time;
        this.onTime(t);
        this._autoScroll(t);
        this._tickThrough(t);
        if (this.duration && t >= this.duration) this.pause();
      }
      this.render();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.active = false;
    if (this.playing) this.pause();
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this._tickCursor = this._noteIndexAt(this.cursorTime);
    this.conductor.ensureContext();
    this.conductor.start(this.cursorTime);
  }

  pause() {
    if (!this.playing) return;
    this.cursorTime = this.conductor.time;
    this.conductor.pause();
    this.playing = false;
    this.onTime(this.cursorTime);
  }

  togglePlay() { this.playing ? this.pause() : this.play(); }

  seek(t) {
    t = clamp(t, 0, Math.max(this.duration, this._contentEnd()));
    const wasPlaying = this.playing;
    if (wasPlaying) this.conductor.pause();
    this.cursorTime = t;
    this._tickCursor = this._noteIndexAt(t);
    this.onTime(t);
    if (wasPlaying) this.conductor.start(t), (this.playing = true);
  }

  /* =====================================================================
   *  RESIZE / COORDINATES
   * =================================================================== */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 400;
    this.W = w; this.H = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.laneTop = RULER_H + WAVE_H;
    this.laneH = Math.max(MIN_LANE_H, (h - this.laneTop) / this.laneCount);
  }

  timeToX(t) { return GUTTER_W + (t - this.scrollX) * this.pxPerSec; }
  xToTime(x) { return this.scrollX + (x - GUTTER_W) / this.pxPerSec; }
  laneToY(l) { return this.laneTop + l * this.laneH; }
  yToLane(y) { return clamp(Math.floor((y - this.laneTop) / this.laneH), 0, this.laneCount - 1); }

  snapTime(t) {
    if (!this.snap || !this.bpm) return Math.max(0, t);
    const step = 60 / this.bpm / this.division;
    return Math.max(0, Math.round(t / step) * step);
  }

  /* =====================================================================
   *  HISTORY
   * =================================================================== */
  _snapshot() {
    return this.notes.map((n) => ({ id: n.id, lane: n.lane, time: n.time, dur: n.dur }));
  }
  _pushHistory(replace = false) {
    if (replace) this.history[this.history.length - 1] = this._snapshot();
    else this.history.push(this._snapshot());
    if (this.history.length > 200) this.history.shift();
    this.future = [];
    this.onChange(this);
  }
  undo() {
    if (this.history.length < 2) return;
    this.future.push(this.history.pop());
    this.notes = this.history[this.history.length - 1].map((n) => ({ ...n }));
    this.selected.clear();
    this.onChange(this);
  }
  redo() {
    if (!this.future.length) return;
    const snap = this.future.pop();
    this.history.push(snap);
    this.notes = snap.map((n) => ({ ...n }));
    this.selected.clear();
    this.onChange(this);
  }

  /* =====================================================================
   *  NOTE OPERATIONS
   * =================================================================== */
  addNote(lane, time, dur = 0) {
    const note = { id: uid++, lane: clamp(lane, 0, this.laneCount - 1), time: Math.max(0, time), dur: Math.max(0, dur) };
    this.notes.push(note);
    this._pushHistory();
    this._tick(dur > 0);
    return note;
  }

  deleteNote(id) {
    this.notes = this.notes.filter((n) => n.id !== id);
    this.selected.delete(id);
    this._pushHistory();
  }

  deleteSelected() {
    if (!this.selected.size) return;
    this.notes = this.notes.filter((n) => !this.selected.has(n.id));
    this.selected.clear();
    this._pushHistory();
  }

  nudgeSelected(dTime, dLane) {
    if (!this.selected.size) return;
    const step = this.bpm && this.snap ? 60 / this.bpm / this.division : 0.02;
    for (const n of this.notes) {
      if (!this.selected.has(n.id)) continue;
      if (dTime) n.time = Math.max(0, n.time + dTime * step);
      if (dLane) n.lane = clamp(n.lane + dLane, 0, this.laneCount - 1);
    }
    this._pushHistory();
  }

  /** ids of notes that overlap another note sharing their lane. */
  overlaps() {
    const bad = new Set();
    const byLane = Array.from({ length: this.laneCount }, () => []);
    for (const n of this.notes) byLane[n.lane].push(n);
    for (const list of byLane) {
      list.sort((a, b) => a.time - b.time);
      for (let i = 1; i < list.length; i++) {
        if (list[i].time < list[i - 1].time + list[i - 1].dur - 1e-6) {
          bad.add(list[i].id); bad.add(list[i - 1].id);
        }
      }
    }
    return bad;
  }

  /* =====================================================================
   *  HIT TESTING
   * =================================================================== */
  /** @returns {{note, zone: "body"|"left"|"right"} | null} */
  hitTest(x, y) {
    const lane = this.yToLane(y);
    if (y < this.laneTop) return null;
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      if (n.lane !== lane) continue;
      const x0 = this.timeToX(n.time);
      const x1 = this.timeToX(n.time + n.dur);
      const w = Math.max(x1 - x0, 12);
      const left = x0 - 3, right = Math.max(x1, x0 + w) + 3;
      if (x < left || x > right) continue;
      if (n.dur > 0 && x <= left + EDGE_PX) return { note: n, zone: "left" };
      if (n.dur > 0 && x >= right - EDGE_PX) return { note: n, zone: "right" };
      if (n.dur === 0 && x >= right - EDGE_PX) return { note: n, zone: "right" }; // drag-to-extend a tap
      return { note: n, zone: "body" };
    }
    return null;
  }

  _noteIndexAt(t) {
    const sorted = this.notes.slice().sort((a, b) => a.time - b.time);
    let i = 0;
    while (i < sorted.length && sorted[i].time < t) i++;
    return i;
  }

  /* =====================================================================
   *  POINTER / KEYBOARD
   * =================================================================== */
  _bindEvents() {
    const c = this.canvas;

    c.addEventListener("pointerdown", (e) => this._onDown(e));
    c.addEventListener("pointermove", (e) => this._onMove(e));
    c.addEventListener("pointerup", (e) => this._onUp(e));
    c.addEventListener("pointercancel", (e) => this._onUp(e));
    c.addEventListener("contextmenu", (e) => {
      if (!this.active) return;
      e.preventDefault();
      const hit = this.hitTest(...this._local(e));
      if (hit) { this.deleteNote(hit.note.id); this.render(); }
    });
    c.addEventListener("wheel", (e) => {
      if (!this.active) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const [x] = this._local(e);
        const before = this.xToTime(x);
        this.pxPerSec = clamp(this.pxPerSec * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 8, 1200);
        this.scrollX = before - (x - GUTTER_W) / this.pxPerSec;
      } else {
        const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / this.pxPerSec;
        this.scrollX += delta;
      }
      this.scrollX = Math.max(0, this.scrollX);
    }, { passive: false });

    window.addEventListener("keydown", (e) => this._onKey(e));
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _onDown(e) {
    if (!this.active || e.button === 2) return;
    const [x, y] = this._local(e);
    this.canvas.setPointerCapture(e.pointerId);

    if (y < RULER_H + WAVE_H) {
      const wasPlaying = this.playing;
      this.drag = { kind: "scrub", wasPlaying, x0: x, y0: y };
      this.seek(this.xToTime(Math.max(GUTTER_W, x)));
      return;
    }
    if (x < GUTTER_W) return;

    const hit = this.hitTest(x, y);

    if (hit && !e.shiftKey) {
      if (!this.selected.has(hit.note.id)) { this.selected.clear(); this.selected.add(hit.note.id); }
      const zone = hit.zone;
      this.drag = {
        kind: zone === "body" ? "move" : zone === "left" ? "resize-left" : "resize-right",
        x0: x, y0: y, moved: false,
        origin: this.notes.filter((n) => this.selected.has(n.id)).map((n) => ({ id: n.id, lane: n.lane, time: n.time, dur: n.dur })),
      };
      return;
    }

    if (hit && e.shiftKey) {
      hit.note && (this.selected.has(hit.note.id) ? this.selected.delete(hit.note.id) : this.selected.add(hit.note.id));
      this.drag = { kind: "none" };
      return;
    }

    if (e.shiftKey) {
      this.drag = { kind: "marquee", x0: x, y0: y, x1: x, y1: y, additive: true };
      return;
    }

    /* empty space: click adds a tap, drag stretches it into a hold */
    const lane = this.yToLane(y);
    const time = this.snapTime(this.xToTime(x));
    this.selected.clear();
    this.drag = { kind: "draw", lane, startTime: time, x0: x, y0: y, moved: false };
  }

  _onMove(e) {
    if (!this.active) return;
    const [x, y] = this._local(e);

    if (!this.drag) {
      this.hover = this.hitTest(x, y);
      this.canvas.style.cursor =
        y < RULER_H + WAVE_H ? "pointer" :
        this.hover?.zone === "left" || this.hover?.zone === "right" ? "ew-resize" :
        this.hover?.zone === "body" ? "grab" : "crosshair";
      return;
    }

    const moved = Math.abs(x - this.drag.x0) > CLICK_SLOP || Math.abs(y - this.drag.y0) > CLICK_SLOP;
    if (moved) this.drag.moved = true;

    switch (this.drag.kind) {
      case "scrub":
        this.seek(this.xToTime(Math.max(GUTTER_W, x)));
        break;

      case "draw": {
        const t = this.snapTime(this.xToTime(x));
        this._previewDraw = { lane: this.drag.lane, time: Math.min(this.drag.startTime, t), dur: Math.abs(t - this.drag.startTime) };
        break;
      }

      case "move": {
        const dt = this.snapTime(this.xToTime(x)) - this.snapTime(this.xToTime(this.drag.x0));
        const dLane = this.yToLane(y) - this.yToLane(this.drag.y0);
        for (const o of this.drag.origin) {
          const n = this.notes.find((n) => n.id === o.id);
          if (!n) continue;
          n.time = Math.max(0, o.time + dt);
          n.lane = clamp(o.lane + dLane, 0, this.laneCount - 1);
        }
        break;
      }

      case "resize-right": {
        const o = this.drag.origin[0];
        const n = this.notes.find((n) => n.id === o.id);
        if (n) {
          const t = this.snapTime(this.xToTime(x));
          n.dur = Math.max(0, t - o.time);
        }
        break;
      }

      case "resize-left": {
        const o = this.drag.origin[0];
        const n = this.notes.find((n) => n.id === o.id);
        if (n) {
          const t = Math.min(this.snapTime(this.xToTime(x)), o.time + o.dur - 0.02);
          n.time = Math.max(0, t);
          n.dur = Math.max(0, o.time + o.dur - n.time);
        }
        break;
      }

      case "marquee":
        this.drag.x1 = x; this.drag.y1 = y;
        break;
    }
  }

  _onUp(e) {
    if (!this.drag) return;
    const d = this.drag;

    if (d.kind === "draw") {
      if (d.moved && this._previewDraw && this._previewDraw.dur >= CONFIG.MIN_HOLD) {
        const p = this._previewDraw;
        this.addNote(p.lane, p.time, p.dur);
      } else {
        this.addNote(d.lane, d.startTime, 0);
      }
      this._previewDraw = null;
    } else if (d.kind === "move" || d.kind === "resize-left" || d.kind === "resize-right") {
      if (d.moved) {
        /* a resize that shrank a hold below the playable minimum becomes a tap */
        for (const o of d.origin) {
          const n = this.notes.find((n) => n.id === o.id);
          if (n && n.dur > 0 && n.dur < CONFIG.MIN_HOLD) n.dur = 0;
        }
        this._pushHistory();
      }
    } else if (d.kind === "marquee") {
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1);
      const y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      if (!d.additive) this.selected.clear();
      for (const n of this.notes) {
        const nx0 = this.timeToX(n.time), nx1 = this.timeToX(n.time + n.dur) + 12;
        const ny = this.laneToY(n.lane);
        if (nx1 >= x0 && nx0 <= x1 && ny + this.laneH >= y0 && ny <= y1) this.selected.add(n.id);
      }
    } else if (d.kind === "scrub") {
      /* handled live in _onDown/_onMove */
    }

    this.drag = null;
    this.canvas.releasePointerCapture?.(e.pointerId);
  }

  _onKey(e) {
    if (!this.active || isTypingInField()) return;

    if (e.code === "Space") { e.preventDefault(); this.togglePlay(); return; }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? this.redo() : this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); this.redo(); return; }

    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.deleteSelected(); return; }

    if (e.key === "ArrowLeft") { e.preventDefault(); this.nudgeSelected(-1, 0); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); this.nudgeSelected(1, 0); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); this.nudgeSelected(0, -1); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); this.nudgeSelected(0, 1); return; }

    if (e.key === "Home") { e.preventDefault(); this.scrollX = 0; return; }
    if (e.key === "End") { e.preventDefault(); this.fitToContent(); return; }
    if (e.key === "Escape") { this.selected.clear(); return; }
  }

  /* =====================================================================
   *  VIEW HELPERS
   * =================================================================== */
  _contentEnd() {
    return this.notes.reduce((m, n) => Math.max(m, n.time + n.dur), 0) + 2;
  }

  _fit() { this.fitToContent(); }

  fitToContent() {
    const end = Math.max(this.duration, this._contentEnd(), 8);
    this.scrollX = 0;
    this.pxPerSec = clamp((this.W - GUTTER_W - 24) / end, 8, 1200);
  }

  _autoScroll(t) {
    const rightEdge = this.scrollX + (this.W - GUTTER_W) / this.pxPerSec;
    if (t > rightEdge - (this.W - GUTTER_W) / this.pxPerSec * 0.12) {
      this.scrollX = t - (this.W - GUTTER_W) / this.pxPerSec * 0.22;
    } else if (t < this.scrollX) {
      this.scrollX = Math.max(0, t - 1);
    }
  }

  _tick(strong) {
    if (!this.tickEnabled) return;
    try {
      this.conductor.ensureContext();
      const ctx = this.conductor.ctx;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = strong ? 1760 : 1320;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.06);
    } catch (e) { /* audio not unlocked yet — silently skip */ }
  }

  _tickThrough(t) {
    const sorted = this.notes.slice().sort((a, b) => a.time - b.time);
    while (this._tickCursor < sorted.length && sorted[this._tickCursor].time <= t) {
      this._tick(sorted[this._tickCursor].dur > 0);
      this._tickCursor++;
    }
  }

  /* =====================================================================
   *  RENDER
   * =================================================================== */
  render() {
    const g = this.ctx, W = this.W, H = this.H;
    g.clearRect(0, 0, W, H);
    g.fillStyle = COLOR.bg;
    g.fillRect(0, 0, W, H);

    const t0 = this.scrollX, t1 = this.scrollX + (W - GUTTER_W) / this.pxPerSec;

    this._drawLaneRows(g, t0, t1);
    this._drawGrid(g, t0, t1);
    this._drawWave(g, t0, t1);
    this._drawNotes(g);
    this._drawMarquee(g);
    this._drawRuler(g, t0, t1);
    this._drawGutter(g);
    this._drawPlayhead(g);

    if (!this.notes.length && !this._previewDraw) {
      g.fillStyle = "rgba(207,198,176,.5)";
      g.font = "italic 15px 'Cormorant Garamond', Georgia, serif";
      g.textAlign = "center";
      g.fillText("Click a lane to add a note. Drag to make it a hold.", W / 2, this.laneTop + (H - this.laneTop) / 2);
    }
  }

  _drawLaneRows(g, t0, t1) {
    for (let i = 0; i < this.laneCount; i++) {
      g.fillStyle = i % 2 ? COLOR.rowB : COLOR.rowA;
      g.fillRect(GUTTER_W, this.laneToY(i), this.W - GUTTER_W, this.laneH);
    }
    g.strokeStyle = "rgba(255,246,225,.08)";
    g.lineWidth = 1;
    for (let i = 0; i <= this.laneCount; i++) {
      const y = Math.round(this.laneToY(i)) + 0.5;
      g.beginPath(); g.moveTo(GUTTER_W, y); g.lineTo(this.W, y); g.stroke();
    }
  }

  _drawGrid(g, t0, t1) {
    const bottom = this.laneToY(this.laneCount);
    if (this.bpm > 0) {
      const beat = 60 / this.bpm;
      const step = beat / this.division;
      const start = Math.floor(t0 / step) * step;
      let bar = Math.round(start / beat);
      for (let t = start; t <= t1; t += step) {
        const x = Math.round(this.timeToX(t)) + 0.5;
        const onBeat = Math.abs(t / beat - Math.round(t / beat)) < 1e-6;
        const onBar = onBeat && Math.round(t / beat) % 4 === 0;
        g.strokeStyle = onBar ? COLOR.gridBar : onBeat ? COLOR.gridBeat : "rgba(255,246,225,.045)";
        g.lineWidth = onBar ? 1.4 : 1;
        g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, bottom); g.stroke();
      }
    } else {
      const start = Math.floor(t0);
      for (let t = start; t <= t1; t += 0.5) {
        const x = Math.round(this.timeToX(t)) + 0.5;
        const whole = Math.abs(t - Math.round(t)) < 1e-6;
        g.strokeStyle = whole ? COLOR.gridBeat : "rgba(255,246,225,.045)";
        g.lineWidth = whole ? 1.2 : 1;
        g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, bottom); g.stroke();
      }
    }
  }

  _drawWave(g, t0, t1) {
    g.fillStyle = COLOR.waveBg;
    g.fillRect(GUTTER_W, RULER_H, this.W - GUTTER_W, WAVE_H);
    if (!this.peaks) {
      g.fillStyle = "rgba(207,198,176,.4)";
      g.font = "12px 'Cinzel', serif";
      g.textAlign = "left";
      g.fillText("no audio loaded", GUTTER_W + 10, RULER_H + WAVE_H / 2 + 4);
      return;
    }
    const { min, max, sps } = this.peaks;
    const midY = RULER_H + WAVE_H / 2;
    const amp = WAVE_H / 2 - 3;
    g.strokeStyle = COLOR.wave;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = GUTTER_W; x < this.W; x++) {
      const t = this.xToTime(x);
      const idx = Math.floor(t * sps);
      if (idx < 0 || idx >= min.length) continue;
      g.moveTo(x + 0.5, midY - max[idx] * amp);
      g.lineTo(x + 0.5, midY - min[idx] * amp);
    }
    g.stroke();
  }

  _drawNotes(g) {
    const overlapping = this.overlaps();
    const draw = (n, selected) => {
      const x0 = this.timeToX(n.time);
      const x1 = n.dur > 0 ? this.timeToX(n.time + n.dur) : x0 + 15;
      const y = this.laneToY(n.lane) + 5;
      const h = this.laneH - 10;
      const bad = overlapping.has(n.id);

      if (n.dur > 0) {
        const grad = g.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, COLOR.hold);
        grad.addColorStop(1, "rgba(255,246,222,.55)");
        g.fillStyle = grad;
        roundRectPath(g, x0, y, Math.max(x1 - x0, 12), h, 5);
        g.fill();
        g.strokeStyle = COLOR.holdCore;
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(x0 + 4, y + h / 2); g.lineTo(x1 - 4, y + h / 2); g.stroke();
        /* resize handles */
        g.fillStyle = "rgba(43,27,16,.55)";
        roundRectPath(g, x1 - 6, y + 2, 5, h - 4, 2); g.fill();
        roundRectPath(g, x0 + 1, y + 2, 5, h - 4, 2); g.fill();
      } else {
        g.fillStyle = bad ? COLOR.overlap : COLOR.tap;
        roundRectPath(g, x0, y, 15, h, 4);
        g.fill();
      }

      if (bad) { g.strokeStyle = COLOR.overlap; g.lineWidth = 2; roundRectPath(g, x0 - 1, y - 1, Math.max(x1 - x0, 15) + 2, h + 2, 5); g.stroke(); }
      if (selected) { g.strokeStyle = COLOR.selected; g.lineWidth = 2; roundRectPath(g, x0 - 2, y - 2, Math.max(x1 - x0, 15) + 4, h + 4, 6); g.stroke(); }
    };

    for (const n of this.notes) if (!this.selected.has(n.id)) draw(n, false);
    for (const n of this.notes) if (this.selected.has(n.id)) draw(n, true);

    if (this._previewDraw) {
      const p = this._previewDraw;
      const x0 = this.timeToX(p.time), x1 = this.timeToX(p.time + p.dur);
      const y = this.laneToY(p.lane) + 5, h = this.laneH - 10;
      g.fillStyle = "rgba(247,231,168,.55)";
      roundRectPath(g, x0, y, Math.max(x1 - x0, 15), h, 5);
      g.fill();
    }
  }

  _drawMarquee(g) {
    const d = this.drag;
    if (!d || d.kind !== "marquee") return;
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1);
    const y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    g.fillStyle = COLOR.marquee;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = COLOR.marqueeEdge;
    g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  }

  _drawRuler(g, t0, t1) {
    g.fillStyle = COLOR.gutter;
    g.fillRect(GUTTER_W, 0, this.W - GUTTER_W, RULER_H);
    g.strokeStyle = "rgba(255,246,225,.15)";
    g.beginPath(); g.moveTo(GUTTER_W, RULER_H + 0.5); g.lineTo(this.W, RULER_H + 0.5); g.stroke();

    g.fillStyle = COLOR.label;
    g.font = "10px 'Cinzel', serif";
    g.textAlign = "left";

    if (this.bpm > 0) {
      const beat = 60 / this.bpm;
      const startBar = Math.floor(t0 / beat / 4) * 4;
      for (let b = startBar; b * beat <= t1; b += 4) {
        const t = b * beat;
        if (t < t0 - beat) continue;
        const x = this.timeToX(t);
        g.fillText(String(b / 4 + 1), x + 3, 17);
      }
    } else {
      const start = Math.floor(t0);
      for (let s = start; s <= t1; s++) {
        const x = this.timeToX(s);
        g.fillText(formatClock(s), x + 3, 17);
      }
    }
  }

  _drawGutter(g) {
    g.fillStyle = COLOR.gutter;
    g.fillRect(0, 0, GUTTER_W, this.H);
    for (let i = 0; i < this.laneCount; i++) {
      const y = this.laneToY(i);
      g.fillStyle = "rgba(255,246,225,.06)";
      g.fillRect(2, y + 4, GUTTER_W - 8, this.laneH - 8);
      g.fillStyle = COLOR.label;
      g.font = "600 13px 'Cinzel', serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      const label = CONFIG.keys[i] === " " ? "\u2423" : CONFIG.keys[i].toUpperCase();
      g.fillText(label, GUTTER_W / 2, y + this.laneH / 2);
    }
    g.textBaseline = "alphabetic";
  }

  _drawPlayhead(g) {
    const t = this.playing ? this.conductor.time : this.cursorTime;
    const x = this.timeToX(t);
    if (x < GUTTER_W - 2 || x > this.W) return;
    g.strokeStyle = COLOR.playhead;
    g.lineWidth = 1.6;
    g.shadowColor = COLOR.playhead; g.shadowBlur = 6;
    g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, this.laneToY(this.laneCount)); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = COLOR.playhead;
    g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7); g.closePath(); g.fill();
  }
}

/* ---- helpers ---------------------------------------------------------- */
function roundRectPath(g, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function formatClock(s) {
  const m = Math.floor(s / 60);
  return m + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}

/**
 * Downsample an AudioBuffer into min/max peak pairs, sampled at a fixed
 * rate (independent of zoom), so drawing the waveform is just an array
 * lookup per screen pixel rather than re-scanning raw samples every frame.
 */
function buildPeaks(buffer, sps = 200) {
  const ch = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(buffer.sampleRate / sps));
  const n = Math.ceil(ch.length / step);
  const min = new Float32Array(n), max = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let lo = 1, hi = -1;
    const start = i * step, end = Math.min(ch.length, start + step);
    for (let j = start; j < end; j++) {
      const v = ch[j];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[i] = lo; max[i] = hi;
  }
  return { min, max, sps };
}

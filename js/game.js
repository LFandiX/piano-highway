import { CONFIG, SPEEDS, JUDGMENTS, clamp, setLaneCount, isTypingInField } from "./config.js";
import { Conductor } from "./audio.js";
import { Renderer } from "./render.js";
import { InputManager } from "./input.js";
import { instantiate, countJudgments, parseChart, loadChartFile, loadChartURL, serializeChart, stringifyChart } from "./chart.js";
import { Recorder, guessBPM } from "./recorder.js";
import { PianoRollEditor } from "./editor.js";

/* =========================================================================
 *  GAME  (js/game.js)
 *  -------------------------------------------------------------------------
 *  States: menu → playing ⇄ paused → done
 *          menu → recording → menu
 * ======================================================================= */
export class Game {
  constructor() {
    this.canvas = document.getElementById("game");
    this.renderer = new Renderer(this.canvas);
    this.conductor = new Conductor();
    this.recorder = new Recorder(this.conductor);
    this.editor = new PianoRollEditor(document.getElementById("editorCanvas"), this.conductor);
    this.speedIndex = SPEEDS.indexOf(1);

    this.chart = null;          // { song, chart, notes, errors, warnings }
    this.notes = [];
    this.effects = [];
    this.lanePress = new Array(CONFIG.laneCount).fill(0);
    this.state = "menu";
    this.hitPulse = 0;
    this.liveOffset = 0;        // nudged from the pause screen, on top of song.offset

    this.input = new InputManager(this.canvas, this.renderer, {
      onPress: (lane) => this.handlePress(lane),
      onRelease: (lane) => this.handleRelease(lane),
    });

    this.ui = {
      judgment: document.getElementById("judgment"),
      comboWrap: document.getElementById("comboWrap"),
      comboNum: document.getElementById("comboNum"),
      scoreBig: document.getElementById("scoreBig"),
      myScore: document.getElementById("myScore"),
      maxCombo: document.getElementById("maxCombo"),
      goalBar: document.getElementById("goalBar"),
      targetScore: document.getElementById("targetScore"),
      medals: [document.getElementById("medal1"), document.getElementById("medal2")],
      speedBtn: document.getElementById("speedBtn"),
      difficulty: document.getElementById("difficulty"),
      songArtist: document.getElementById("songArtist"),
      songTitle: document.getElementById("songTitle"),
    };

    this.bindUI();
    window.addEventListener("resize", () => { this.renderer.resize(); this.editor.resize(); });
    window.addEventListener("orientationchange", () => setTimeout(() => { this.renderer.resize(); this.editor.resize(); }, 120));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "playing") this.pause();
    });

    requestAnimationFrame(this.loop);
  }

  /* =====================================================================
   *  CHART LOADING
   * =================================================================== */

  /**
   * Apply a parsed chart. Returns false (and lists why) if it can't be
   * played, so a typo in the JSON names the offending note instead of
   * crashing the game.
   */
  loadChart(parsed) {
    const box = document.getElementById("chartReport");
    box.innerHTML = "";
    const say = (cls, msg) => {
      const li = document.createElement("li");
      li.className = cls;
      li.textContent = msg;
      box.appendChild(li);
    };
    parsed.errors.slice(0, 8).forEach((e) => say("bad", e));
    if (parsed.errors.length > 8) say("bad", `…and ${parsed.errors.length - 8} more problems.`);
    parsed.warnings.slice(0, 5).forEach((w) => say("warn", w));

    if (parsed.errors.length) {
      document.getElementById("setupPlayBtn").disabled = true;
      return false;
    }

    this.chart = parsed;
    this.liveOffset = 0;

    /* Lane layout can change per chart, and both the renderer and the input
       layer cache per-lane arrays, so both have to be rebuilt. */
    if (parsed.chart.lanes !== CONFIG.laneCount) {
      setLaneCount(parsed.chart.lanes);
      this.input.rebuild();
      this.renderer.resize();
      this.lanePress = new Array(CONFIG.laneCount).fill(0);
    }

    CONFIG.TARGET_SCORE = parsed.chart.targetScore;
    const si = SPEEDS.indexOf(parsed.chart.scrollSpeed);
    this.speedIndex = si === -1 ? SPEEDS.indexOf(1) : si;
    this.ui.speedBtn.textContent = SPEEDS[this.speedIndex] + "X";

    this.ui.songArtist.textContent = parsed.song.artist || "";
    this.ui.songTitle.textContent = parsed.song.title || "Untitled";
    this.ui.difficulty.textContent =
      (parsed.chart.difficulty || "MASTER") + (parsed.chart.level ? " " + parsed.chart.level : "");
    this.ui.targetScore.textContent = CONFIG.TARGET_SCORE.toLocaleString();

    const taps = parsed.notes.filter((n) => n.dur === 0).length;
    const holds = parsed.notes.length - taps;
    const last = parsed.notes[parsed.notes.length - 1];
    say("ok", `${parsed.notes.length} notes · ${taps} taps · ${holds} holds · ` +
              `${parsed.chart.lanes} lanes · last note at ${fmtTime(last.time + last.dur)}`);

    document.getElementById("setupPlayBtn").disabled = false;
    this.reset();
    return true;
  }

  async loadChartFromFile(file) {
    try {
      return this.loadChart(await loadChartFile(file));
    } catch (err) {
      return this.loadChart({ song: {}, chart: {}, notes: [], warnings: [],
                              errors: ["That file isn't valid JSON — " + err.message] });
    }
  }

  async loadChartFromURL(url) {
    try {
      return this.loadChart(await loadChartURL(url));
    } catch (err) {
      return this.loadChart({ song: {}, chart: {}, notes: [], warnings: [], errors: [err.message] });
    }
  }

  /* =====================================================================
   *  UI WIRING
   * =================================================================== */
  bindUI() {
    const $ = (id) => document.getElementById(id);

    /* ---- audio ---- */
    $("audioFile").onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      this._audioFileName = f.name;
      $("audioName").textContent = "decoding…";
      $("audioName").className = "slot-value";
      try {
        await this.conductor.loadFile(f);
        $("audioName").textContent = `${f.name} · ${fmtTime(this.conductor.duration)}`;
        $("audioName").className = "slot-value ok";
        if (this.chart) this.reset();
      } catch (err) {
        $("audioName").textContent = "couldn't decode that — try MP3, OGG, WAV or M4A";
        $("audioName").className = "slot-value bad";
      }
    };

    /* ---- chart ---- */
    $("chartFile").onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const okay = await this.loadChartFromFile(f);
      $("chartName").textContent = okay ? f.name : f.name + " — see below";
      $("chartName").className = "slot-value " + (okay ? "ok" : "bad");
    };

    $("demoBtn").onclick = async () => {
      const { DEMO_CHART } = await import("./demo-chart.js");
      this.loadChart(parseChart(DEMO_CHART));
      $("chartName").textContent = "built-in demo — Alla Hornpipe";
      $("chartName").className = "slot-value ok";
    };

    $("setupPlayBtn").onclick = () => this.startRun();

    /* ---- transport ---- */
    $("pauseBtn").onclick = () => {
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
      else if (this.state === "recording") this.stopRecording();
    };
    $("resumeBtn").onclick = () => this.resume();
    $("restartBtn").onclick = () => { this.reset(); this.startRun(); };
    $("quitBtn").onclick = () => this.toMenu();
    $("againBtn").onclick = () => { this.reset(); this.startRun(); };
    $("menuBtn").onclick = () => this.toMenu();

    this.ui.speedBtn.onclick = () => {
      this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
      this.ui.speedBtn.textContent = SPEEDS[this.speedIndex] + "X";
    };

    /* ---- live offset calibration ---- */
    this._showOffset = () => {
      $("offsetValue").textContent =
        (this.liveOffset >= 0 ? "+" : "") + Math.round(this.liveOffset * 1000) + " ms";
    };
    $("offsetMinus").onclick = () => { this.nudgeOffset(-0.005); this._showOffset(); };
    $("offsetPlus").onclick = () => { this.nudgeOffset(+0.005); this._showOffset(); };

    /* ---- recorder ---- */
    $("recordBtn").onclick = () => {
      if (!this.conductor.buffer) {
        $("audioName").textContent = "load an audio file first — the recorder needs something to play";
        $("audioName").className = "slot-value bad";
        return;
      }
      $("startScreen").hidden = true;
      $("recordSetup").hidden = false;
    };
    $("recCancelBtn").onclick = () => { $("recordSetup").hidden = true; $("startScreen").hidden = false; };
    $("recStartBtn").onclick = () => this.startRecording();
    $("recStopBtn").onclick = () => this.stopRecording();
    $("recUndoBtn").onclick = () => this.recorder.undo();

    this.recorder.onChange = (r) => {
      $("recCount").textContent = r.count;
      $("recHolds").textContent = r.holdCount;
    };

    /* ---- piano roll editor ---- */
    $("editBtn").onclick = () => this.openEditor();
    this.bindEditorUI();

    /* ---- keyboard shortcuts ---- */
    window.addEventListener("keydown", (e) => {
      if (isTypingInField()) return;
      if (e.key === "Escape") {
        if (this.state === "playing") this.pause();
        else if (this.state === "paused") this.resume();
        else if (this.state === "recording") this.stopRecording();
      }
      if (e.key === "Backspace" && this.state === "recording") {
        e.preventDefault();
        this.recorder.undo();
      }
    });
  }

  /**
   * Everything on the editor screen's toolbar and footer. Kept separate
   * from bindUI() only because there's a lot of it.
   */
  bindEditorUI() {
    const $ = (id) => document.getElementById(id);
    const ed = this.editor;

    $("edPlayBtn").onclick = () => ed.togglePlay();
    ed.onTime = (t) => { $("edClock").textContent = fmtTime(t); };
    ed.onChange = (e) => {
      const notes = e.notes;
      $("edCount").textContent = notes.length;
      $("edHolds").textContent = notes.filter((n) => n.dur > 0).length;
      const overlapN = e.overlaps().size;
      $("edOverlapWarn").hidden = overlapN === 0;
      $("edOverlaps").textContent = overlapN;
      $("edPlayBtn").innerHTML = e.playing ? "&#10074;&#10074;" : "&#9654;";
      $("edUndoBtn").disabled = e.history.length < 2;
      $("edRedoBtn").disabled = e.future.length === 0;
      $("edDeleteBtn").disabled = e.selected.size === 0;
    };

    $("edBpm").onchange = () => { ed.bpm = parseFloat($("edBpm").value) || 0; };
    $("edSnap").onchange = () => { ed.snap = $("edSnap").checked; };
    $("edDiv").onchange = () => { ed.division = parseInt($("edDiv").value, 10); };
    $("edTick").onchange = () => { ed.tickEnabled = $("edTick").checked; };
    $("edLanes").onchange = () => {
      const n = parseInt($("edLanes").value, 10);
      setLaneCount(n);
      this.input.rebuild();
      this.renderer.resize();
      this.lanePress = new Array(CONFIG.laneCount).fill(0);
      ed.setLaneCount(n);
    };

    $("edUndoBtn").onclick = () => ed.undo();
    $("edRedoBtn").onclick = () => ed.redo();
    $("edDeleteBtn").onclick = () => ed.deleteSelected();
    $("edFitBtn").onclick = () => ed.fitToContent();

    $("edBackBtn").onclick = () => this.closeEditor();
    $("edDownloadBtn").onclick = () => this.exportEditorChart(true);
    $("edUseBtn").onclick = () => {
      if (this.exportEditorChart(false)) this.startRun();
    };
  }

  /** Build a chart from the editor's current notes + the footer's metadata
   *  fields, either downloading it or loading it straight into the game. */
  exportEditorChart(download) {
    const $ = (id) => document.getElementById(id);
    const chart = {
      song: {
        title: $("edTitle").value || "Untitled",
        artist: $("edArtist").value || "",
        audio: this.chart?.song?.audio || "assets/audio/" + (this._audioFileName || "my-song.mp3"),
        offset: parseFloat($("edOffset").value) || 0,
      },
      chart: {
        difficulty: $("edDiff").value,
        level: this.chart?.chart?.level || 1,
        charter: this.chart?.chart?.charter || "",
        lanes: CONFIG.laneCount,
        scrollSpeed: this.chart?.chart?.scrollSpeed || 1,
        targetScore: this.chart?.chart?.targetScore || 950000,
        bpm: this.editor.bpm || 0,
      },
      notes: this.editor.getNotes(),
    };
    const built = serializeChart(chart);

    if (download) {
      const text = stringifyChart(built);
      const name = (chart.song.title || "chart").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chart";
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    }

    const okay = this.loadChart(parseChart(built));
    if (okay) {
      $("chartName").textContent = (chart.song.title || "Untitled") + " — edited in piano roll";
      $("chartName").className = "slot-value ok";
    }
    return okay;
  }

  /**
   * Open the piano roll on either the currently loaded chart (so an
   * uploaded or demo chart can be touched up) or, if none is loaded, a
   * blank canvas. `initialNotes` overrides both — that's how a freshly
   * recorded take gets handed off for cleanup.
   */
  openEditor(initialNotes) {
    const $ = (id) => document.getElementById(id);
    this.hideScreens();
    document.getElementById("recHud").hidden = true;
    if (this.state === "playing" || this.state === "paused") this.conductor.pause();
    this.input.enabled = false;
    this.input.releaseAll();
    this.state = "editing";

    const lanes = this.chart?.chart?.lanes || CONFIG.laneCount;
    if (lanes !== CONFIG.laneCount) {
      setLaneCount(lanes);
      this.input.rebuild();
      this.renderer.resize();
      this.lanePress = new Array(CONFIG.laneCount).fill(0);
    }
    $("edLanes").value = String(lanes);

    this.editor.setAudioBuffer(this.conductor.buffer);
    this.editor.bpm = this.chart?.chart?.bpm || 0;
    $("edBpm").value = this.editor.bpm || "";

    const notes = initialNotes
      ? initialNotes
      : this.chart
        ? this.chart.notes.map((n) => ({ lane: n.lane, time: n.time, dur: n.dur }))
        : [];
    this.editor.loadNotes(notes, lanes);

    $("edTitle").value = this.chart?.song?.title || "";
    $("edArtist").value = this.chart?.song?.artist || "";
    $("edDiff").value = this.chart?.chart?.difficulty || "MASTER";
    $("edOffset").value = this.chart?.song?.offset || 0;

    document.getElementById("editorScreen").hidden = false;
    this._showEditorScreen();
  }

  _showEditorScreen() {
    requestAnimationFrame(() => { this.editor.resize(); this.editor.start(); });
  }

  closeEditor() {
    this.editor.stop();
    this.state = "menu";
    document.getElementById("editorScreen").hidden = true;
    document.getElementById("startScreen").hidden = false;
  }

  /** Shift the whole chart against the audio, mid-run. */
  nudgeOffset(delta) {
    if (!this.chart) return;
    this.liveOffset += delta;
    for (const n of this.notes) { n.time += delta; n.end += delta; }
  }

  /* =====================================================================
   *  RUN LIFECYCLE
   * =================================================================== */
  reset() {
    if (!this.chart) return;
    this.notes = instantiate(this.chart.notes);
    if (this.liveOffset) {
      for (const n of this.notes) { n.time += this.liveOffset; n.end += this.liveOffset; }
    }

    this.totalJudgments = countJudgments(this.chart.notes);
    this.pointsPer = CONFIG.MAX_SCORE / this.totalJudgments;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.tally = { MARVELOUS: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    this.cursor = 0;
    this.effects.length = 0;

    /* Run to the end of the audio if there is any, so a long outro isn't
       cut off, otherwise three seconds past the final note. */
    const lastNote = this.notes[this.notes.length - 1].end + 3.0;
    this.songEnd = this.conductor.buffer
      ? Math.max(lastNote, this.conductor.duration)
      : lastNote;

    this.input.releaseAll();
    this.paintUI();
    this.ui.comboWrap.classList.remove("on");
    this.ui.judgment.style.opacity = 0;
  }

  hideScreens() {
    for (const id of ["startScreen", "pauseScreen", "resultScreen", "recordSetup", "editorScreen"]) {
      document.getElementById(id).hidden = true;
    }
  }

  startRun() {
    if (!this.chart) return;
    this.editor.stop();
    this.hideScreens();
    document.getElementById("recHud").hidden = true;
    this.conductor.ensureContext();
    this.conductor.start(0);
    this.input.enabled = true;
    this.state = "playing";
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.conductor.pause();
    this.input.enabled = false;
    this.input.releaseAll();
    this._showOffset();
    document.getElementById("pauseScreen").hidden = false;
  }

  resume() {
    if (this.state !== "paused") return;
    document.getElementById("pauseScreen").hidden = true;
    this.conductor.resume();
    this.input.enabled = true;
    this.state = "playing";
  }

  toMenu() {
    this.editor.stop();
    this.conductor.stop();
    this.input.enabled = false;
    this.input.releaseAll();
    this.state = "menu";
    this.hideScreens();
    document.getElementById("recHud").hidden = true;

    /* Cancelable, so something outside this file can claim it and show a
     * lobby instead — see js/integration.js. If nothing does, this falls
     * back to the setup screen exactly as it always has. */
    const notClaimed = document.dispatchEvent(new CustomEvent("game:exit", { cancelable: true }));
    if (notClaimed) document.getElementById("startScreen").hidden = false;

    this.reset();
  }

  finish() {
    this.state = "done";
    this.conductor.stop();
    this.input.enabled = false;
    const $ = (id) => document.getElementById(id);
    $("finalScore").textContent = Math.round(this.score).toLocaleString();
    $("tMarv").textContent = this.tally.MARVELOUS;
    $("tGreat").textContent = this.tally.GREAT;
    $("tGood").textContent = this.tally.GOOD;
    $("tMiss").textContent = this.tally.MISS;
    $("tCombo").textContent = this.maxCombo;
    $("tAcc").textContent = ((this.score / CONFIG.MAX_SCORE) * 100).toFixed(2) + "%";
    $("resultScreen").hidden = false;
  }

  /* =====================================================================
   *  RECORDING
   * =================================================================== */
  startRecording() {
    const $ = (id) => document.getElementById(id);
    const lanes = parseInt($("recLanes").value, 10);
    if (lanes !== CONFIG.laneCount) {
      setLaneCount(lanes);
      this.input.rebuild();
      this.renderer.resize();
      this.lanePress = new Array(CONFIG.laneCount).fill(0);
    }
    this.recorder.bpm = parseFloat($("recBpm").value) || 0;
    this.recorder.division = parseInt($("recDiv").value, 10) || 4;
    this.recorder.gridOffset = (parseFloat($("recGrid").value) || 0) / 1000;

    this.hideScreens();
    this.notes = [];
    this.cursor = 0;
    this.effects.length = 0;
    $("recHud").hidden = false;
    this.recorder.start();
    this.conductor.ensureContext();
    this.conductor.start(0);
    this.input.enabled = true;
    this.state = "recording";
  }

  stopRecording() {
    if (this.state !== "recording") return;
    this.recorder.stop();
    this.conductor.pause();
    this.input.enabled = false;
    this.input.releaseAll();
    this.hideScreens();
    document.getElementById("recHud").hidden = true;
    this.state = "editing";
    this.chart = null;   // this session's notes replace whatever was loaded before

    const $ = (id) => document.getElementById(id);
    const bpm = this.recorder.bpm || guessBPM(this.recorder.notes) || 0;

    this.editor.setAudioBuffer(this.conductor.buffer);
    this.editor.bpm = bpm;
    this.editor.division = this.recorder.division || 4;
    this.editor.snap = !!this.recorder.bpm;
    this.editor.loadNotes(this.recorder.notes, CONFIG.laneCount);

    $("edBpm").value = bpm || "";
    $("edDiv").value = String(this.editor.division);
    $("edSnap").checked = this.editor.snap;
    $("edLanes").value = String(CONFIG.laneCount);
    $("edTitle").value = $("recTitle").value || "";
    $("edArtist").value = $("recArtist").value || "";
    $("edDiff").value = $("recDiff").value || "MASTER";
    $("edOffset").value = 0;

    document.getElementById("editorScreen").hidden = false;
    this._showEditorScreen();
  }

  /* =====================================================================
   *  DEPTH + JUDGING
   * =================================================================== */
  get speed() { return SPEEDS[this.speedIndex]; }
  /** Track depth of an event that happens `dt` seconds from now. */
  zAt(dt) { return dt * CONFIG.Z_PER_SEC * this.speed; }

  judgeFor(delta) {
    const a = Math.abs(delta);
    if (a <= CONFIG.W_MARVELOUS) return "MARVELOUS";
    if (a <= CONFIG.W_GREAT) return "GREAT";
    if (a <= CONFIG.W_GOOD) return "GOOD";
    return null;
  }

  handlePress(lane) {
    this.lanePress[lane] = 1;

    if (this.state === "recording") {
      this.recorder.press(lane);
      this.conductor.pluck(lane, false);
      this.spawnBurst(lane, "MARVELOUS");
      this.hitPulse = 1;
      return;
    }
    if (this.state !== "playing") return;
    const t = this.conductor.time;

    /* nearest unresolved note in this lane inside the miss window */
    let best = null, bestAbs = Infinity;
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time - t > CONFIG.W_MISS) break;      // list is time-sorted
      if (n.lane !== lane || n.state !== "pending") continue;
      const a = Math.abs(n.time - t);
      if (a <= CONFIG.W_MISS && a < bestAbs) { best = n; bestAbs = a; }
    }
    if (!best) return;                             // stray press — no penalty

    const grade = this.judgeFor(best.time - t);
    if (!grade) {                                  // inside miss window, outside GOOD
      best.state = "missed";
      this.applyJudgment("MISS", lane, best.type === "hold" ? 2 : 1);
      return;
    }

    best.headJudged = true;
    best.flash = 1;
    this.applyJudgment(grade, lane, 1);
    this.conductor.pluck(lane, best.type === "hold");
    this.spawnBurst(lane, grade);
    this.hitPulse = 1;

    best.state = best.type === "hold" ? "held" : "done";
  }

  handleRelease(lane) {
    this.lanePress[lane] = 0;

    if (this.state === "recording") { this.recorder.release(lane); return; }
    if (this.state !== "playing") return;
    const t = this.conductor.time;

    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      /* a held note's head is always in the past, so we can stop early */
      if (n.time - t > 0.5) break;
      if (n.lane !== lane || n.state !== "held") continue;

      if (t >= n.end - CONFIG.W_RELEASE) {
        /* released at or after the tail — always a clean finish */
        const grade = this.judgeFor(Math.min(0, t - n.end)) || "GOOD";
        n.state = "done";
        this.applyJudgment(grade, lane, 1);
        this.spawnBurst(lane, grade);
        this.hitPulse = 1;
      } else {
        /* let go too early: the hold breaks */
        n.state = "missed";
        this.applyJudgment("MISS", lane, 1);
      }
      return;
    }
  }

  /** count = how many judgment slots this event consumes (a dropped hold = 2). */
  applyJudgment(grade, lane, count = 1) {
    const j = JUDGMENTS[grade];
    this.tally[grade] += count;
    this.score += this.pointsPer * j.weight * count;

    if (grade === "MISS") {
      this.combo = 0;
      this.ui.comboWrap.classList.remove("on");
    } else {
      this.combo += count;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.ui.comboWrap.classList.add("on");
      this.ui.comboNum.classList.remove("beat");
      void this.ui.comboNum.offsetWidth;
      this.ui.comboNum.classList.add("beat");
    }

    const el = this.ui.judgment;
    el.textContent = j.label;
    el.style.color = j.color;
    el.style.textShadow = `0 0 26px ${j.color}88, 0 2px 10px rgba(0,0,0,.9)`;
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");

    this.paintUI();
  }

  paintUI() {
    const s = Math.round(this.score);
    this.ui.scoreBig.textContent = s.toLocaleString();
    this.ui.myScore.textContent = s.toLocaleString();
    this.ui.maxCombo.textContent = this.maxCombo;
    this.ui.comboNum.textContent = this.combo;
    this.ui.goalBar.style.width = clamp((s / CONFIG.TARGET_SCORE) * 100, 0, 100) + "%";
    this.ui.medals[0].classList.toggle("spent", s < CONFIG.TARGET_SCORE * 0.42);
    this.ui.medals[1].classList.toggle("spent", s < CONFIG.TARGET_SCORE * 0.84);
  }

  spawnBurst(lane, grade) {
    const r = this.renderer;
    this.effects.push({
      x: r.cx + r.laneCx[lane], y: r.hitY,
      age: 0, life: 0.42, color: JUDGMENTS[grade].color, lane,
    });
  }

  /* =====================================================================
   *  FRAME
   * =================================================================== */
  update(dt) {
    const t = this.conductor.time;

    /* advance the cursor past everything that can no longer be interacted with */
    while (this.cursor < this.notes.length) {
      const n = this.notes[this.cursor];
      const dead = n.state === "done" || n.state === "missed";
      const gone = (n.type === "hold" ? n.end : n.time) + CONFIG.W_MISS < t;
      if (dead && gone) this.cursor++; else break;
    }

    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time - t > 4) break;

      if (n.state === "pending" && t > n.time + CONFIG.W_MISS) {
        n.state = "missed";
        this.applyJudgment("MISS", n.lane, n.type === "hold" ? 2 : 1);
      } else if (n.state === "held" && t >= n.end) {
        /* held all the way through — free the finger, award the tail */
        n.state = "done";
        this.applyJudgment("MARVELOUS", n.lane, 1);
        this.spawnBurst(n.lane, "MARVELOUS");
        this.hitPulse = 1;
      }
      if (n.flash > 0) n.flash = Math.max(0, n.flash - dt * 4);
    }

    if (t > this.songEnd) this.finish();
  }

  /** Lane glow, hit pulse and burst decay — shared by playing and recording. */
  updateCommon(dt) {
    for (let i = 0; i < CONFIG.laneCount; i++) {
      const target = this.input.isDown(i) ? 1 : 0;
      this.lanePress[i] += (target - this.lanePress[i]) * Math.min(1, dt * 18);
    }
    this.hitPulse = Math.max(0, this.hitPulse - dt * 3.4);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      this.effects[i].age += dt;
      if (this.effects[i].age >= this.effects[i].life) this.effects.splice(i, 1);
    }
  }

  updateRecording() {
    const t = this.conductor.time;
    document.getElementById("recClock").textContent = fmtTime(t);
    if (this.conductor.buffer && t >= this.conductor.duration) this.stopRecording();
  }

  draw() {
    const r = this.renderer, g = r.ctx, t = this.conductor.time;
    r.drawBackground();
    r.drawTrack();

    for (let i = 0; i < CONFIG.laneCount; i++) r.drawLanePress(i, this.lanePress[i]);

    /* Collect what's visible, then paint far → near so nearer notes
       correctly overlap the ones behind them. */
    const visible = [];
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      const zHead = this.zAt(n.time - t);
      if (zHead > CONFIG.Z_CULL) break;              // sorted: the rest are further
      const zTail = n.type === "hold" ? this.zAt(n.end - t) : zHead;
      if (zTail < CONFIG.Z_BEHIND) continue;
      if (n.state === "done" && n.type === "tap") continue;
      visible.push({ n, zHead, zTail });
    }

    /* Everything from here is clipped to the board, so a note sliding past
       the judgment line disappears cleanly under the brass instead of
       spilling over the key caps. */
    g.save();
    r.trackPath(g, 0, 1.0);
    g.clip();

    for (let i = visible.length - 1; i >= 0; i--) {
      const { n, zHead, zTail } = visible[i];
      const dead = n.state === "missed";
      const fade = clamp((CONFIG.Z_CULL - zHead) / (CONFIG.Z_CULL - CONFIG.Z_FADE), 0, 1);
      const alpha = dead ? 0.45 : fade;

      if (n.type === "hold") {
        if (n.state === "done") continue;
        const active = n.state === "held";
        /* While held, the body is consumed at the hit line: clamp the head
           to z = 0 so it visibly shortens into the brass. */
        const zn = active ? Math.max(0, zHead) : zHead;
        const zf = Math.min(zTail, CONFIG.Z_CULL);
        if (zf > zn) r.drawHoldBody(n.lane, zn, zf, { dead, active, alpha });
        if (!active && zHead > CONFIG.Z_BEHIND) {
          r.drawKeyNote(n.lane, zHead, { dead, alpha, flash: n.flash, wide: 0.44 });
        } else if (active) {
          r.drawKeyNote(n.lane, 0, { dead: false, alpha: 1, flash: 0.55, wide: 0.44 });
        }
      } else {
        r.drawKeyNote(n.lane, zHead, { dead, alpha, flash: n.flash });
      }
    }

    g.restore();

    r.drawHitLine(this.lanePress.map((v) => v > 0.5), this.hitPulse);

    /* hit bursts: a ring expanding along the hit line */
    for (const e of this.effects) {
      const k = e.age / e.life;
      const rad = r.laneW * (0.28 + k * 0.85);
      g.save();
      g.globalAlpha = (1 - k) * 0.85;
      g.strokeStyle = e.color;
      g.lineWidth = 3 * (1 - k) + 0.6;
      g.beginPath();
      g.ellipse(e.x, e.y, rad, rad * 0.30, 0, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = (1 - k) * 0.5;
      g.fillStyle = e.color;
      g.beginPath();
      g.ellipse(e.x, e.y, rad * 0.55, rad * 0.16, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  loop = (now) => {
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    if (this.state === "playing") this.update(dt);
    if (this.state === "recording") this.updateRecording();
    if (this.state === "playing" || this.state === "recording") this.updateCommon(dt);
    this.draw();
    requestAnimationFrame(this.loop);
  };
}

function fmtTime(s) {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return m + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}

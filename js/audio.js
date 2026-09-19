/* =========================================================================
 *  AUDIO  (js/audio.js)
 *  -------------------------------------------------------------------------
 *  The AudioContext clock is the single source of truth for song time — it
 *  is sample-accurate and immune to rAF jitter. It runs whether or not an
 *  actual buffer is playing, so the "no file loaded" demo uses the same
 *  timing path as a real track.
 * ======================================================================= */
export class Conductor {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.startedAt = 0;      // ctx.currentTime when the song began
    this.pausedAt = 0;       // song time captured on pause
    this.running = false;
    this.duration = 0;
    this.master = null;
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  /* ---- HOW TO LOAD AN EXTERNAL .mp3 / .ogg --------------------------
   * Served over http(s) (a local dev server is enough — file:// will be
   * blocked by CORS):
   *
   *     await conductor.loadURL("assets/audio/alla-hornpipe.ogg");
   *
   * Pick .ogg first and fall back to .mp3 for maximum browser coverage:
   *
   *     const canOgg = new Audio().canPlayType('audio/ogg; codecs="vorbis"');
   *     await conductor.loadURL(canOgg ? "song.ogg" : "song.mp3");
   * ------------------------------------------------------------------ */
  async loadURL(url) {
    this.ensureContext();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Audio fetch failed: ${res.status} ${url}`);
    return this._decode(await res.arrayBuffer());
  }

  /** Same decode path, for a File chosen through <input type="file">. */
  async loadFile(file) {
    this.ensureContext();
    return this._decode(await file.arrayBuffer());
  }

  async _decode(arrayBuffer) {
    this.buffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.duration = this.buffer.duration;
    return this.buffer;
  }

  start(fromSeconds = 0) {
    this.ensureContext();
    this.stopSource();
    if (this.buffer) {
      this.source = this.ctx.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.connect(this.master);
      this.source.start(0, Math.max(0, fromSeconds));
    }
    this.startedAt = this.ctx.currentTime - fromSeconds;
    this.running = true;
  }

  stopSource() {
    if (this.source) { try { this.source.stop(); } catch (e) {} this.source.disconnect(); this.source = null; }
  }

  pause() {
    if (!this.running) return;
    this.pausedAt = this.time;
    this.stopSource();
    this.running = false;
  }

  resume() { if (!this.running) this.start(this.pausedAt); }

  stop() { this.stopSource(); this.running = false; this.pausedAt = 0; }

  /** Current song position in seconds. */
  get time() {
    if (!this.ctx) return 0;
    return this.running ? this.ctx.currentTime - this.startedAt : this.pausedAt;
  }

  /* ---- fallback instrument -------------------------------------------
   * With no audio file loaded, each successful hit plays a plucked tone so
   * the chart is still musical. Lanes are tuned to a D-major spread, the
   * key of the Hornpipe. */
  pluck(lane, strong = false) {
    if (!this.ctx || this.buffer) return;   // real audio wins
    const freqs = [146.83, 220.0, 293.66, 369.99, 440.0, 587.33]; // D3 A3 D4 F#4 A4 D5
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(strong ? 0.26 : 0.19, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (strong ? 1.5 : 0.95));

    [1, 2, 3].forEach((h, i) => {
      const o = this.ctx.createOscillator();
      o.type = i === 0 ? "triangle" : "sine";
      o.frequency.value = freqs[lane] * h;
      const hg = this.ctx.createGain();
      hg.gain.value = [1, 0.3, 0.12][i];
      o.connect(hg); hg.connect(g);
      o.start(t); o.stop(t + 1.6);
    });
  }
}



import { CONFIG, clamp, isTypingInField } from "./config.js";

/* =========================================================================
 *  INPUT  (js/input.js)
 *  -------------------------------------------------------------------------
 *  One abstraction for both worlds. Every physical source produces an
 *  "input id": "k:s" for a key, "p:3" for pointer 3. A lane is considered
 *  down while at least one id is on it, so two fingers on the same lane
 *  can't double-trigger, and a chord across lanes just works.
 * ======================================================================= */
export class InputManager {
  constructor(target, renderer, { onPress, onRelease }) {
    this.renderer = renderer;
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.laneHolders = [];
    this.pointerLane = new Map();   // pointerId → lane
    this.enabled = false;
    this.rebuild();

    /* ---- keyboard ---- */
    window.addEventListener("keydown", (e) => {
      if (e.repeat || isTypingInField()) return;
      const lane = CONFIG.keys.indexOf(e.key.toLowerCase());
      if (lane === -1) return;
      e.preventDefault();
      this.press(lane, "k:" + lane);
    });
    window.addEventListener("keyup", (e) => {
      if (isTypingInField()) return;
      const lane = CONFIG.keys.indexOf(e.key.toLowerCase());
      if (lane === -1) return;
      e.preventDefault();
      this.release(lane, "k:" + lane);
    });

    /* ---- pointers (mouse + multi-touch, one code path) ----
       touch-action:none on <body> is what makes simultaneous pointers
       arrive here instead of being eaten by scroll/zoom. */
    const down = (e) => {
      const lane = this.laneFromPoint(e.clientX, e.clientY);
      if (lane === -1) return;
      e.preventDefault();
      this.pointerLane.set(e.pointerId, lane);
      this.press(lane, "p:" + e.pointerId);
    };
    const up = (e) => {
      if (!this.pointerLane.has(e.pointerId)) return;
      const lane = this.pointerLane.get(e.pointerId);
      this.pointerLane.delete(e.pointerId);
      this.release(lane, "p:" + e.pointerId);
    };
    /* Sliding between lanes: release the old lane, press the new one.
       This is what makes fast trill patterns playable with one thumb. */
    const move = (e) => {
      if (!this.pointerLane.has(e.pointerId)) return;
      const prev = this.pointerLane.get(e.pointerId);
      const lane = this.laneFromPoint(e.clientX, e.clientY);
      if (lane === -1 || lane === prev) return;
      this.release(prev, "p:" + e.pointerId);
      this.pointerLane.set(e.pointerId, lane);
      this.press(lane, "p:" + e.pointerId);
    };

    target.addEventListener("pointerdown", down, { passive: false });
    target.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);

    /* belt and braces on iOS */
    target.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    target.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
    document.addEventListener("gesturestart", (e) => e.preventDefault());
  }

  /** Re-allocate the per-lane tables after the chart changes lane count. */
  rebuild() {
    this.laneHolders = Array.from({ length: CONFIG.laneCount }, () => new Set());
    this.pointerLane.clear();
  }

  /** Which lane does a screen point fall in? Uses the perspective width at
   *  that row, so the touch target matches the widening highway exactly. */
  laneFromPoint(px, py) {
    const r = this.renderer;
    const TOUCH_TOP = r.horizonY + r.trackH * 0.42;    // lower portion only
    if (py < TOUCH_TOP) return -1;
    const s = clamp((py - r.horizonY) / r.trackH, 0.001, 1);
    /* Below the hit line the lanes keep widening; clamp to scale 1 so the
       key caps are hit-testable too. */
    const sc = py > r.hitY ? 1 : s;
    const local = (px - r.cx) / sc;
    if (Math.abs(local) > r.halfW) return -1;
    return clamp(Math.floor((local + r.halfW) / r.laneW), 0, CONFIG.laneCount - 1);
  }

  press(lane, id) {
    if (!this.enabled) return;
    const set = this.laneHolders[lane];
    if (set.has(id)) return;
    const wasEmpty = set.size === 0;
    set.add(id);
    if (wasEmpty) this.onPress(lane, id);
  }

  release(lane, id) {
    const set = this.laneHolders[lane];
    if (!set.delete(id)) return;
    if (set.size === 0 && this.enabled) this.onRelease(lane, id);
  }

  isDown(lane) { return this.laneHolders[lane].size > 0; }

  releaseAll() {
    for (let i = 0; i < CONFIG.laneCount; i++) {
      for (const id of [...this.laneHolders[i]]) this.release(i, id);
      this.laneHolders[i].clear();
    }
    this.pointerLane.clear();
  }
}



import { CONFIG, clamp, lerp, keyLabel } from "./config.js";

/* =========================================================================
 *  RENDERER  (js/render.js)
 * ======================================================================= */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.wood = makeWoodTexture(256, 768);
    this.trackLayer = document.createElement("canvas");  // baked once per resize
    this.dpr = 1;
    this.resize();
  }

  /* -------- geometry ------------------------------------------------- */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = dpr;
    this.W = w; this.H = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* Adaptive camera. A tall portrait phone would otherwise get a narrow
       spire, so on those the horizon drops and the board widens. k = 0 at
       a 9:19.5 phone, 1 at 3:2 and wider. */
    const k = clamp((w / h - 0.46) / (1.5 - 0.46), 0, 1);
    this.cx = w / 2;
    this.horizonY = h * lerp(0.30, CONFIG.horizonRatio, k);
    this.hitY = h * lerp(0.785, CONFIG.hitLineRatio, k);
    this.trackH = this.hitY - this.horizonY;
    this.halfW = Math.min(w * lerp(0.475, CONFIG.trackHalfRatio, k), h * 0.62);
    this.laneW = (this.halfW * 2) / CONFIG.laneCount;

    // lane centre X at scale 1, relative to canvas centre
    this.laneCx = [];
    for (let i = 0; i < CONFIG.laneCount; i++) {
      this.laneCx.push(-this.halfW + this.laneW * (i + 0.5));
    }
    this.bakeTrack();
  }

  /** Perspective scale for a track-depth z. */
  scaleOf(z) { return CONFIG.FOCAL / (CONFIG.FOCAL + Math.max(z, -CONFIG.FOCAL * 0.85)); }
  /** Screen Y from a scale. */
  yOf(s) { return this.horizonY + this.trackH * s; }
  /** Inverse: the depth that lands on a given scale. */
  zOf(s) { return CONFIG.FOCAL / s - CONFIG.FOCAL; }

  /* -------- baked wooden highway --------------------------------------
   * The board never moves, so the whole perspective-warped texture is
   * rendered once into an offscreen canvas and blitted each frame. This is
   * a classic scanline (Mode-7 style) texture map: for every screen row we
   * solve for z, read the matching row of the wood texture, and stretch it
   * to that row's width. */
  bakeTrack() {
    const t = this.trackLayer;
    t.width = this.canvas.width; t.height = this.canvas.height;
    const g = t.getContext("2d");
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);

    const V_PER_Z = 78;                       // texture rows per track unit
    const texH = this.wood.height;
    const step = 1;
    g.imageSmoothingEnabled = true;

    for (let y = Math.ceil(this.horizonY) + 1; y <= this.hitY; y += step) {
      const s = (y - this.horizonY) / this.trackH;      // 0 at horizon, 1 at hit line
      if (s <= 0.0001) continue;
      const z = this.zOf(s);
      let v = (z * V_PER_Z) % texH;
      if (v < 0) v += texH;
      const w = this.halfW * 2 * s;
      const srcH = Math.max(1, Math.min(6, 1 + z * 0.9));  // mip-ish blur far away
      g.globalAlpha = 1;
      g.drawImage(this.wood, 0, Math.min(v, texH - srcH), this.wood.width, srcH,
                  this.cx - w / 2, y, w, step + 0.6);
    }

    /* haze into the vanishing point so far-field moiré disappears */
    const haze = g.createLinearGradient(0, this.horizonY, 0, this.horizonY + this.trackH * 0.55);
    haze.addColorStop(0, "rgba(14,9,6,1)");
    haze.addColorStop(0.35, "rgba(14,9,6,.72)");
    haze.addColorStop(1, "rgba(14,9,6,0)");
    g.save();
    this.trackPath(g, 0.0, 1.0);
    g.clip();
    g.fillStyle = haze;
    g.fillRect(0, this.horizonY, this.W, this.trackH);

    /* polished sheen down the centre of the board */
    const sheen = g.createLinearGradient(this.cx - this.halfW, 0, this.cx + this.halfW, 0);
    sheen.addColorStop(0, "rgba(0,0,0,.45)");
    sheen.addColorStop(0.42, "rgba(255,226,170,.07)");
    sheen.addColorStop(0.5, "rgba(255,235,190,.12)");
    sheen.addColorStop(0.58, "rgba(255,226,170,.07)");
    sheen.addColorStop(1, "rgba(0,0,0,.45)");
    g.fillStyle = sheen;
    g.fillRect(0, this.horizonY, this.W, this.trackH);
    g.restore();

    /* lane dividers — in one-point perspective these are straight lines */
    for (let i = 0; i <= CONFIG.laneCount; i++) {
      const x0 = -this.halfW + this.laneW * i;
      const edge = (i === 0 || i === CONFIG.laneCount);
      const grad = g.createLinearGradient(0, this.horizonY, 0, this.hitY);
      if (edge) {
        grad.addColorStop(0, "rgba(201,162,39,0)");
        grad.addColorStop(0.35, "rgba(201,162,39,.30)");
        grad.addColorStop(1, "rgba(240,220,154,.85)");
      } else {
        grad.addColorStop(0, "rgba(255,240,205,0)");
        grad.addColorStop(0.4, "rgba(255,240,205,.07)");
        grad.addColorStop(1, "rgba(255,240,205,.26)");
      }
      g.strokeStyle = grad;
      g.lineWidth = edge ? 2.2 : 1;
      g.beginPath();
      g.moveTo(this.cx, this.horizonY);
      g.lineTo(this.cx + x0, this.hitY);
      g.stroke();
    }
  }

  /** Path covering the track between two scale values (1 = hit line). */
  trackPath(g, sFar, sNear) {
    const yF = this.yOf(sFar), yN = this.yOf(sNear);
    g.beginPath();
    g.moveTo(this.cx - this.halfW * sFar, yF);
    g.lineTo(this.cx + this.halfW * sFar, yF);
    g.lineTo(this.cx + this.halfW * sNear, yN);
    g.lineTo(this.cx - this.halfW * sNear, yN);
    g.closePath();
  }

  /* -------- frame ------------------------------------------------------ */
  drawBackground() {
    const g = this.ctx;
    g.clearRect(0, 0, this.W, this.H);
    const bg = g.createRadialGradient(this.cx, this.horizonY, 10, this.cx, this.horizonY, this.H * 1.15);
    bg.addColorStop(0, "#402b1d");
    bg.addColorStop(0.28, "#1d120b");
    bg.addColorStop(1, "#080605");
    g.fillStyle = bg;
    g.fillRect(0, 0, this.W, this.H);

    /* a soft stage glow sitting on the horizon */
    const glow = g.createRadialGradient(this.cx, this.horizonY, 0, this.cx, this.horizonY, this.W * 0.42);
    glow.addColorStop(0, "rgba(255,215,150,.20)");
    glow.addColorStop(1, "rgba(255,215,150,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, this.W, this.horizonY + this.trackH * 0.5);
  }

  drawTrack() { this.ctx.drawImage(this.trackLayer, 0, 0, this.W, this.H); }

  /** Lit trapezoid up a lane while its key is down. */
  drawLanePress(lane, strength) {
    if (strength <= 0.01) return;
    const g = this.ctx;
    const sFar = 0.30, sNear = 1.0;
    const yF = this.yOf(sFar), yN = this.yOf(sNear);
    const cF = this.cx + this.laneCx[lane] * sFar, cN = this.cx + this.laneCx[lane] * sNear;
    const hF = this.laneW * 0.5 * sFar, hN = this.laneW * 0.5 * sNear;
    const grad = g.createLinearGradient(0, yF, 0, yN);
    grad.addColorStop(0, "rgba(255,226,160,0)");
    grad.addColorStop(1, `rgba(255,231,176,${0.30 * strength})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cF - hF, yF); g.lineTo(cF + hF, yF);
    g.lineTo(cN + hN, yN); g.lineTo(cN - hN, yN);
    g.closePath(); g.fill();
  }

  /** The brass hit line plus the six key caps beneath it. */
  drawHitLine(pressed, pulse) {
    const g = this.ctx;
    const y = this.hitY;

    g.save();
    g.shadowColor = "rgba(255,226,150,.9)";
    g.shadowBlur = 22 + pulse * 16;
    const lg = g.createLinearGradient(this.cx - this.halfW, 0, this.cx + this.halfW, 0);
    lg.addColorStop(0, "rgba(201,162,39,.25)");
    lg.addColorStop(0.5, "rgba(255,244,205,1)");
    lg.addColorStop(1, "rgba(201,162,39,.25)");
    g.strokeStyle = lg;
    g.lineWidth = 3.2;
    g.beginPath();
    g.moveTo(this.cx - this.halfW, y);
    g.lineTo(this.cx + this.halfW, y);
    g.stroke();
    g.restore();

    /* key caps — the physical keyboard under the board */
    const capH = clamp(Math.min(this.H - y - 48, this.laneW * 1.15), 18, 82);
    for (let i = 0; i < CONFIG.laneCount; i++) {
      const x = this.cx + this.laneCx[i] - this.laneW / 2 + 2;
      const w = this.laneW - 4;
      const down = pressed[i];
      const gr = g.createLinearGradient(0, y, 0, y + capH);
      if (down) { gr.addColorStop(0, "#fffdf4"); gr.addColorStop(0.7, "#f3e9cd"); gr.addColorStop(1, "#cdb982"); }
      else      { gr.addColorStop(0, "#efe7d3"); gr.addColorStop(0.55, "#ddd2ba"); gr.addColorStop(1, "#9d917a"); }
      g.save();
      if (down) { g.shadowColor = "rgba(255,230,160,.85)"; g.shadowBlur = 20; }
      g.fillStyle = gr;
      roundRect(g, x, y + 3, w, capH, 3);
      g.fill();
      g.restore();
      g.strokeStyle = down ? "rgba(255,244,205,.95)" : "rgba(60,44,30,.75)";
      g.lineWidth = 1;
      g.stroke();

      g.fillStyle = down ? "#2b1b10" : "rgba(70,54,38,.72)";
      g.font = `600 ${Math.max(10, Math.min(15, w * 0.3))}px "Cinzel", serif`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(keyLabel(CONFIG.keys[i]), x + w / 2, y + 3 + capH / 2);
    }
  }

  /* ---- HOLD BODY -------------------------------------------------------
   * The hard part. A hold spans a range of depth, and because scale is
   * hyperbolic in z the body must not be a straight quad — it has to be
   * subdivided. Sampling evenly in *scale* space (rather than in z) puts
   * the samples at even screen distances, so 26 segments is plenty even
   * for a long note that reaches the horizon. */
  drawHoldBody(lane, zNear, zFar, opts = {}) {
    const g = this.ctx;
    const { dead = false, active = false, alpha = 1 } = opts;
    const SEG = 26;

    const sNear = this.scaleOf(Math.min(zNear, CONFIG.Z_CULL));
    const sFar = this.scaleOf(Math.min(zFar, CONFIG.Z_CULL));
    if (sNear - sFar < 0.0008) return;

    const left = [], right = [];
    for (let i = 0; i <= SEG; i++) {
      const s = lerp(sNear, sFar, i / SEG);      // near → far
      const y = this.yOf(s);
      const c = this.cx + this.laneCx[lane] * s;
      const hw = this.laneW * 0.30 * s;
      left.push([c - hw, y]);
      right.push([c + hw, y]);
    }

    g.save();
    g.globalAlpha = alpha;

    const yN = left[0][1], yF = left[SEG][1];
    const body = g.createLinearGradient(0, yF, 0, yN);
    if (dead) {
      body.addColorStop(0, "rgba(90,82,74,.22)");
      body.addColorStop(1, "rgba(120,110,100,.42)");
    } else {
      body.addColorStop(0, "rgba(255,238,196,.30)");
      body.addColorStop(0.55, "rgba(255,243,214,.60)");
      body.addColorStop(1, active ? "rgba(255,252,238,.95)" : "rgba(255,246,222,.80)");
    }

    g.beginPath();
    g.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i <= SEG; i++) g.lineTo(left[i][0], left[i][1]);
    for (let i = SEG; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
    g.closePath();

    if (!dead) { g.shadowColor = active ? "rgba(255,238,180,.95)" : "rgba(255,226,150,.55)"; g.shadowBlur = active ? 26 : 13; }
    g.fillStyle = body;
    g.fill();
    g.shadowBlur = 0;

    /* a bright filament down the middle sells the "glowing stream" */
    if (!dead) {
      g.beginPath();
      g.moveTo(lerp(left[0][0], right[0][0], 0.5), left[0][1]);
      for (let i = 1; i <= SEG; i++) g.lineTo(lerp(left[i][0], right[i][0], 0.5), left[i][1]);
      const core = g.createLinearGradient(0, yF, 0, yN);
      core.addColorStop(0, "rgba(255,255,255,0)");
      core.addColorStop(1, "rgba(255,255,255,.75)");
      g.strokeStyle = core;
      g.lineWidth = Math.max(1, this.laneW * 0.06 * sNear);
      g.stroke();
    }

    /* tail cap */
    g.beginPath();
    g.moveTo(left[SEG][0], left[SEG][1]);
    g.lineTo(right[SEG][0], right[SEG][1]);
    g.strokeStyle = dead ? "rgba(150,140,130,.5)" : "rgba(255,248,225,.85)";
    g.lineWidth = Math.max(1, 2.4 * sFar);
    g.stroke();

    g.restore();
  }

  /** A tap note / hold head: an ivory key, drawn as a real 3D slab. */
  drawKeyNote(lane, z, opts = {}) {
    const g = this.ctx;
    const { dead = false, alpha = 1, flash = 0, wide = 0.44 } = opts;
    const sN = this.scaleOf(z);
    const sF = this.scaleOf(z + CONFIG.NOTE_DEPTH);
    if (sN <= 0.02) return;

    const yN = this.yOf(sN), yF = this.yOf(sF);
    const cN = this.cx + this.laneCx[lane] * sN, cF = this.cx + this.laneCx[lane] * sF;
    const hN = this.laneW * wide * sN, hF = this.laneW * wide * sF;

    const pts = [
      { x: cN - hN, y: yN }, { x: cN + hN, y: yN },
      { x: cF + hF, y: yF }, { x: cF - hF, y: yF },
    ];

    g.save();
    g.globalAlpha = alpha;

    /* contact shadow on the board */
    if (!dead) {
      g.fillStyle = "rgba(0,0,0,.35)";
      roundPoly(g, pts.map(p => ({ x: p.x, y: p.y + 3 * sN })), 5 * sN);
      g.fill();
    }

    const face = g.createLinearGradient(0, yF, 0, yN);
    if (dead) {
      face.addColorStop(0, "#5c564e"); face.addColorStop(1, "#8d867b");
    } else {
      face.addColorStop(0, "#ffffff");
      face.addColorStop(0.42, "#fdf8ea");
      face.addColorStop(0.75, "#efe6cf");
      face.addColorStop(1, "#ffffff");
    }
    if (!dead) {
      g.shadowColor = flash > 0 ? "rgba(255,247,214,1)" : "rgba(255,232,170,.75)";
      g.shadowBlur = 12 + flash * 30;
    }
    roundPoly(g, pts, Math.max(1.5, 6 * sN));
    g.fillStyle = face;
    g.fill();
    g.shadowBlur = 0;

    /* brass lip along the leading edge */
    if (!dead) {
      g.beginPath();
      g.moveTo(pts[0].x + 3 * sN, pts[0].y);
      g.lineTo(pts[1].x - 3 * sN, pts[1].y);
      g.strokeStyle = "rgba(201,162,39,.85)";
      g.lineWidth = Math.max(1, 2.4 * sN);
      g.stroke();
    }
    g.restore();
  }
}

/* ---- small canvas helpers ------------------------------------------- */
export function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Rounded arbitrary polygon — used so trapezoids keep soft piano-key corners. */
export function roundPoly(g, pts, r) {
  const n = pts.length;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const v1x = p0.x - p1.x, v1y = p0.y - p1.y;
    const v2x = p2.x - p1.x, v2y = p2.y - p1.y;
    const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = p1.x + (v1x / l1) * rr, ay = p1.y + (v1y / l1) * rr;
    const bx = p1.x + (v2x / l2) * rr, by = p1.y + (v2y / l2) * rr;
    if (i === 0) g.moveTo(ax, ay); else g.lineTo(ax, ay);
    g.quadraticCurveTo(p1.x, p1.y, bx, by);
  }
  g.closePath();
}

/* ---- procedural polished walnut ------------------------------------- */
export function makeWoodTexture(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  const d = img.data;

  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u),
                lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
  };
  const fbm = (x, y) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2; } return s; };

  const dark = [14, 8, 5], mid = [36, 21, 11], lite = [78, 49, 25];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      /* Grain runs lengthwise along the board (the v axis), so most of the
         variation lives on the u axis — but the lines have to wander down
         the length or they read as a printed barcode. */
      const drift = fbm(x * 0.010, y * 0.0040) * 2.2;
      const warp = fbm(x * 0.060, y * 0.0100) * 1.2;
      const ring = Math.abs(Math.sin(x * 0.22 + drift + warp));
      const fleck = vnoise(x * 1.1, y * 0.6) * 0.05;
      let t = Math.pow(ring, 2.0) * 0.74 + fleck;
      t = clamp(t, 0, 1);

      const base = t < 0.5
        ? [lerp(dark[0], mid[0], t * 2), lerp(dark[1], mid[1], t * 2), lerp(dark[2], mid[2], t * 2)]
        : [lerp(mid[0], lite[0], (t - 0.5) * 2), lerp(mid[1], lite[1], (t - 0.5) * 2), lerp(mid[2], lite[2], (t - 0.5) * 2)];

      const i = (y * w + x) * 4;
      d[i] = base[0]; d[i + 1] = base[1]; d[i + 2] = base[2]; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}



import { mulberry32 } from "./geometry.js";

function bez(p0, p1, p2, p3, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      y: u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    });
  }
  return out;
}

function line(a, b, n = 12) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t });
  }
  return out;
}

function wobble(stroke, amt, seed) {
  const rand = mulberry32(seed >>> 0);
  if (stroke.length < 2) return stroke;
  const knots = 3;
  const offs = [];
  for (let i = 0; i <= knots; i++) offs.push((rand() - 0.5) * 2 * amt);
  return stroke.map((p, i) => {
    const prev = stroke[Math.max(0, i - 1)];
    const next = stroke[Math.min(stroke.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = i / (stroke.length - 1);
    const k = t * knots;
    const i0 = Math.floor(k);
    const f = k - i0;
    const off = offs[i0] * (1 - f) + offs[Math.min(i0 + 1, knots)] * f;
    const env = 0.35 + 0.65 * Math.sin(t * Math.PI);
    return { x: p.x + (-dy / len) * off * env, y: p.y + (dx / len) * off * env };
  });
}

function glyph(width, strokes, seed = 1, amt = 0.045) {
  return {
    width,
    demo: true,
    strokes: strokes.map((stroke, i) => wobble(stroke, amt, seed * 47 + i * 19)),
  };
}

function variants(width, strokes, seeds, amt = 0.042) {
  return seeds.map((seed) => glyph(width, strokes, seed, amt));
}

function starStamp() {
  const pts = [];
  const cx = 0.5;
  const cy = 0.52;
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.18 : 0.42;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  const ring = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ring.push({ x: cx + Math.cos(a) * 0.48, y: cy + Math.sin(a) * 0.48 });
  }
  return {
    id: "demo_star",
    name: "Demo star",
    demo: true,
    strokes: [pts, ring],
    width: 1,
    height: 1,
  };
}

/** First-run sample card. Keep this in one place so Home and Note match. */
export const SAMPLE_NOTE = "Happy\nbirthday!";

/** Casual demo hand so Compose works before you capture your own letters. */
export function makeDemoLibrary() {
  const glyphs = {
    H: variants(0.92, [
      line([0.06, 0.04], [0.14, 1.7]),
      line([0.74, 0.02], [0.84, 1.66]),
      bez([0.14, 0.86], [0.34, 0.78], [0.58, 0.92], [0.8, 0.8]),
    ], [3, 11]),
    i: variants(0.38, [
      line([0.14, 0.04], [0.2, 1.0]),
      bez([0.14, 1.34], [0.22, 1.48], [0.28, 1.36], [0.16, 1.28]),
    ], [5, 19]),
    t: variants(0.58, [
      bez([0.06, 1.08], [0.18, 1.52], [0.24, 0.38], [0.44, 0.06]),
      bez([0.44, 0.06], [0.54, -0.04], [0.6, 0.16], [0.5, 0.24]),
      line([0.02, 1.04], [0.5, 1.16]),
    ], [7, 23]),
    h: variants(0.82, [
      line([0.08, 0.02], [0.16, 1.68]),
      bez([0.14, 0.82], [0.42, 1.18], [0.76, 0.86], [0.68, 0.04]),
    ], [9, 29]),
    e: variants(0.7, [
      bez([0.56, 0.7], [0.04, 1.22], [0.06, 0.04], [0.64, 0.22]),
      bez([0.1, 0.52], [0.3, 0.42], [0.52, 0.56], [0.64, 0.5]),
    ], [2, 13, 31]),
    r: variants(0.55, [
      line([0.1, 0.02], [0.16, 1.0]),
      bez([0.16, 0.78], [0.36, 1.16], [0.56, 0.94], [0.46, 0.74]),
    ], [8, 17]),
    a: variants(0.78, [
      bez([0.62, 0], [0.7, 0.55], [0.62, 1.12], [0.22, 1.05]),
      bez([0.22, 1.05], [0.02, 0.95], [0.08, 0.08], [0.42, 0.12]),
      line([0.62, 0.42], [0.64, 0]),
    ], [4, 15]),
    o: [glyph(0.74, [
      bez([0.38, 1.08], [0.02, 1.0], [0.0, 0.08], [0.4, 0.02]),
      bez([0.4, 0.02], [0.78, 0.08], [0.76, 1.02], [0.38, 1.08]),
    ])],
    l: [glyph(0.36, [
      bez([0.14, 1.7], [0.16, 0.7], [0.18, 0.12], [0.28, 0.04]),
    ])],
    n: [glyph(0.78, [
      line([0.1, 0], [0.12, 1.02]),
      bez([0.12, 0.88], [0.4, 1.14], [0.7, 0.9], [0.68, 0.02]),
    ])],
    s: [glyph(0.62, [
      bez([0.5, 1.02], [0.08, 1.15], [0.12, 0.58], [0.36, 0.52]),
      bez([0.36, 0.52], [0.62, 0.46], [0.58, -0.02], [0.12, 0.08]),
    ])],
    y: variants(0.72, [
      bez([0.08, 1.02], [0.18, 0.55], [0.32, 0.2], [0.4, 0]),
      bez([0.62, 1.02], [0.5, 0.4], [0.42, -0.2], [0.18, -0.55]),
    ], [6, 21, 41]),
    p: variants(0.78, [
      line([0.16, 1.04], [0.1, -0.58]),
      bez([0.16, 0.94], [0.76, 1.14], [0.8, 0.1], [0.18, 0.12]),
    ], [12, 27, 44]),
    b: variants(0.76, [
      line([0.12, 1.72], [0.18, 0.02]),
      bez([0.16, 0.9], [0.74, 1.12], [0.78, 0.06], [0.2, 0.1]),
    ], [14, 33]),
    "!": variants(0.32, [
      bez([0.14, 1.62], [0.1, 1.05], [0.2, 0.52], [0.16, 0.38]),
      bez([0.1, 0.12], [0.16, 0.2], [0.22, 0.1], [0.12, 0.02]),
    ], [10, 25]),
    u: [glyph(0.76, [
      bez([0.1, 1.02], [0.08, 0.12], [0.36, -0.08], [0.62, 0.2]),
      line([0.62, 1.02], [0.64, 0.02]),
    ])],
    w: [glyph(0.95, [
      line([0.06, 1.02], [0.22, 0.04]),
      line([0.22, 0.04], [0.4, 0.72]),
      line([0.4, 0.72], [0.58, 0.04]),
      line([0.58, 0.04], [0.86, 1.0]),
    ])],
    d: [glyph(0.78, [
      line([0.64, 0], [0.66, 1.7]),
      bez([0.64, 0.95], [0.2, 1.18], [0.02, 0.1], [0.64, 0.08]),
    ])],
    m: [glyph(1.12, [
      line([0.08, 0], [0.1, 1.02]),
      bez([0.1, 0.9], [0.32, 1.16], [0.5, 0.85], [0.52, 0.08]),
      bez([0.52, 0.9], [0.74, 1.16], [0.98, 0.82], [0.96, 0.04]),
    ])],
    ".": [glyph(0.28, [
      bez([0.12, 0.08], [0.16, 0.16], [0.2, 0.08], [0.12, 0.02]),
    ])],
  };

  return {
    glyphs,
    words: {},
    stamps: [starStamp()],
  };
}

export function libraryHasUserInk(lib) {
  const glyphs = Object.values(lib.glyphs || {}).flat().some((g) => !g.demo);
  const words = Object.values(lib.words || {}).flat().some((g) => !g.demo);
  const stamps = (lib.stamps || []).some((s) => !s.demo);
  return glyphs || words || stamps;
}

export function libraryUsesDemo(lib) {
  const glyphs = Object.values(lib.glyphs || {}).flat().some((g) => g.demo);
  const stamps = (lib.stamps || []).some((s) => s.demo);
  return glyphs || stamps;
}

export function mergeDemoKit(lib) {
  if (libraryHasUserInk(lib)) return lib;
  const demo = makeDemoLibrary();
  return {
    ...lib,
    glyphs: demo.glyphs,
    words: demo.words,
    stamps: demo.stamps,
  };
}

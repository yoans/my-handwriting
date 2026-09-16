function bez(p0, p1, p2, p3, n = 10) {
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

function line(a, b, n = 6) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t });
  }
  return out;
}

function glyph(width, strokes) {
  return { width, strokes, demo: true };
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

/** Casual demo hand so Compose works before you capture your own letters. */
export function makeDemoLibrary() {
  const glyphs = {
    H: [glyph(0.92, [
      line([0.08, 0], [0.1, 1.72]),
      line([0.78, 0], [0.8, 1.7]),
      bez([0.1, 0.82], [0.32, 0.9], [0.55, 0.78], [0.78, 0.84]),
    ])],
    i: [glyph(0.38, [
      line([0.16, 0], [0.18, 1.02]),
      bez([0.16, 1.38], [0.2, 1.46], [0.24, 1.38], [0.18, 1.32]),
    ])],
    t: [glyph(0.58, [
      bez([0.08, 1.12], [0.22, 1.55], [0.28, 0.4], [0.42, 0.08]),
      bez([0.42, 0.08], [0.5, -0.02], [0.58, 0.12], [0.52, 0.22]),
      line([0.04, 1.08], [0.46, 1.12]),
    ])],
    h: [glyph(0.82, [
      line([0.1, 0], [0.12, 1.7]),
      bez([0.12, 0.88], [0.38, 1.12], [0.72, 0.92], [0.7, 0.02]),
    ])],
    e: [glyph(0.7, [
      bez([0.58, 0.72], [0.08, 1.18], [0.02, 0.08], [0.62, 0.18]),
      bez([0.12, 0.55], [0.32, 0.48], [0.5, 0.52], [0.62, 0.58]),
    ])],
    r: [glyph(0.55, [
      line([0.12, 0], [0.14, 1.02]),
      bez([0.14, 0.82], [0.32, 1.12], [0.52, 1.0], [0.48, 0.78]),
    ])],
    a: [glyph(0.78, [
      bez([0.62, 0], [0.7, 0.55], [0.62, 1.12], [0.22, 1.05]),
      bez([0.22, 1.05], [0.02, 0.95], [0.08, 0.08], [0.42, 0.12]),
      line([0.62, 0.42], [0.64, 0]),
    ])],
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
    y: [glyph(0.72, [
      bez([0.08, 1.02], [0.18, 0.55], [0.32, 0.2], [0.4, 0]),
      bez([0.62, 1.02], [0.5, 0.4], [0.42, -0.2], [0.18, -0.55]),
    ])],
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
  if (libraryHasUserInk(lib) || libraryUsesDemo(lib)) return lib;
  const demo = makeDemoLibrary();
  return {
    ...lib,
    glyphs: { ...demo.glyphs, ...(lib.glyphs || {}) },
    words: { ...demo.words, ...(lib.words || {}) },
    stamps: [...(demo.stamps || []), ...(lib.stamps || [])],
  };
}

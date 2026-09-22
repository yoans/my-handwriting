import { boundsOfStrokes, transformStrokes, mulberry32 } from "./geometry.js";

function pick(list, rand) {
  if (!list || !list.length) return null;
  return list[Math.floor(rand() * list.length)];
}

function isBoundary(ch) {
  return !ch || !/[A-Za-z0-9]/.test(ch);
}

function longestWordMatch(library, text, i) {
  if (i > 0 && !isBoundary(text[i - 1])) return null;
  let best = null;
  for (const word of Object.keys(library.words)) {
    if (!library.words[word]?.length) continue;
    if (!text.startsWith(word, i)) continue;
    if (!isBoundary(text[i + word.length])) continue;
    if (!best || word.length > best.length) best = word;
  }
  return best;
}

function placeGlyphAt(glyph, x, baselineY, scale, jitter, rand) {
  const rot = ((rand() - 0.5) * 2 * jitter.rotation * Math.PI) / 180;
  const dy = ((rand() - 0.5) * 2 * jitter.baseline * scale);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return transformStrokes(glyph.strokes, (p) => {
    const px = p.x * scale;
    const py = -p.y * scale;
    return {
      x: x + px * cos - py * sin,
      y: baselineY + dy + px * sin + py * cos,
    };
  });
}

function translateStrokes(strokes, dx, dy = 0) {
  if (dx === 0 && dy === 0) return strokes;
  return transformStrokes(strokes, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

function extremeXAtY(strokes, y, mode, band) {
  let best = null;
  const consider = (x) => {
    if (best == null) best = x;
    else best = mode === "max" ? Math.max(best, x) : Math.min(best, x);
  };
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i++) {
      const p = stroke[i];
      if (Math.abs(p.y - y) <= band) consider(p.x);
      if (i === 0) continue;
      const q = stroke[i - 1];
      const lo = Math.min(p.y, q.y);
      const hi = Math.max(p.y, q.y);
      if (y < lo - band || y > hi + band) continue;
      if (Math.abs(p.y - q.y) < 1e-9) {
        consider(p.x);
        consider(q.x);
        continue;
      }
      const t = (y - q.y) / (p.y - q.y);
      if (t >= 0 && t <= 1) consider(q.x + t * (p.x - q.x));
    }
  }
  return best;
}

/** Horizontal shift to apply to `next` so ink-to-ink gap ≈ targetGap. */
export function opticalKernShift(prev, next, targetGap, band = 0.15) {
  const pb = boundsOfStrokes(prev);
  const nb = boundsOfStrokes(next);
  const y0 = Math.max(pb.minY, nb.minY);
  const y1 = Math.min(pb.maxY, nb.maxY);
  const bboxGap = nb.minX - pb.maxX;
  if (y1 - y0 < band * 0.5) return targetGap - bboxGap;

  let minGap = Infinity;
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    const right = extremeXAtY(prev, y, "max", band);
    const left = extremeXAtY(next, y, "min", band);
    if (right == null || left == null) continue;
    minGap = Math.min(minGap, left - right);
  }
  if (!isFinite(minGap)) minGap = bboxGap;
  return targetGap - minGap;
}

function isPunctuation(token) {
  const ch = token.ch || "";
  return token.type === "char" && /[.,;:'"!?]/.test(ch);
}

export function layoutText(library, text, options) {
  const {
    xHeightMm = 4.5,
    tracking = 0.28,
    wordSpace = 0.95,
    lineHeight = 3,
    maxWidth = 170,
    seed = 1,
    jitter = { size: 0.06, rotation: 2.2, baseline: 0.08 },
    marginLeft = 0,
    marginTop = 0,
  } = options;

  const rand = mulberry32(seed);
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\r") { i += 1; continue; }
    if (ch === "\n") { tokens.push({ type: "newline" }); i += 1; continue; }
    if (ch === " ") { tokens.push({ type: "space" }); i += 1; continue; }
    const word = longestWordMatch(library, text, i);
    if (word && word.length > 1) {
      tokens.push({ type: "word", word });
      i += word.length;
      continue;
    }
    tokens.push({ type: "char", ch });
    i += 1;
  }

  let x = marginLeft;
  let y = marginTop + xHeightMm * 1.7;
  const allStrokes = [];
  const missing = new Set();
  let prev = null;
  const band = xHeightMm * 0.05;
  const baseGap = xHeightMm * tracking;

  const startLine = () => {
    x = marginLeft;
    prev = null;
  };

  for (const token of tokens) {
    if (token.type === "newline") {
      y += xHeightMm * lineHeight;
      startLine();
      continue;
    }
    if (token.type === "space") {
      // Word gap sits on top of letter gap so opening out letters cannot
      // collapse "the   cat" into "the cat".
      const space = baseGap + xHeightMm * Math.max(wordSpace, 0);
      if (prev) {
        const pb = boundsOfStrokes(prev);
        x = pb.maxX + space;
      } else {
        x += space;
      }
      if (x > maxWidth) {
        y += xHeightMm * lineHeight;
        startLine();
      }
      prev = null;
      continue;
    }

    let glyph = null;
    if (token.type === "word") {
      glyph = pick(library.words[token.word], rand);
    } else {
      glyph = pick(library.glyphs[token.ch], rand);
      if (!glyph && token.ch !== token.ch.toLowerCase()) glyph = pick(library.glyphs[token.ch.toLowerCase()], rand);
      if (!glyph && token.ch !== token.ch.toUpperCase()) glyph = pick(library.glyphs[token.ch.toUpperCase()], rand);
    }

    if (!glyph) {
      missing.add(token.ch || token.word);
      x += xHeightMm * 0.7;
      prev = null;
      continue;
    }

    const scale = xHeightMm * (1 + (rand() - 0.5) * 2 * jitter.size);
    let placed = placeGlyphAt(glyph, 0, y, scale, jitter, rand);
    let b = boundsOfStrokes(placed);
    const targetGap = baseGap * (isPunctuation(token) ? 0.45 : 1);

    if (!prev) {
      placed = translateStrokes(placed, x - b.minX);
    } else {
      placed = translateStrokes(placed, boundsOfStrokes(prev).maxX + targetGap - b.minX);
      const shift = opticalKernShift(prev, placed, targetGap, band);
      placed = translateStrokes(placed, shift);
    }

    b = boundsOfStrokes(placed);
    if (x > marginLeft && b.maxX > maxWidth) {
      y += xHeightMm * lineHeight;
      startLine();
      placed = placeGlyphAt(glyph, 0, y, scale, jitter, rand);
      b = boundsOfStrokes(placed);
      placed = translateStrokes(placed, x - b.minX);
      b = boundsOfStrokes(placed);
    }

    for (const stroke of placed) allStrokes.push(stroke);
    prev = placed;
    x = b.maxX;
  }

  return {
    strokes: allStrokes,
    missing: [...missing],
    bounds: boundsOfStrokes(allStrokes),
  };
}

/** Convert canvas pixel strokes into normalized glyph space using guide positions. */
export function normalizeStrokes(strokes, guides) {
  const { baseline, xHeight, left } = guides;
  const unit = baseline - xHeight;
  if (Math.abs(unit) < 1) throw new Error("Guides collapsed");
  const norm = transformStrokes(strokes, (p) => ({
    x: (p.x - left) / unit,
    y: (baseline - p.y) / unit,
  }));
  const b = boundsOfStrokes(norm);
  const width = Math.max(b.maxX - Math.min(0, b.minX), b.width, 0.35);
  return { strokes: norm, width, bounds: b };
}

export function strokesToSvg(strokes, {
  width = 800,
  height = 500,
  strokeWidth = 1.6,
  paper = "#f3ead6",
  box = null,
} = {}) {
  const b = box || boundsOfStrokes(strokes);
  const pad = box ? 0 : 12;
  const minX = (b.minX ?? 0) - pad;
  const minY = (b.minY ?? 0) - pad;
  const vbW = Math.max((b.width ?? b.maxX - b.minX) + pad * 2, 40);
  const vbH = Math.max((b.height ?? b.maxY - b.minY) + pad * 2, 40);
  const vb = `${minX.toFixed(2)} ${minY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}`;
  const paths = strokes.map((stroke) => {
    if (!stroke.length) return "";
    const d = stroke.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="#1c1712" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${width}" height="${height}" style="background:${paper}">${paths}</svg>`;
}

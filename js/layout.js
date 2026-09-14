import { boundsOfStrokes, transformStrokes, mulberry32 } from "./geometry.js";

function pick(list, rand) {
  if (!list || !list.length) return null;
  return list[Math.floor(rand() * list.length)];
}

function isBoundary(ch) {
  return !ch || !/[A-Za-z0-9]/.test(ch);
}

function longestWordMatch(library, text, i) {
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
  const dy = (rand() - 0.5) * 2 * jitter.baseline * scale;
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

export function layoutText(library, text, options) {
  const {
    xHeightMm = 3.2,
    tracking = 0.18,
    lineHeight = 2.6,
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

  const wrapIfNeeded = (width) => {
    if (x > marginLeft && x + width > marginLeft + maxWidth) {
      x = marginLeft;
      y += xHeightMm * lineHeight;
    }
  };

  for (const token of tokens) {
    if (token.type === "newline") {
      x = marginLeft;
      y += xHeightMm * lineHeight;
      continue;
    }
    if (token.type === "space") {
      x += xHeightMm * 0.72;
      if (x > marginLeft + maxWidth) {
        x = marginLeft;
        y += xHeightMm * lineHeight;
      }
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
      x += xHeightMm * 0.9;
      continue;
    }

    const scale = xHeightMm * (1 + (rand() - 0.5) * 2 * jitter.size);
    const width = Math.max(glyph.width || 0.8, 0.35) * scale;
    wrapIfNeeded(width);
    for (const stroke of placeGlyphAt(glyph, x, y, scale, jitter, rand)) allStrokes.push(stroke);
    x += width + xHeightMm * tracking;
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
  const width = Math.max(b.maxX, 0.35);
  return { strokes: norm, width, bounds: b };
}

export function strokesToSvg(strokes, { width = 800, height = 500, strokeWidth = 1.6, paper = "#f3ead6" } = {}) {
  const b = boundsOfStrokes(strokes);
  const pad = 12;
  const vbW = Math.max(b.width + pad * 2, 40);
  const vbH = Math.max(b.height + pad * 2, 40);
  const vb = `${(b.minX - pad).toFixed(2)} ${(b.minY - pad).toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}`;
  const paths = strokes.map((stroke) => {
    if (!stroke.length) return "";
    const d = stroke.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="#1c1712" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${width}" height="${height}" style="background:${paper}">${paths}</svg>`;
}

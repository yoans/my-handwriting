export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function simplifyStroke(points, epsilon = 0.8) {
  if (points.length < 3) return points;
  return rdp(points, epsilon);
}

function rdp(points, epsilon) {
  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function pointLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return dist(p, a);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const tt = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + tt * dx), p.y - (a.y + tt * dy));
}

export function boundsOfStrokes(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function transformStrokes(strokes, fn) {
  return strokes.map((stroke) => stroke.map(fn));
}

/** Translate, then uniformly scale if needed, so ink sits inside the box. */
export function fitStrokesToBox(strokes, box, pad = 2) {
  const x0 = box.minX + pad;
  const y0 = box.minY + pad;
  const x1 = box.maxX - pad;
  const y1 = box.maxY - pad;
  const innerW = Math.max(x1 - x0, 1);
  const innerH = Math.max(y1 - y0, 1);
  const b = boundsOfStrokes(strokes);
  if (b.width <= 0 && b.height <= 0) return strokes;

  let dx = 0;
  let dy = 0;
  if (b.minX < x0) dx = x0 - b.minX;
  if (b.minY < y0) dy = y0 - b.minY;
  if (b.maxX + dx > x1) dx = x1 - b.maxX;
  if (b.maxY + dy > y1) dy = y1 - b.maxY;
  const shifted = (dx || dy)
    ? transformStrokes(strokes, (p) => ({ x: p.x + dx, y: p.y + dy }))
    : strokes;
  const b2 = boundsOfStrokes(shifted);
  const sx = innerW / Math.max(b2.width, 0.001);
  const sy = innerH / Math.max(b2.height, 0.001);
  const s = Math.min(sx, sy, 1);
  if (s >= 0.999) return shifted;
  const scaled = transformStrokes(shifted, (p) => ({
    x: x0 + (p.x - b2.minX) * s,
    y: y0 + (p.y - b2.minY) * s,
  }));
  return scaled;
}

export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function mulberry32(seed) {
  return seededRandom(seed);
}

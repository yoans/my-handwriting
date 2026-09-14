import { simplifyStroke, boundsOfStrokes } from "./geometry.js";

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function imageDataToBinary(data, w, h, { threshold = 145, invert = false } = {}) {
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const a = data[o + 3];
    if (a < 20) continue;
    const dark = luma(data[o], data[o + 1], data[o + 2]) < threshold;
    bin[i] = (invert ? !dark : dark) ? 1 : 0;
  }
  return bin;
}

function idx(x, y, w) {
  return y * w + x;
}

function inkAt(bin, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  return bin[idx(x, y, w)];
}

function dilate(bin, w, h) {
  const out = new Uint8Array(bin);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (bin[idx(x, y, w)]) continue;
      if (
        bin[idx(x - 1, y, w)] || bin[idx(x + 1, y, w)] ||
        bin[idx(x, y - 1, w)] || bin[idx(x, y + 1, w)]
      ) out[idx(x, y, w)] = 1;
    }
  }
  return out;
}

function erode(bin, w, h) {
  const out = new Uint8Array(bin);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!bin[idx(x, y, w)]) continue;
      if (
        !bin[idx(x - 1, y, w)] || !bin[idx(x + 1, y, w)] ||
        !bin[idx(x, y - 1, w)] || !bin[idx(x, y + 1, w)]
      ) out[idx(x, y, w)] = 0;
    }
  }
  return out;
}

function closeGaps(bin, w, h, times) {
  let cur = bin;
  for (let i = 0; i < times; i++) cur = dilate(cur, w, h);
  for (let i = 0; i < times; i++) cur = erode(cur, w, h);
  return cur;
}

function despeckle(bin, w, h, minArea) {
  if (minArea <= 1) return bin;
  const seen = new Uint8Array(w * h);
  const out = new Uint8Array(bin);
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!bin[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    const cells = [i];
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = idx(nx, ny, w);
        if (!bin[n] || seen[n]) continue;
        seen[n] = 1;
        stack.push(n);
        cells.push(n);
      }
    }
    if (cells.length < minArea) {
      for (const c of cells) out[c] = 0;
    }
  }
  return out;
}

const MOORE = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function findContours(bin, w, h) {
  const seen = new Uint8Array(w * h);
  const contours = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inkAt(bin, w, h, x, y) || seen[idx(x, y, w)]) continue;
      if (inkAt(bin, w, h, x - 1, y)) continue;

      const path = [];
      let cx = x;
      let cy = y;
      let dir = 0;
      let guard = 0;
      do {
        path.push({ x: cx, y: cy });
        seen[idx(cx, cy, w)] = 1;
        let found = false;
        for (let i = 0; i < 8; i++) {
          const d = (dir + 6 + i) % 8;
          const nx = cx + MOORE[d][0];
          const ny = cy + MOORE[d][1];
          if (inkAt(bin, w, h, nx, ny)) {
            cx = nx;
            cy = ny;
            dir = d;
            found = true;
            break;
          }
        }
        if (!found) break;
        guard += 1;
      } while ((cx !== x || cy !== y) && guard < w * h);

      if (path.length >= 10) {
        if (path[0].x !== path[path.length - 1].x || path[0].y !== path[path.length - 1].y) {
          path.push({ ...path[0] });
        }
        contours.push(path);
      }
    }
  }
  return contours;
}

function zhangSuen(bin, w, h) {
  const grid = new Uint8Array(bin);
  const neighbors = (x, y) => {
    const p2 = inkAt(grid, w, h, x, y - 1);
    const p3 = inkAt(grid, w, h, x + 1, y - 1);
    const p4 = inkAt(grid, w, h, x + 1, y);
    const p5 = inkAt(grid, w, h, x + 1, y + 1);
    const p6 = inkAt(grid, w, h, x, y + 1);
    const p7 = inkAt(grid, w, h, x - 1, y + 1);
    const p8 = inkAt(grid, w, h, x - 1, y);
    const p9 = inkAt(grid, w, h, x - 1, y - 1);
    const list = [p2, p3, p4, p5, p6, p7, p8, p9];
    const A = list.reduce((n, v, i) => n + (v === 0 && list[(i + 1) % 8] === 1 ? 1 : 0), 0);
    const B = list.reduce((n, v) => n + v, 0);
    return { p2, p4, p6, p8, A, B };
  };

  let changed = true;
  let pass = 0;
  while (changed && pass < 40) {
    changed = false;
    pass += 1;
    for (const step of [1, 2]) {
      const remove = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!grid[idx(x, y, w)]) continue;
          const { p2, p4, p6, p8, A, B } = neighbors(x, y);
          if (B < 2 || B > 6 || A !== 1) continue;
          if (step === 1 && p2 * p4 * p6 !== 0) continue;
          if (step === 1 && p4 * p6 * p8 !== 0) continue;
          if (step === 2 && p2 * p4 * p8 !== 0) continue;
          if (step === 2 && p2 * p6 * p8 !== 0) continue;
          remove.push(idx(x, y, w));
        }
      }
      if (remove.length) {
        changed = true;
        for (const i of remove) grid[i] = 0;
      }
    }
  }
  return grid;
}

function walkSkeleton(bin, w, h) {
  const degree = (x, y) => {
    let n = 0;
    for (const [dx, dy] of MOORE) if (inkAt(bin, w, h, x + dx, y + dy)) n += 1;
    return n;
  };
  const used = new Uint8Array(w * h);
  const strokes = [];

  const startPoints = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inkAt(bin, w, h, x, y)) continue;
      const d = degree(x, y);
      if (d <= 1) startPoints.push([x, y]);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (inkAt(bin, w, h, x, y)) startPoints.push([x, y]);
    }
  }

  for (const [sx, sy] of startPoints) {
    if (used[idx(sx, sy, w)]) continue;
    const path = [];
    let x = sx;
    let y = sy;
    let px = -99;
    let py = -99;
    let guard = 0;
    while (guard++ < w * h) {
      path.push({ x, y });
      used[idx(x, y, w)] = 1;
      let next = null;
      let fallback = null;
      for (const [dx, dy] of MOORE) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inkAt(bin, w, h, nx, ny)) continue;
        if (nx === px && ny === py) continue;
        if (!used[idx(nx, ny, w)]) {
          next = [nx, ny];
          break;
        }
        fallback = [nx, ny];
      }
      const pick = next || fallback;
      if (!pick) break;
      if (used[idx(pick[0], pick[1], w)] && path.length > 2) break;
      px = x;
      py = y;
      x = pick[0];
      y = pick[1];
    }
    if (path.length >= 4) strokes.push(path);
  }
  return strokes;
}

function scribbleFill(bin, w, h) {
  const strokes = [];
  const step = 5;
  for (let y = 0; y < h; y += step) {
    let run = null;
    for (let x = 0; x <= w; x++) {
      const on = x < w && inkAt(bin, w, h, x, y);
      if (on && !run) run = x;
      if (!on && run != null) {
        if (x - run >= 4) {
          const line = [];
          for (let t = run; t < x; t += 2) {
            const wobble = Math.sin(t * 0.35 + y * 0.2) * 1.6;
            line.push({ x: t, y: y + wobble });
          }
          if (line.length >= 2) strokes.push(line);
        }
        run = null;
      }
    }
  }
  return strokes;
}

export function binaryToStrokes(bin, w, h, { mode = "outline", simplify = 1.4 } = {}) {
  let raw = [];
  if (mode === "centerline") raw = walkSkeleton(zhangSuen(bin, w, h), w, h);
  else if (mode === "scribble") raw = [...findContours(bin, w, h), ...scribbleFill(bin, w, h)];
  else raw = findContours(bin, w, h);
  return raw
    .map((stroke) => simplifyStroke(stroke, simplify))
    .filter((stroke) => stroke.length >= 2);
}

export function normalizeStamp(strokes) {
  const b = boundsOfStrokes(strokes);
  const span = Math.max(b.width, b.height, 1);
  const norm = strokes.map((stroke) => stroke.map((p) => ({
    x: (p.x - b.minX) / span,
    y: (p.y - b.minY) / span,
  })));
  return {
    strokes: norm,
    width: b.width / span,
    height: b.height / span,
  };
}

export function imageDataToStamp(imageData, options = {}) {
  const w = imageData.width;
  const h = imageData.height;
  let bin = imageDataToBinary(imageData.data, w, h, options);
  bin = closeGaps(bin, w, h, options.joinGaps || 0);
  bin = despeckle(bin, w, h, options.minBlob || 18);
  const strokes = binaryToStrokes(bin, w, h, options);
  if (!strokes.length) return { strokes: [], width: 1, height: 1, count: 0, preview: bin, w, h };
  return { ...normalizeStamp(strokes), count: strokes.length, preview: bin, w, h };
}

export function rasterToImageData(img, maxEdge = 460) {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

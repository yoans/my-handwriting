import { boundsOfStrokes } from "./geometry.js";
import { layoutText } from "./layout.js";
import { imageDataToStamp } from "./trace.js";
import { makeSampleFont } from "./fonts.js";
import { SAMPLE_NOTE, starStamp } from "./demo.js";

function drawPaperStrokes(canvas, strokes, lineWidth = 1.5) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#f3ead6";
  ctx.fillRect(0, 0, w, h);
  if (!strokes?.length) return;
  const b = boundsOfStrokes(strokes);
  const pad = Math.max(14, Math.min(w, h) * 0.08);
  const sx = (w - pad * 2) / Math.max(b.width, 0.01);
  const sy = (h - pad * 2) / Math.max(b.height, 0.01);
  const s = Math.min(sx, sy);
  const ox = (w - b.width * s) / 2 - b.minX * s;
  const oy = (h - b.height * s) / 2 - b.minY * s;
  ctx.strokeStyle = "#1c1712";
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    for (let i = 0; i < stroke.length; i++) {
      const x = ox + stroke[i].x * s;
      const y = oy + stroke[i].y * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function setPx(data, size, x, y, v) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  data[i] = data[i + 1] = data[i + 2] = v;
  data[i + 3] = 255;
}

function fillRect(data, size, x0, y0, x1, y1, v) {
  const xa = Math.max(0, Math.min(x0, x1) | 0);
  const xb = Math.min(size - 1, Math.max(x0, x1) | 0);
  const ya = Math.max(0, Math.min(y0, y1) | 0);
  const yb = Math.min(size - 1, Math.max(y0, y1) | 0);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) setPx(data, size, x, y, v);
  }
}

/** High-contrast house: outline stays a house, shade modes still read as one. */
function samplePhoto(size = 200) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 242;
    data[i * 4 + 3] = 255;
  }
  fillRect(data, size, size * 0.22, size * 0.48, size * 0.78, size * 0.84, 132);
  for (let y = size * 0.2; y < size * 0.52; y++) {
    const t = (y - size * 0.2) / (size * 0.32);
    const half = size * (0.02 + t * 0.32);
    fillRect(data, size, size * 0.5 - half, y, size * 0.5 + half, y, 48);
  }
  fillRect(data, size, size * 0.62, size * 0.26, size * 0.72, size * 0.48, 64);
  fillRect(data, size, size * 0.3, size * 0.56, size * 0.44, size * 0.7, 220);
  fillRect(data, size, size * 0.56, size * 0.56, size * 0.7, size * 0.7, 220);
  fillRect(data, size, size * 0.36, size * 0.56, size * 0.38, size * 0.7, 70);
  fillRect(data, size, size * 0.3, size * 0.62, size * 0.44, size * 0.64, 70);
  fillRect(data, size, size * 0.62, size * 0.56, size * 0.64, size * 0.7, 70);
  fillRect(data, size, size * 0.56, size * 0.62, size * 0.7, size * 0.64, 70);
  fillRect(data, size, size * 0.45, size * 0.62, size * 0.55, size * 0.84, 36);
  fillRect(data, size, size * 0.51, size * 0.72, size * 0.53, size * 0.74, 200);
  return { width: size, height: size, data };
}

function drawPhoto(canvas, imageData) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const tmp = document.createElement("canvas");
  tmp.width = imageData.width;
  tmp.height = imageData.height;
  tmp.getContext("2d").putImageData(new ImageData(imageData.data, imageData.width, imageData.height), 0, 0);
  ctx.fillStyle = "#f3ead6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const s = Math.min(canvas.width / imageData.width, canvas.height / imageData.height) * 0.92;
  const w = imageData.width * s;
  const h = imageData.height * s;
  ctx.drawImage(tmp, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

let painted = false;

export function renderHomeDashboard() {
  const noteCanvas = document.getElementById("home-note");
  if (!noteCanvas || painted) return;
  painted = true;

  const demo = makeSampleFont("casual");
  const note = layoutText(demo, SAMPLE_NOTE, {
    xHeightMm: 4.4,
    maxWidth: 90,
    seed: 13,
    jitter: { size: 0.06, rotation: 2.4, baseline: 0.09 },
    marginLeft: 2,
    marginTop: 2,
  });
  drawPaperStrokes(noteCanvas, note.strokes, 2.1);
  drawPaperStrokes(document.getElementById("home-doodle"), starStamp().strokes, 2.4);

  const photo = samplePhoto(200);
  drawPhoto(document.getElementById("home-photo"), photo);
  const modes = [
    ["outline", 1.6, { threshold: 150 }],
    ["hatch", 0.95, { shades: 12, density: 8, threshold: 140 }],
    ["squiggle", 1.05, { shades: 12, density: 8, threshold: 140 }],
    ["rings", 0.95, { shades: 12, density: 7, threshold: 140 }],
    ["spiral", 1.05, { shades: 10, density: 5, threshold: 140 }],
  ];
  for (const [mode, width, opts] of modes) {
    const stamp = imageDataToStamp(photo, { mode, ...opts });
    drawPaperStrokes(document.getElementById(`home-${mode}`), stamp.strokes, width);
  }
}

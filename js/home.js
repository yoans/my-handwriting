import { boundsOfStrokes } from "./geometry.js";
import { layoutText } from "./layout.js";
import { imageDataToStamp } from "./trace.js";
import { makeDemoLibrary } from "./demo.js";

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

function samplePhoto(size = 148) {
  const data = new Uint8ClampedArray(size * size * 4);
  const cx = size * 0.5;
  const cy = size * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - cx) / size;
      const ny = (y - cy) / size;
      const face = Math.hypot(nx / 0.28, (ny + 0.02) / 0.34);
      const hair = Math.hypot(nx / 0.32, (ny + 0.16) / 0.22);
      let v = 232;
      if (hair < 1 && ny < 0.02) v = 42 + hair * 28;
      else if (face < 1) {
        v = 108 + ny * 40;
      const eyeL = Math.hypot(x - cx + size * 0.09, y - cy + size * 0.02);
      const eyeR = Math.hypot(x - cx - size * 0.09, y - cy + size * 0.02);
      if (eyeL < size * 0.05 || eyeR < size * 0.05) v = 22;
      const mouth = y > cy + size * 0.1 && y < cy + size * 0.15
        && Math.abs(x - cx) < size * 0.09;
        if (mouth) v = 70;
      }
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
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

  const demo = makeDemoLibrary();
  const note = layoutText(demo, "Hi there", {
    xHeightMm: 4.4,
    maxWidth: 88,
    seed: 4,
    jitter: { size: 0.03, rotation: 1.1, baseline: 0.04 },
    marginLeft: 2,
    marginTop: 2,
  });
  drawPaperStrokes(noteCanvas, note.strokes, 2.1);
  drawPaperStrokes(document.getElementById("home-doodle"), demo.stamps[0]?.strokes, 2.4);

  const photo = samplePhoto(150);
  drawPhoto(document.getElementById("home-photo"), photo);
  const modes = [
    ["outline", 1.4, { shades: 10, density: 13, threshold: 150 }],
    ["hatch", 0.95, { shades: 10, density: 10, threshold: 150 }],
    ["squiggle", 1.05, { shades: 10, density: 10, threshold: 150 }],
    ["rings", 0.9, { shades: 10, density: 9, threshold: 150 }],
    ["spiral", 1.05, { shades: 8, density: 5, threshold: 150 }],
  ];
  for (const [mode, width, opts] of modes) {
    const stamp = imageDataToStamp(photo, { mode, ...opts });
    drawPaperStrokes(document.getElementById(`home-${mode}`), stamp.strokes, width);
  }
}

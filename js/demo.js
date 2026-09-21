/** First-run sample card. Keep this in one place so Home and Note match. */
export const SAMPLE_NOTE = "Happy\nbirthday!";

function circle(cx, cy, r, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function smile(cx, cy, w, drop) {
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const x = cx - w + t * 2 * w;
    const y = cy + drop * 4 * t * (1 - t);
    pts.push({ x, y });
  }
  return pts;
}

export function faceStamp() {
  return {
    id: "demo_face",
    name: "Demo face",
    demo: true,
    strokes: [
      circle(0.5, 0.5, 0.44, 32),
      circle(0.35, 0.4, 0.045, 12),
      circle(0.65, 0.4, 0.045, 12),
      smile(0.5, 0.58, 0.16, 0.14),
    ],
    width: 1,
    height: 1,
  };
}

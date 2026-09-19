/** First-run sample card. Keep this in one place so Home and Note match. */
export const SAMPLE_NOTE = "Happy\nbirthday!";

export function starStamp() {
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

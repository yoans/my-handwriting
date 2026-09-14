import { transformStrokes, mulberry32 } from "./geometry.js";

export function stampToPaper(stamp, placement) {
  const span = Math.max(stamp.width || 1, stamp.height || 1, 0.001);
  const scale = (placement.sizeMm || 28) / span;
  const cx = (stamp.width || 1) / 2;
  const cy = (stamp.height || 1) / 2;
  const rad = ((placement.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return transformStrokes(stamp.strokes, (p) => {
    const px = (p.x - cx) * scale;
    const py = (p.y - cy) * scale;
    return {
      x: placement.x + px * cos - py * sin,
      y: placement.y + px * sin + py * cos,
    };
  });
}

export function placementsToStrokes(library, placements) {
  const all = [];
  for (const place of placements) {
    const stamp = library.stamps?.find((s) => s.id === place.stampId);
    if (!stamp) continue;
    for (const stroke of stampToPaper(stamp, place)) all.push(stroke);
  }
  return all;
}

export function funRunPlacements(stamp, { paperWidth, paperHeight, count = 6, seed = 3, sizeMm = 22 }) {
  const rand = mulberry32(seed);
  const n = Math.max(2, Math.min(20, count | 0));
  const margin = Math.max(18, sizeMm * 0.6);
  const usable = Math.max(paperWidth - margin * 2, sizeMm);
  const baseY = paperHeight * 0.72;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const wave = Math.sin(t * Math.PI * 2.4) * (sizeMm * 0.35);
    out.push({
      id: `run_${stamp.id}_${i}_${Math.floor(rand() * 1e7)}`,
      stampId: stamp.id,
      x: margin + t * usable,
      y: baseY + wave + (rand() - 0.5) * 6,
      sizeMm: sizeMm * (0.78 + rand() * 0.45),
      rotation: (rand() - 0.5) * 32,
    });
  }
  return out;
}

export function hitTestPlacement(library, placements, paperX, paperY) {
  for (let i = placements.length - 1; i >= 0; i--) {
    const place = placements[i];
    const stamp = library.stamps?.find((s) => s.id === place.stampId);
    if (!stamp) continue;
    const half = (place.sizeMm || 28) / 2;
    if (Math.abs(paperX - place.x) <= half && Math.abs(paperY - place.y) <= half) return i;
  }
  return -1;
}

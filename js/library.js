const STORAGE_KEY = "my-handwriting-library-v1";
const MACHINE_KEY = "my-handwriting-machine-v1";

const EMPTY_LIBRARY = () => ({
  version: 1,
  glyphs: {},
  words: {},
  stamps: [],
  updatedAt: null,
});

export function loadLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_LIBRARY();
    const parsed = JSON.parse(raw);
    parsed.glyphs ||= {};
    parsed.words ||= {};
    parsed.stamps ||= [];
    return parsed;
  } catch {
    return EMPTY_LIBRARY();
  }
}

export function saveLibrary(library) {
  library.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

export function exportLibrary(library) {
  return JSON.stringify(library, null, 2);
}

export function importLibrary(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("Not a library file");
  parsed.glyphs ||= {};
  parsed.words ||= {};
  parsed.stamps ||= [];
  parsed.version = 1;
  saveLibrary(parsed);
  return parsed;
}

export function glyphCount(library, ch) {
  return library.glyphs[ch]?.length || 0;
}

export function addGlyph(library, ch, glyph) {
  if (!library.glyphs[ch]) library.glyphs[ch] = [];
  library.glyphs[ch].push(glyph);
  saveLibrary(library);
}

export function removeGlyph(library, ch, index) {
  library.glyphs[ch]?.splice(index, 1);
  if (library.glyphs[ch] && library.glyphs[ch].length === 0) delete library.glyphs[ch];
  saveLibrary(library);
}

export function addWord(library, word, glyph) {
  const key = word;
  if (!library.words[key]) library.words[key] = [];
  library.words[key].push(glyph);
  saveLibrary(library);
}

export function removeWord(library, word, index) {
  library.words[word]?.splice(index, 1);
  if (library.words[word] && library.words[word].length === 0) delete library.words[word];
  saveLibrary(library);
}

export function addStamp(library, stamp) {
  library.stamps ||= [];
  library.stamps.push(stamp);
  saveLibrary(library);
}

export function removeStamp(library, id) {
  library.stamps = (library.stamps || []).filter((s) => s.id !== id);
  saveLibrary(library);
}

export const PLACEMENTS_KEY = "my-handwriting-placements-v1";

export function loadPlacements() {
  try {
    const raw = localStorage.getItem(PLACEMENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePlacements(placements) {
  localStorage.setItem(PLACEMENTS_KEY, JSON.stringify(placements));
}

export const DEFAULT_MACHINE = {
  preset: "marlin",
  bedX: 220,
  bedY: 220,
  originX: 15,
  originY: 200,
  paperWidth: 180,
  paperHeight: 250,
  zUp: 5,
  zDown: 0.4,
  travelFeed: 6000,
  writeFeed: 1400,
  homeXY: true,
  yDownIsNegative: true,
  flavor: "marlin",
  penZOffset: 20,
};

export const PRESETS = {
  marlin: { label: "Generic Marlin / Ender", bedX: 220, bedY: 220, originX: 15, originY: 200, paperWidth: 180, paperHeight: 250, zUp: 5, zDown: 0.4, travelFeed: 6000, writeFeed: 1400, flavor: "marlin", homeXY: true, yDownIsNegative: true },
  prusa: { label: "Prusa MK3/MK4", bedX: 250, bedY: 210, originX: 15, originY: 190, paperWidth: 180, paperHeight: 180, zUp: 5, zDown: 0.4, travelFeed: 6000, writeFeed: 1400, flavor: "marlin", homeXY: true, yDownIsNegative: true },
  bambu_a1: {
    label: "Bambu Lab A1",
    bedX: 256,
    bedY: 256,
    originX: 28,
    originY: 28,
    paperWidth: 200,
    paperHeight: 200,
    zUp: 4,
    zDown: 0,
    travelFeed: 9000,
    writeFeed: 1200,
    flavor: "bambu_a1",
    homeXY: false,
    yDownIsNegative: false,
    penZOffset: 20,
  },
  bambu: { label: "Bambu P1/X1", bedX: 256, bedY: 256, originX: 18, originY: 230, paperWidth: 180, paperHeight: 200, zUp: 5, zDown: 0, travelFeed: 9000, writeFeed: 1200, flavor: "bambu", homeXY: false, yDownIsNegative: true },
  klipper: { label: "Klipper", bedX: 220, bedY: 220, originX: 15, originY: 200, paperWidth: 180, paperHeight: 250, zUp: 5, zDown: 0.4, travelFeed: 6000, writeFeed: 1400, flavor: "klipper", homeXY: true, yDownIsNegative: true },
};

export function loadMachine() {
  try {
    const raw = localStorage.getItem(MACHINE_KEY);
    return raw ? { ...DEFAULT_MACHINE, ...JSON.parse(raw) } : { ...DEFAULT_MACHINE };
  } catch {
    return { ...DEFAULT_MACHINE };
  }
}

export function saveMachine(machine) {
  localStorage.setItem(MACHINE_KEY, JSON.stringify(machine));
}

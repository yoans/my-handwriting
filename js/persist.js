import { DEFAULT_MACHINE } from "./library.js";

export const PROJECT_KIND = "my-handwriting-project";
const LS_PROJECT = "my-handwriting-project-v2";
const LS_LIBRARY = "my-handwriting-library-v1";
const LS_MACHINE = "my-handwriting-machine-v1";
const LS_PLACEMENTS = "my-handwriting-placements-v1";
const IDB_NAME = "my-handwriting";
const IDB_STORE = "backup";

export function emptyProject() {
  return {
    kind: PROJECT_KIND,
    version: 2,
    savedAt: null,
    library: { version: 1, glyphs: {}, words: {}, stamps: [] },
    placements: [],
    machine: { ...DEFAULT_MACHINE },
    compose: {
      text: "",
      xHeight: 3.2,
      lineHeight: 2.6,
      tracking: 0.14,
      wordSpace: 0.42,
      seed: 7,
      jitter: 55,
      stampSize: 28,
      funRunCount: 6,
    },
    capture: {
      mode: "glyph",
      glyph: "a",
      word: "the",
      strokes: [],
    },
    stampsUi: {
      name: "doodle",
      source: "photo",
      mode: "outline",
      threshold: 145,
      join: 1,
      invert: false,
      doodle: [],
    },
    selectedStampId: null,
  };
}

function normalizeLibrary(lib = {}) {
  return {
    version: 1,
    glyphs: lib.glyphs || {},
    words: lib.words || {},
    stamps: Array.isArray(lib.stamps) ? lib.stamps : [],
    updatedAt: lib.updatedAt || null,
  };
}

export function normalizeProject(raw) {
  const base = emptyProject();
  if (!raw || typeof raw !== "object") return base;

  const library = normalizeLibrary(
    raw.library && (raw.library.glyphs || raw.library.words || raw.library.stamps)
      ? raw.library
      : raw.glyphs || raw.words || raw.stamps
        ? raw
        : {},
  );

  return {
    ...base,
    ...raw,
    kind: PROJECT_KIND,
    version: 2,
    library,
    placements: Array.isArray(raw.placements) ? raw.placements : base.placements,
    machine: { ...DEFAULT_MACHINE, ...(raw.machine || {}) },
    compose: { ...base.compose, ...(raw.compose || {}) },
    capture: {
      ...base.capture,
      ...(raw.capture || {}),
      strokes: Array.isArray(raw.capture?.strokes) ? raw.capture.strokes : [],
    },
    stampsUi: {
      ...base.stampsUi,
      ...(raw.stampsUi || {}),
      doodle: Array.isArray(raw.stampsUi?.doodle) ? raw.stampsUi.doodle : [],
    },
    selectedStampId: raw.selectedStampId || library.stamps[0]?.id || null,
  };
}

export function parseIncomingFile(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("Not a JSON object");
  const isProject = parsed.kind === PROJECT_KIND || parsed.compose || parsed.machine || parsed.placements;
  const isLibrary = parsed.glyphs || parsed.words || parsed.stamps || parsed.library;
  if (!isProject && !isLibrary) throw new Error("This file is not a handwriting backup");
  return {
    type: isProject && parsed.kind === PROJECT_KIND ? "project" : (parsed.library || parsed.compose ? "project" : "library"),
    project: normalizeProject(parsed),
  };
}

export function mergeLibraries(base, incoming) {
  const out = normalizeLibrary(base);
  const add = normalizeLibrary(incoming);
  for (const [ch, variants] of Object.entries(add.glyphs)) {
    if (!out.glyphs[ch]) out.glyphs[ch] = [];
    out.glyphs[ch].push(...variants);
  }
  for (const [word, variants] of Object.entries(add.words)) {
    if (!out.words[word]) out.words[word] = [];
    out.words[word].push(...variants);
  }
  const ids = new Set(out.stamps.map((s) => s.id));
  for (const stamp of add.stamps) {
    let id = stamp.id;
    if (!id || ids.has(id)) id = `stamp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ids.add(id);
    out.stamps.push({ ...stamp, id });
  }
  return out;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("no indexedDB"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbWrite(project) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.objectStore(IDB_STORE).put(project, "current");
    });
  } finally {
    db.close();
  }
}

async function idbRead() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get("current");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

function writeLegacyKeys(project) {
  localStorage.setItem(LS_LIBRARY, JSON.stringify(project.library));
  localStorage.setItem(LS_MACHINE, JSON.stringify(project.machine));
  localStorage.setItem(LS_PLACEMENTS, JSON.stringify(project.placements));
}

function readLegacyProject() {
  const project = emptyProject();
  try {
    const lib = localStorage.getItem(LS_LIBRARY);
    if (lib) project.library = normalizeLibrary(JSON.parse(lib));
  } catch { /* ignore corrupt */ }
  try {
    const machine = localStorage.getItem(LS_MACHINE);
    if (machine) project.machine = { ...DEFAULT_MACHINE, ...JSON.parse(machine) };
  } catch { /* ignore corrupt */ }
  try {
    const placements = localStorage.getItem(LS_PLACEMENTS);
    if (placements) project.placements = JSON.parse(placements);
  } catch { /* ignore corrupt */ }
  project.selectedStampId = project.library.stamps[0]?.id || null;
  return project;
}

export async function persistProject(project) {
  const next = normalizeProject(project);
  next.savedAt = new Date().toISOString();
  const json = JSON.stringify(next);
  let localStorageOk = false;
  let indexedDbOk = false;
  let error = null;
  try {
    localStorage.setItem(LS_PROJECT, json);
    writeLegacyKeys(next);
    localStorageOk = true;
  } catch (err) {
    error = err;
  }
  try {
    await idbWrite(next);
    indexedDbOk = true;
  } catch (err) {
    error = error || err;
  }
  return {
    project: next,
    localStorageOk,
    indexedDbOk,
    bytes: json.length,
    error,
  };
}

export async function loadProject() {
  let fromIdb = null;
  let fromLs = null;
  try {
    fromIdb = await idbRead();
  } catch { /* private mode, etc. */ }
  try {
    const raw = localStorage.getItem(LS_PROJECT);
    if (raw) fromLs = JSON.parse(raw);
  } catch { /* corrupt */ }

  const candidates = [fromIdb, fromLs].filter(Boolean).map(normalizeProject);
  if (candidates.length) {
    candidates.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
    return candidates[0];
  }
  return readLegacyProject();
}

export function projectToJson(project) {
  const next = normalizeProject(project);
  next.savedAt = next.savedAt || new Date().toISOString();
  return JSON.stringify(next, null, 2);
}

export function backupFilename(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return `my-handwriting-backup-${day}.json`;
}

export async function wipeStoredProject() {
  localStorage.removeItem(LS_PROJECT);
  localStorage.removeItem(LS_LIBRARY);
  localStorage.removeItem(LS_MACHINE);
  localStorage.removeItem(LS_PLACEMENTS);
  await new Promise((resolve) => {
    if (!("indexedDB" in globalThis)) {
      resolve();
      return;
    }
    const req = indexedDB.deleteDatabase(IDB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

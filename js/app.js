import {
  loadLibrary, addGlyph, removeGlyph, addWord, removeWord, glyphCount,
  addStamp, removeStamp, loadPlacements, savePlacements,
  loadMachine, saveMachine, PRESETS, DEFAULT_MACHINE,
} from "./library.js";
import { dist, simplifyStroke, boundsOfStrokes, fitStrokesToBox } from "./geometry.js";
import { layoutText, normalizeStrokes, strokesToSvg } from "./layout.js";
import { strokesToGcode, calibrationSquareGcode, analyzeBounds } from "./gcode.js";
import { imageDataToStamp, rasterToImageData, normalizeStamp, isShadeMode } from "./trace.js";
import { placementsToStrokes, funRunPlacements, hitTestPlacement } from "./stamps.js";
import {
  loadProject, persistProject, projectToJson, parseIncomingFile,
  mergeLibraries, backupFilename, wipeStoredProject, emptyProject,
} from "./persist.js";

const CHARSET = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  ...`.,;:!?-'"()/`,
];

const GUIDES = {
  left: 0.11,
  cap: 0.2,
  xHeight: 0.4,
  baseline: 0.7,
  descender: 0.88,
};

let library = loadLibrary();
let machine = loadMachine();
let strokes = [];
let currentStroke = null;
let overlay = { img: null, opacity: 0.35 };
let selectedVariant = 0;
let lastCompose = { strokes: [] };
let stampImage = null;
let lastTrace = null;
let doodleStrokes = [];
let doodleCurrent = null;
let placements = loadPlacements();
let selectedStampId = null;
let selectedPlacement = -1;
let dragging = null;
let composeView = { scale: 1, ox: 40, oy: 40 };
let importMode = "replace";
let saveTimer = 0;

const $ = (id) => document.getElementById(id);

function collectProject() {
  return {
    library,
    placements,
    machine,
    compose: {
      text: $("note-text").value,
      xHeight: Number($("x-height").value) || 3.2,
      lineHeight: Number($("line-height").value) || 2.6,
      tracking: Number($("tracking").value) || 0.14,
      wordSpace: Number($("word-space").value) || 0.42,
      seed: Number($("seed").value) || 7,
      jitter: Number($("jitter").value) || 0,
      stampSize: Number($("stamp-size").value) || 28,
      funRunCount: Number($("fun-run-count").value) || 6,
      autoFixExport: $("auto-fix-export").checked,
    },
    capture: {
      mode: $("capture-mode").value,
      glyph: $("glyph-target").value,
      word: $("word-target").value,
      strokes,
    },
    stampsUi: {
      name: $("stamp-name").value,
      source: $("stamp-source").value,
      mode: $("trace-mode").value,
      threshold: Number($("trace-threshold").value),
      join: Number($("trace-join").value),
      density: Number($("trace-density").value) || 4,
      shades: Number($("trace-shades").value) || 32,
      invert: $("trace-invert").checked,
      doodle: doodleStrokes,
    },
    selectedStampId,
  };
}

function applyProject(project) {
  library = project.library;
  placements = project.placements || [];
  machine = { ...DEFAULT_MACHINE, ...project.machine };
  selectedStampId = project.selectedStampId || library.stamps[0]?.id || null;
  selectedPlacement = -1;
  strokes = Array.isArray(project.capture?.strokes) ? project.capture.strokes : [];

  $("note-text").value = project.compose?.text ?? "";
  $("x-height").value = project.compose?.xHeight ?? 3.2;
  $("line-height").value = project.compose?.lineHeight ?? 2.6;
  $("tracking").value = project.compose?.tracking ?? 0.14;
  $("word-space").value = project.compose?.wordSpace ?? 0.42;
  $("seed").value = project.compose?.seed ?? 7;
  $("jitter").value = project.compose?.jitter ?? 55;
  $("stamp-size").value = project.compose?.stampSize ?? 28;
  $("fun-run-count").value = project.compose?.funRunCount ?? 6;
  $("auto-fix-export").checked = project.compose?.autoFixExport !== false;

  $("capture-mode").value = project.capture?.mode || "glyph";
  $("glyph-target").value = project.capture?.glyph || "a";
  $("word-target").value = project.capture?.word || "the";

  $("stamp-name").value = project.stampsUi?.name || "doodle";
  $("stamp-source").value = project.stampsUi?.source === "doodle" ? "doodle" : "photo";
  $("trace-mode").value = project.stampsUi?.mode || "outline";
  $("trace-threshold").value = project.stampsUi?.threshold ?? 145;
  $("trace-join").value = project.stampsUi?.join ?? 1;
  $("trace-density").value = project.stampsUi?.density ?? 4;
  $("trace-shades").value = project.stampsUi?.shades ?? 32;
  $("trace-invert").checked = Boolean(project.stampsUi?.invert);
  doodleStrokes = Array.isArray(project.stampsUi?.doodle) ? project.stampsUi.doodle : [];
  doodleCurrent = null;

  fillMachineForm();
  syncMode();
  syncStampSource();
  renderGrid();
  renderVariants();
  renderStampLists();
  drawCapture();
  drawStampPreview();
  drawCompose();
}

function updateSaveStatus(result) {
  const el = $("save-status");
  if (!el) return;
  if (!result.localStorageOk && !result.indexedDbOk) {
    el.textContent = "Could not save in this browser — download a backup now.";
    el.style.color = "#f2b8b5";
    return;
  }
  const when = new Date(result.project.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const where = [
    result.localStorageOk ? "browser" : null,
    result.indexedDbOk ? "backup copy" : null,
  ].filter(Boolean).join(" + ");
  el.textContent = `Saved ${when} in this ${where}.`;
  el.style.color = "";
}

function autosave(immediate = false) {
  const run = async () => {
    const result = await persistProject(collectProject());
    updateSaveStatus(result);
    if (!result.localStorageOk && !result.indexedDbOk) {
      console.warn("persist failed", result.error);
    }
  };
  if (immediate) {
    clearTimeout(saveTimer);
    return run();
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(run, 280);
}

function setStatus(msg) {
  $("capture-status").textContent = msg;
}

function download(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function guidePx(canvas) {
  return {
    left: canvas.width * GUIDES.left,
    cap: canvas.height * GUIDES.cap,
    xHeight: canvas.height * GUIDES.xHeight,
    baseline: canvas.height * GUIDES.baseline,
    descender: canvas.height * GUIDES.descender,
  };
}

function drawCapture() {
  const canvas = $("capture-canvas");
  const ctx = canvas.getContext("2d");
  const g = guidePx(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#f3ead6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (overlay.img) {
    ctx.save();
    ctx.globalAlpha = overlay.opacity;
    const img = overlay.img;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    ctx.restore();
  }

  ctx.lineWidth = 1;
  const lines = [
    [g.cap, "#8b3a32", "cap"],
    [g.xHeight, "#3f6b58", "x-height"],
    [g.baseline, "#1c1712", "baseline"],
    [g.descender, "#6b5a8c", "descender"],
  ];
  for (const [y, color, label] of lines) {
    ctx.strokeStyle = color;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "18px Georgia, serif";
    ctx.fillText(label, 16, y - 8);
  }

  ctx.strokeStyle = "rgba(28,23,18,0.35)";
  ctx.beginPath();
  ctx.moveTo(g.left, 0);
  ctx.lineTo(g.left, canvas.height);
  ctx.stroke();

  const ink = [...strokes];
  if (currentStroke?.length) ink.push(currentStroke);
  ctx.strokeStyle = "#1c1712";
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of ink) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
    ctx.stroke();
  }
}

const PAGE_MARGIN = 8;

function composeLayoutOptions(xHeightMm) {
  const xh = Number(xHeightMm);
  const jitterAmt = Number($("jitter").value) / 100;
  const paperW = Number(machine.paperWidth) || 170;
  return {
    xHeightMm: xh,
    tracking: Number($("tracking").value) || 0.14,
    wordSpace: Number($("word-space").value) || 0.42,
    lineHeight: Number($("line-height").value) || 2.6,
    maxWidth: Math.max(paperW - PAGE_MARGIN, 20),
    seed: Number($("seed").value) || 1,
    jitter: {
      size: jitterAmt * 0.1,
      rotation: jitterAmt * 4,
      baseline: jitterAmt * 0.14,
    },
    marginLeft: PAGE_MARGIN,
    marginTop: Math.max(6, xh * 0.45),
  };
}

function composeStrokes(xHeightMm = Number($("x-height").value) || 3.2, stampList = placements) {
  const result = layoutText(library, $("note-text").value, composeLayoutOptions(xHeightMm));
  const stampStrokes = placementsToStrokes(library, stampList);
  const strokes = result.strokes.concat(stampStrokes);
  return {
    result,
    stampStrokes,
    strokes,
    bounds: boundsOfStrokes(strokes),
    report: analyzeBounds(strokes, machine),
  };
}

function boundsFit(report) {
  return report && !report.empty && report.ok;
}

function nudgeStampsOntoPage() {
  const w = Number(machine.paperWidth) || 0;
  const h = Number(machine.paperHeight) || 0;
  let moved = 0;
  for (const p of placements) {
    const half = Math.min((p.sizeMm || 28) / 2, Math.max(w, h) / 2);
    const nx = Math.min(Math.max(p.x, half + 2), Math.max(half + 2, w - half - 2));
    const ny = Math.min(Math.max(p.y, half + 2), Math.max(half + 2, h - half - 2));
    if (Math.abs(nx - p.x) > 0.05 || Math.abs(ny - p.y) > 0.05) {
      p.x = nx;
      p.y = ny;
      moved += 1;
    }
    const maxSize = Math.max(8, Math.min(w, h) - 6);
    if ((p.sizeMm || 28) > maxSize) {
      p.sizeMm = maxSize;
      moved += 1;
    }
  }
  return moved;
}

function clampPaperToBed() {
  const pad = 2;
  const bedX = Number(machine.bedX) || 0;
  const bedY = Number(machine.bedY) || 0;
  let originX = Number(machine.originX) || 0;
  let originY = Number(machine.originY) || 0;
  let paperW = Number(machine.paperWidth) || 0;
  let paperH = Number(machine.paperHeight) || 0;
  if (originX < pad) originX = pad;
  if (originY < pad) originY = pad;
  if (originX + paperW > bedX - pad) paperW = Math.max(40, bedX - pad - originX);
  if (machine.yDownIsNegative) {
    if (originY - paperH < pad) paperH = Math.max(40, originY - pad);
  } else if (originY + paperH > bedY - pad) {
    paperH = Math.max(40, bedY - pad - originY);
  }
  $("origin-x").value = originX.toFixed(1);
  $("origin-y").value = originY.toFixed(1);
  $("paper-w").value = paperW.toFixed(1);
  $("paper-h").value = paperH.toFixed(1);
  readMachineForm();
}

function shrinkToFitPage() {
  const moved = nudgeStampsOntoPage();
  const current = Number($("x-height").value) || 3.2;
  const minH = 1.2;
  const trial = (xh) => composeStrokes(xh).report;
  if (boundsFit(trial(current))) {
    if (moved) persistPlacements();
    return { changed: Boolean(moved), xHeight: current };
  }
  if (!boundsFit(trial(minH))) {
    $("x-height").value = minH.toFixed(2);
    for (const p of placements) {
      p.sizeMm = Math.max(8, (p.sizeMm || 28) * 0.82);
    }
    nudgeStampsOntoPage();
    persistPlacements();
    drawCompose();
    if (!boundsFit(composeStrokes(minH).report)) {
      clampPaperToBed();
      drawCompose();
    }
    return { changed: true, xHeight: minH };
  }
  let lo = minH;
  let hi = current;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (boundsFit(trial(mid))) lo = mid;
    else hi = mid;
  }
  $("x-height").value = lo.toFixed(2);
  persistPlacements();
  drawCompose();
  return { changed: true, xHeight: lo };
}

function updateBoundsUi(report, missing) {
  const miss = $("missing-list");
  const status = $("bounds-status");
  const bar = $("bounds-bar");
  const parts = [];
  if (missing?.length) parts.push(`Missing from library: ${missing.join(" ")}`);
  if (lastCompose.strokes.length) {
    parts.push(`${lastCompose.strokes.length} strokes · ${lastCompose.bounds.width.toFixed(0)} × ${lastCompose.bounds.height.toFixed(0)} mm`);
    if (placements.length) parts.push(`${placements.length} stamp${placements.length === 1 ? "" : "s"}`);
  } else parts.push("Nothing to draw yet. Capture letters and/or stamp a drawing.");
  miss.textContent = parts.join(" · ");
  if (!bar || !status) return;
  if (!report || report.empty) {
    bar.dataset.state = "ok";
    status.textContent = "Empty page";
    return;
  }
  bar.dataset.state = report.ok ? "ok" : "bad";
  status.textContent = report.ok ? "On the page and on the bed" : report.summary;
}

function drawCompose() {
  const canvas = $("compose-canvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f3ead6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const packed = composeStrokes();
  lastCompose = {
    strokes: packed.strokes,
    missing: packed.result.missing,
    bounds: packed.bounds,
    report: packed.report,
  };

  const scale = Math.min(
    (canvas.width - 80) / machine.paperWidth,
    (canvas.height - 80) / machine.paperHeight,
  );
  const ox = 40;
  const oy = 40;
  composeView = { scale, ox, oy };
  const pw = machine.paperWidth * scale;
  const ph = machine.paperHeight * scale;

  ctx.fillStyle = "rgba(139, 58, 50, 0.12)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f3ead6";
  ctx.fillRect(ox, oy, pw, ph);
  ctx.strokeStyle = packed.report.ok || packed.report.empty ? "rgba(28,23,18,0.25)" : "#8b3a32";
  ctx.lineWidth = packed.report.ok || packed.report.empty ? 1 : 2;
  ctx.strokeRect(ox, oy, pw, ph);

  const drawInk = (strokeList, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokeList) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(ox + stroke[0].x * scale, oy + stroke[0].y * scale);
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(ox + stroke[i].x * scale, oy + stroke[i].y * scale);
      }
      ctx.stroke();
    }
  };
  drawInk(packed.result.strokes, "#1c1712", Math.max(1.4, scale * 0.35));
  drawInk(packed.stampStrokes, "#5a2c24", Math.max(1.2, scale * 0.32));

  if (selectedPlacement >= 0 && placements[selectedPlacement]) {
    const p = placements[selectedPlacement];
    const half = (p.sizeMm || 28) / 2;
    ctx.strokeStyle = "#8b3a32";
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(
      ox + (p.x - half) * scale,
      oy + (p.y - half) * scale,
      half * 2 * scale,
      half * 2 * scale,
    );
    ctx.setLineDash([]);
  }

  updateBoundsUi(packed.report, packed.result.missing);
}

function renderGrid() {
  const grid = $("glyph-grid");
  grid.innerHTML = "";
  const current = $("glyph-target").value;
  for (const ch of CHARSET) {
    const btn = document.createElement("button");
    btn.className = "glyph-cell";
    const n = glyphCount(library, ch);
    if (n >= 2) btn.classList.add("has-many");
    else if (n === 1) btn.classList.add("has-one");
    if (ch === current) btn.classList.add("active");
    btn.type = "button";
    btn.textContent = ch === " " ? "␣" : ch;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = n || "";
    btn.appendChild(count);
    btn.addEventListener("click", () => {
      $("glyph-target").value = ch;
      $("capture-mode").value = "glyph";
      syncMode();
      renderGrid();
      renderVariants();
    });
    grid.appendChild(btn);
  }
}

function drawThumb(glyph) {
  const c = document.createElement("canvas");
  c.width = 72;
  c.height = 72;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f3ead6";
  ctx.fillRect(0, 0, 72, 72);
  const b = boundsOfStrokes(glyph.strokes);
  const pad = 8;
  const sx = (72 - pad * 2) / Math.max(b.width, 0.4);
  const sy = (72 - pad * 2) / Math.max(b.height, 0.4);
  const s = Math.min(sx, sy);
  ctx.strokeStyle = "#1c1712";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  for (const stroke of glyph.strokes) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    for (let i = 0; i < stroke.length; i++) {
      const x = pad + (stroke[i].x - b.minX) * s;
      const y = 72 - pad - (stroke[i].y - b.minY) * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
}

function renderVariants() {
  const mode = $("capture-mode").value;
  const list = $("variant-list");
  list.innerHTML = "";
  const items = mode === "word"
    ? library.words[$("word-target").value] || []
    : library.glyphs[$("glyph-target").value] || [];
  items.forEach((glyph, index) => {
    const btn = document.createElement("button");
    btn.className = "variant-thumb" + (index === selectedVariant ? " selected" : "");
    btn.type = "button";
    btn.title = "Click to delete this variant";
    btn.appendChild(drawThumb(glyph));
    btn.addEventListener("click", () => {
      if (!confirm("Delete this variant?")) return;
      if (mode === "word") removeWord(library, $("word-target").value, index);
      else removeGlyph(library, $("glyph-target").value, index);
      library = loadLibrary();
      renderGrid();
      renderVariants();
      drawCompose();
    });
    list.appendChild(btn);
  });
  if (!items.length) {
    list.innerHTML = `<p class="hint">No variants saved yet for this ${mode}.</p>`;
  }
}

function syncMode() {
  const mode = $("capture-mode").value;
  $("glyph-target-wrap").hidden = mode !== "glyph";
  $("word-target-wrap").hidden = mode !== "word";
  $("save-capture").textContent = mode === "page" ? "Export traced G-code" : "Save into library";
  renderVariants();
  drawCapture();
}

function saveCapture() {
  const mode = $("capture-mode").value;
  if (!strokes.length) {
    setStatus("Draw something first.");
    return;
  }
  const canvas = $("capture-canvas");
  const simplified = strokes.map((s) => simplifyStroke(s, 1.1));

  if (mode === "page") {
    const mmPerPx = machine.paperWidth / canvas.width;
    const pageStrokes = simplified.map((stroke) =>
      stroke.map((p) => ({ x: p.x * mmPerPx, y: p.y * mmPerPx })),
    );
    lastCompose = { strokes: pageStrokes, missing: [], bounds: boundsOfStrokes(pageStrokes) };
    const { gcode, warnings } = strokesToGcode(pageStrokes, machine, { title: "traced-page" });
    download("traced-page.gcode", gcode);
    setStatus(warnings.length ? `Exported with warnings: ${warnings[0]}` : "Exported traced page G-code.");
    return;
  }

  const glyph = normalizeStrokes(simplified, guidePx(canvas));
  if (mode === "word") {
    const word = $("word-target").value;
    if (!word) { setStatus("Type the word you just wrote."); return; }
    addWord(library, word, glyph);
  } else {
    const ch = $("glyph-target").value;
    if (!ch) { setStatus("Set the character you just wrote."); return; }
    addGlyph(library, ch, glyph);
  }
  library = loadLibrary();
  strokes = [];
  renderGrid();
  renderVariants();
  drawCapture();
  drawCompose();
  setStatus("Saved. Capture another variant — three to five per letter looks far more human.");
  autosave(true);
}

function paperFromEvent(canvas, event) {
  const p = canvasPoint(canvas, event);
  return {
    x: (p.x - composeView.ox) / composeView.scale,
    y: (p.y - composeView.oy) / composeView.scale,
  };
}

function doodleMode() {
  return $("stamp-source").value === "doodle";
}

function syncTraceControls() {
  const doodle = doodleMode();
  const shade = !doodle && isShadeMode($("trace-mode").value);
  document.querySelectorAll(".stamp-binary-only").forEach((el) => { el.hidden = doodle || shade; });
  document.querySelectorAll(".stamp-shade-only").forEach((el) => { el.hidden = doodle || !shade; });
  const label = $("trace-threshold-label");
  if (label) label.textContent = shade ? "Contrast" : "Ink threshold";
  const shadesVal = $("trace-shades-val");
  if (shadesVal && $("trace-shades")) shadesVal.textContent = String($("trace-shades").value);
}

function syncStampSource() {
  const doodle = doodleMode();
  document.querySelectorAll(".stamp-photo-only").forEach((el) => { el.hidden = doodle; });
  $("stamp-doodle-tools").hidden = !doodle;
  syncTraceControls();
  if (doodle) {
    $("stamp-status").textContent = doodleStrokes.length
      ? `${doodleStrokes.length} stroke${doodleStrokes.length === 1 ? "" : "s"}. Save, then stamp them onto Compose.`
      : "Draw on the paper with a stylus or mouse. Stroke order is how the pen will move.";
  } else if (lastTrace?.count) {
    $("stamp-status").textContent = `${lastTrace.count} paths ready. Save, then stamp them onto Compose.`;
  } else {
    $("stamp-status").textContent = isShadeMode($("trace-mode").value)
      ? "Load a photo. Spiral / hatch / squiggle / rings turn gray values into pen shading."
      : "Load a photo of a drawing on plain paper. Darker marks become paths.";
  }
  drawStampPreview();
}

function doodleInk() {
  const ink = [...doodleStrokes];
  if (doodleCurrent?.length) ink.push(doodleCurrent);
  return ink;
}

function retraceStamp() {
  if (!stampImage) return;
  const mode = $("trace-mode").value;
  const shade = isShadeMode(mode);
  lastTrace = imageDataToStamp(rasterToImageData(stampImage, shade ? 640 : 460), {
    threshold: Number($("trace-threshold").value),
    invert: $("trace-invert").checked,
    mode,
    joinGaps: Number($("trace-join").value),
    density: Number($("trace-density").value) || 4,
    shades: Number($("trace-shades").value) || 32,
    minBlob: 18,
    simplify: shade ? 0.7 : 1.5,
  });
  if (!doodleMode()) {
    drawStampPreview();
    $("stamp-status").textContent = lastTrace.count
      ? `${lastTrace.count} paths ready${shade ? ` · ${Number($("trace-shades").value) || 32} shades` : ""}. Save, then stamp them onto Compose.`
      : shade
        ? "No shade paths — raise Contrast, raise density, or invert."
        : "No ink found — try a lower threshold, invert, or a higher-contrast photo.";
  }
}

function drawDoodlePreview() {
  const canvas = $("stamp-canvas");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f3ead6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(70, 90, 140, 0.18)";
  ctx.lineWidth = 1;
  for (let y = 48; y < canvas.height; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  const ink = doodleInk();
  if (!ink.length) {
    ctx.fillStyle = "#4a4036";
    ctx.font = "28px Georgia, serif";
    ctx.fillText("Draw a doodle here.", 48, canvas.height / 2);
  }
  ctx.strokeStyle = "#1c1712";
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of ink) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
    ctx.stroke();
  }
}

function drawStampPreview() {
  if (doodleMode()) {
    drawDoodlePreview();
    return;
  }
  const canvas = $("stamp-canvas");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f3ead6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!stampImage) {
    ctx.fillStyle = "#4a4036";
    ctx.font = "28px Georgia, serif";
    ctx.fillText("Drop a photo of a drawing here.", 48, canvas.height / 2);
    return;
  }
  if (!lastTrace) return;
  const { preview, w, h, strokes, previewKind } = lastTrace;
  const split = canvas.width / 2;
  const s = Math.min(split / w, canvas.height / h) * 0.92;
  const ox = (split - w * s) / 2;
  const oy = (canvas.height - h * s) / 2;
  const img = ctx.createImageData(w, h);
  const gray = previewKind === "gray";
  for (let i = 0; i < w * h; i++) {
    if (gray) {
      const t = (preview[i] || 0) / 255;
      img.data[i * 4] = 243 * (1 - t) + 28 * t;
      img.data[i * 4 + 1] = 234 * (1 - t) + 23 * t;
      img.data[i * 4 + 2] = 214 * (1 - t) + 18 * t;
      img.data[i * 4 + 3] = 255;
    } else {
      const on = preview[i];
      img.data[i * 4] = on ? 28 : 243;
      img.data[i * 4 + 1] = on ? 23 : 234;
      img.data[i * 4 + 2] = on ? 18 : 214;
      img.data[i * 4 + 3] = 255;
    }
  }
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  tmp.getContext("2d").putImageData(img, 0, 0);
  ctx.drawImage(tmp, ox, oy, w * s, h * s);

  ctx.strokeStyle = "rgba(28,23,18,0.2)";
  ctx.beginPath();
  ctx.moveTo(split, 0);
  ctx.lineTo(split, canvas.height);
  ctx.stroke();

  const b = boundsOfStrokes(strokes);
  const span = Math.max(b.width, b.height, 0.001);
  const ps = Math.min((canvas.width - split - 40) / span, (canvas.height - 40) / span);
  const px = split + 20;
  const py = 20;
  ctx.strokeStyle = "#1c1712";
  ctx.lineWidth = previewKind === "gray" ? 1.15 : 2;
  ctx.lineCap = "round";
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(px + stroke[0].x * ps, py + stroke[0].y * ps);
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(px + stroke[i].x * ps, py + stroke[i].y * ps);
    ctx.stroke();
  }
  ctx.fillStyle = "#4a4036";
  ctx.font = "16px Georgia, serif";
  ctx.fillText(previewKind === "gray" ? "grayscale" : "ink mask", 24, 28);
  ctx.fillText("pen paths", split + 20, 28);
}

function loadStampFile(file) {
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    stampImage = img;
    $("stamp-source").value = "photo";
    if ($("stamp-name").value === "doodle") {
      $("stamp-name").value = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "doodle";
    }
    syncStampSource();
    retraceStamp();
  };
  img.src = URL.createObjectURL(file);
}

function renderStampLists() {
  const makeThumb = (stamp, onClick, selected) => {
    const btn = document.createElement("button");
    btn.className = "variant-thumb" + (selected ? " selected" : "");
    btn.type = "button";
    btn.title = stamp.name || "stamp";
    const c = document.createElement("canvas");
    c.width = 72;
    c.height = 72;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#f3ead6";
    ctx.fillRect(0, 0, 72, 72);
    const b = boundsOfStrokes(stamp.strokes);
    const pad = 8;
    const s = Math.min((72 - pad * 2) / Math.max(b.width, 0.01), (72 - pad * 2) / Math.max(b.height, 0.01));
    ctx.strokeStyle = "#1c1712";
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";
    for (const stroke of stamp.strokes) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < stroke.length; i++) {
        const x = pad + (stroke[i].x - b.minX) * s;
        const y = pad + (stroke[i].y - b.minY) * s;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    btn.appendChild(c);
    const cap = document.createElement("span");
    cap.className = "stamp-caption";
    cap.textContent = stamp.name || "stamp";
    btn.appendChild(cap);
    btn.addEventListener("click", onClick);
    return btn;
  };

  const box = $("stamp-list");
  const composeBox = $("compose-stamp-list");
  box.innerHTML = "";
  composeBox.innerHTML = "";
  const stamps = library.stamps || [];
  if (!stamps.length) {
    box.innerHTML = `<p class="hint">No stamps yet.</p>`;
    composeBox.innerHTML = `<p class="hint">Draw or scan a stamp first.</p>`;
    return;
  }
  if (!selectedStampId || !stamps.some((s) => s.id === selectedStampId)) {
    selectedStampId = stamps[0].id;
  }
  for (const stamp of stamps) {
    box.appendChild(makeThumb(stamp, () => {
      if (selectedStampId === stamp.id && confirm(`Delete stamp “${stamp.name}”?`)) {
        removeStamp(library, stamp.id);
        library = loadLibrary();
        placements = placements.filter((p) => p.stampId !== stamp.id);
        savePlacements(placements);
        selectedStampId = library.stamps[0]?.id || null;
        renderStampLists();
        drawCompose();
        autosave(true);
        return;
      }
      selectedStampId = stamp.id;
      renderStampLists();
    }, stamp.id === selectedStampId));
    composeBox.appendChild(makeThumb(stamp, () => {
      selectedStampId = stamp.id;
      renderStampLists();
    }, stamp.id === selectedStampId));
  }
}

function persistPlacements() {
  savePlacements(placements);
  drawCompose();
  autosave();
}

function wireComposeCanvas() {
  const canvas = $("compose-canvas");
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const paper = paperFromEvent(canvas, e);
    const hit = hitTestPlacement(library, placements, paper.x, paper.y);
    if (hit >= 0) {
      selectedPlacement = hit;
      dragging = { i: hit, dx: paper.x - placements[hit].x, dy: paper.y - placements[hit].y };
      drawCompose();
      return;
    }
    const stamp = library.stamps?.find((s) => s.id === selectedStampId);
    if (!stamp) return;
    if (paper.x < 0 || paper.y < 0 || paper.x > machine.paperWidth || paper.y > machine.paperHeight) return;
    placements.push({
      id: `p_${Date.now()}`,
      stampId: stamp.id,
      x: paper.x,
      y: paper.y,
      sizeMm: Number($("stamp-size").value) || 28,
      rotation: (Math.random() - 0.5) * 16,
    });
    selectedPlacement = placements.length - 1;
    persistPlacements();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging == null) return;
    const paper = paperFromEvent(canvas, e);
    const p = placements[dragging.i];
    if (!p) return;
    p.x = paper.x - dragging.dx;
    p.y = paper.y - dragging.dy;
    drawCompose();
  });
  const endDrag = () => {
    if (dragging != null) persistPlacements();
    dragging = null;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
}

function wireStampCanvas() {
  const canvas = $("stamp-canvas");
  canvas.addEventListener("pointerdown", (e) => {
    if (!doodleMode()) return;
    canvas.setPointerCapture(e.pointerId);
    doodleCurrent = [canvasPoint(canvas, e)];
    drawStampPreview();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!doodleCurrent) return;
    const p = canvasPoint(canvas, e);
    const last = doodleCurrent[doodleCurrent.length - 1];
    if (dist(p, last) >= 1.6) doodleCurrent.push(p);
    drawStampPreview();
  });
  const end = () => {
    if (doodleCurrent && doodleCurrent.length > 1) doodleStrokes.push(doodleCurrent);
    doodleCurrent = null;
    if (doodleMode()) {
      syncStampSource();
      autosave();
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

function saveStamp() {
  let stamp;
  if (doodleMode()) {
    const simplified = doodleStrokes
      .map((s) => simplifyStroke(s, 1.2))
      .filter((s) => s.length >= 2);
    if (!simplified.length) {
      $("stamp-status").textContent = "Draw a doodle first.";
      return;
    }
    const norm = normalizeStamp(simplified);
    stamp = {
      id: `stamp_${Date.now()}`,
      name: $("stamp-name").value.trim() || "doodle",
      strokes: norm.strokes,
      width: norm.width,
      height: norm.height,
    };
  } else {
    if (!lastTrace?.count) {
      $("stamp-status").textContent = "Trace a drawing first.";
      return;
    }
    stamp = {
      id: `stamp_${Date.now()}`,
      name: $("stamp-name").value.trim() || "doodle",
      strokes: lastTrace.strokes,
      width: lastTrace.width,
      height: lastTrace.height,
    };
  }
  addStamp(library, stamp);
  library = loadLibrary();
  selectedStampId = stamp.id;
  renderStampLists();
  $("stamp-status").textContent = `Saved “${stamp.name}”. Open Compose, then click the page or Fun run.`;
  autosave(true);
}

function wireCapture() {
  const canvas = $("capture-canvas");
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    currentStroke = [canvasPoint(canvas, e)];
    drawCapture();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!currentStroke) return;
    const p = canvasPoint(canvas, e);
    const last = currentStroke[currentStroke.length - 1];
    if (dist(p, last) >= 1.6) currentStroke.push(p);
    drawCapture();
  });
  const end = () => {
    if (currentStroke && currentStroke.length > 1) strokes.push(currentStroke);
    currentStroke = null;
    drawCapture();
    autosave();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

function isA1() {
  return $("preset").value === "bambu_a1";
}

function syncMachineHelp() {
  const a1 = isA1();
  $("a1-help").hidden = !a1;
  $("generic-machine-hint").hidden = a1;
  $("pen-z-wrap").hidden = !a1;
}

function fillMachineForm() {
  const preset = $("preset");
  preset.innerHTML = Object.entries(PRESETS).map(([id, p]) =>
    `<option value="${id}">${p.label}</option>`,
  ).join("");
  preset.value = machine.preset in PRESETS ? machine.preset : "marlin";
  $("bed-x").value = machine.bedX;
  $("bed-y").value = machine.bedY;
  $("origin-x").value = machine.originX;
  $("origin-y").value = machine.originY;
  $("paper-w").value = machine.paperWidth;
  $("paper-h").value = machine.paperHeight;
  $("z-up").value = machine.zUp;
  $("z-down").value = machine.zDown;
  $("travel-feed").value = machine.travelFeed;
  $("write-feed").value = machine.writeFeed;
  $("y-dir").value = machine.yDownIsNegative ? "neg" : "pos";
  $("home-xy").checked = machine.homeXY;
  $("mirror-x").checked = machine.xMirror ?? (machine.flavor === "bambu_a1" || machine.preset === "bambu_a1");
  $("pen-z-offset").value = machine.penZOffset ?? 20;
  syncMachineHelp();
}

function applyPresetToForm(p) {
  $("bed-x").value = p.bedX;
  $("bed-y").value = p.bedY;
  $("origin-x").value = p.originX;
  $("origin-y").value = p.originY;
  if (p.paperWidth != null) $("paper-w").value = p.paperWidth;
  if (p.paperHeight != null) $("paper-h").value = p.paperHeight;
  if (p.zUp != null) $("z-up").value = p.zUp;
  if (p.zDown != null) $("z-down").value = p.zDown;
  if (p.travelFeed != null) $("travel-feed").value = p.travelFeed;
  if (p.writeFeed != null) $("write-feed").value = p.writeFeed;
  if (p.yDownIsNegative != null) $("y-dir").value = p.yDownIsNegative ? "neg" : "pos";
  if (p.homeXY != null) $("home-xy").checked = p.homeXY;
  $("mirror-x").checked = Boolean(p.xMirror);
  if (p.penZOffset != null) $("pen-z-offset").value = p.penZOffset;
}

function readMachineForm() {
  machine = {
    ...DEFAULT_MACHINE,
    ...machine,
    preset: $("preset").value,
    bedX: Number($("bed-x").value),
    bedY: Number($("bed-y").value),
    originX: Number($("origin-x").value),
    originY: Number($("origin-y").value),
    paperWidth: Number($("paper-w").value),
    paperHeight: Number($("paper-h").value),
    zUp: Number($("z-up").value),
    zDown: Number($("z-down").value),
    travelFeed: Number($("travel-feed").value),
    writeFeed: Number($("write-feed").value),
    yDownIsNegative: $("y-dir").value === "neg",
    homeXY: $("home-xy").checked,
    xMirror: $("mirror-x").checked,
    flavor: PRESETS[$("preset").value]?.flavor || "marlin",
    penZOffset: Number($("pen-z-offset").value) || 20,
  };
  saveMachine(machine);
  syncMachineHelp();
  autosave();
}

function exportNote(dryRun) {
  drawCompose();
  if (!lastCompose.strokes.length) {
    alert("Nothing to export. Capture letters and/or stamp a drawing first.");
    return;
  }
  let strokes = lastCompose.strokes;
  let report = lastCompose.report || analyzeBounds(strokes, machine);
  if (!report.ok) {
    const auto = $("auto-fix-export")?.checked !== false;
    if (auto) {
      if (report.pageOffBed) clampPaperToBed();
      shrinkToFitPage();
      drawCompose();
      strokes = lastCompose.strokes;
      report = lastCompose.report || analyzeBounds(strokes, machine);
      if (!report.ok) {
        strokes = fitStrokesToBox(strokes, {
          minX: 0,
          minY: 0,
          maxX: machine.paperWidth,
          maxY: machine.paperHeight,
        });
        report = analyzeBounds(strokes, machine);
      }
    } else if (!confirm(`This G-code goes out of bounds:\n${report.summary}\n\nDownload anyway?`)) {
      return;
    }
  }
  const { gcode, warnings } = strokesToGcode(strokes, machine, {
    dryRun,
    title: dryRun ? "note-dry-run" : "note",
  });
  download(dryRun ? "note-dry-run.gcode" : "note.gcode", gcode);
  if (warnings.length && !$("auto-fix-export")?.checked) {
    alert(`Exported, but check bed bounds:\n${warnings.slice(0, 6).join("\n")}`);
  } else if (warnings.length) {
    setStatus(`Downloaded with auto-fit. ${warnings[0]}`);
  }
}

function initNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((b) => b.removeAttribute("aria-current"));
      btn.setAttribute("aria-current", "page");
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      $(`panel-${btn.dataset.panel}`).classList.add("active");
      if (btn.dataset.panel === "compose") drawCompose();
      if (btn.dataset.panel === "stamps") drawStampPreview();
    });
  });
}

function init() {
  initNav();
  wireCapture();
  wireStampCanvas();
  wireComposeCanvas();

  loadProject().then((project) => {
    applyProject(project);
    autosave(true);
  }).catch((err) => {
    console.warn(err);
    fillMachineForm();
    syncStampSource();
    renderGrid();
    renderVariants();
    renderStampLists();
    drawCapture();
    drawStampPreview();
    drawCompose();
  });

  $("capture-mode").addEventListener("change", () => { syncMode(); autosave(); });
  $("glyph-target").addEventListener("input", () => {
    if ($("glyph-target").value.length > 1) {
      $("glyph-target").value = $("glyph-target").value.slice(-1);
    }
    renderGrid();
    renderVariants();
    autosave();
  });
  $("word-target").addEventListener("input", () => { renderVariants(); autosave(); });
  $("undo-stroke").addEventListener("click", () => { strokes.pop(); drawCapture(); autosave(); });
  $("clear-strokes").addEventListener("click", () => { strokes = []; drawCapture(); autosave(); });
  $("save-capture").addEventListener("click", saveCapture);
  $("load-overlay").addEventListener("click", () => $("overlay-file").click());
  $("overlay-file").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => { overlay.img = img; drawCapture(); };
    img.src = URL.createObjectURL(file);
  });
  $("clear-overlay").addEventListener("click", () => { overlay.img = null; drawCapture(); });
  $("overlay-opacity").addEventListener("input", (e) => {
    overlay.opacity = Number(e.target.value) / 100;
    drawCapture();
  });

  ["note-text", "x-height", "line-height", "tracking", "word-space", "seed", "jitter"].forEach((id) => {
    $(id).addEventListener("input", () => { drawCompose(); autosave(); });
  });
  $("load-stamp-image").addEventListener("click", () => $("stamp-file").click());
  $("stamp-camera").addEventListener("click", () => $("stamp-camera-file").click());
  $("stamp-file").addEventListener("change", (e) => loadStampFile(e.target.files?.[0]));
  $("stamp-camera-file").addEventListener("change", (e) => loadStampFile(e.target.files?.[0]));
  $("stamp-canvas").addEventListener("dragover", (e) => e.preventDefault());
  $("stamp-canvas").addEventListener("drop", (e) => {
    e.preventDefault();
    loadStampFile(e.dataTransfer.files?.[0]);
  });
  ["trace-mode", "trace-threshold", "trace-join", "trace-density", "trace-shades", "trace-invert"].forEach((id) => {
    const run = (immediate) => {
      syncTraceControls();
      if (immediate || id === "trace-mode" || id === "trace-invert") retraceStamp();
      else {
        clearTimeout(run._t);
        run._t = setTimeout(retraceStamp, 60);
      }
      autosave();
    };
    $(id).addEventListener("input", () => run(false));
    $(id).addEventListener("change", () => run(true));
  });
  $("save-stamp").addEventListener("click", saveStamp);
  $("stamp-source").addEventListener("change", () => { syncStampSource(); autosave(); });
  $("undo-doodle").addEventListener("click", () => {
    doodleStrokes.pop();
    doodleCurrent = null;
    syncStampSource();
    autosave();
  });
  $("clear-doodle").addEventListener("click", () => {
    doodleStrokes = [];
    doodleCurrent = null;
    syncStampSource();
    autosave();
  });
  $("fun-run").addEventListener("click", () => {
    const stamp = library.stamps?.find((s) => s.id === selectedStampId);
    if (!stamp) {
      alert("Save a stamp first.");
      return;
    }
    const row = funRunPlacements(stamp, {
      paperWidth: machine.paperWidth,
      paperHeight: machine.paperHeight,
      count: Number($("fun-run-count").value) || 6,
      seed: (Number($("seed").value) || 1) + placements.length,
      sizeMm: Number($("stamp-size").value) || 28,
    });
    placements.push(...row);
    nudgeStampsOntoPage();
    persistPlacements();
  });
  $("clear-stamps").addEventListener("click", () => {
    placements = [];
    selectedPlacement = -1;
    persistPlacements();
  });
  $("stamp-name").addEventListener("input", () => autosave());
  $("fun-run-count").addEventListener("input", () => autosave());
  $("stamp-size").addEventListener("change", () => {
    if (selectedPlacement >= 0 && placements[selectedPlacement]) {
      placements[selectedPlacement].sizeMm = Number($("stamp-size").value) || 28;
      persistPlacements();
    } else {
      autosave();
    }
  });
  $("export-gcode").addEventListener("click", () => exportNote(false));
  $("export-dry").addEventListener("click", () => exportNote(true));
  $("fit-page").addEventListener("click", () => {
    const out = shrinkToFitPage();
    setStatus(out.changed ? `x-height is now ${out.xHeight.toFixed(2)} mm so the note stays on the page.` : "Already on the page.");
    autosave();
  });
  $("nudge-stamps").addEventListener("click", () => {
    const n = nudgeStampsOntoPage();
    persistPlacements();
    setStatus(n ? `Moved ${n} stamp${n === 1 ? "" : "s"} onto the page.` : "Stamps are already on the page.");
  });
  $("clamp-paper").addEventListener("click", () => {
    clampPaperToBed();
    drawCompose();
    setStatus("Writable area clipped to the bed.");
  });
  $("auto-fix-export").addEventListener("change", () => autosave());
  $("export-svg").addEventListener("click", () => {
    drawCompose();
    download("note.svg", strokesToSvg(lastCompose.strokes), "image/svg+xml");
  });

  $("preset").addEventListener("change", () => {
    const p = PRESETS[$("preset").value];
    if (!p) return;
    applyPresetToForm(p);
    readMachineForm();
    drawCompose();
  });
  ["bed-x", "bed-y", "origin-x", "origin-y", "paper-w", "paper-h", "z-up", "z-down", "travel-feed", "write-feed", "y-dir", "home-xy", "mirror-x", "pen-z-offset"].forEach((id) => {
    $(id).addEventListener("change", () => { readMachineForm(); drawCompose(); });
  });
  $("save-machine").addEventListener("click", () => { readMachineForm(); setStatus("Printer settings saved."); });
  $("cal-square").addEventListener("click", () => {
    readMachineForm();
    download("calibration-20mm.gcode", calibrationSquareGcode(machine).gcode);
  });

  $("export-project").addEventListener("click", async () => {
    const result = await persistProject(collectProject());
    updateSaveStatus(result);
    download(backupFilename(), projectToJson(result.project), "application/json");
  });
  $("import-project").addEventListener("click", () => {
    importMode = "replace";
    $("import-file").click();
  });
  $("merge-project").addEventListener("click", () => {
    importMode = "merge";
    $("import-file").click();
  });
  $("reset-all").addEventListener("click", async () => {
    const ok = confirm("Reset all? This deletes every letter, word, stamp, note, and printer setting saved in this browser. Download a backup first if you might want it back.");
    if (!ok) return;
    overlay = { img: null, opacity: overlay.opacity };
    stampImage = null;
    lastTrace = null;
    doodleStrokes = [];
    doodleCurrent = null;
    selectedPlacement = -1;
    dragging = null;
    await wipeStoredProject();
    applyProject(emptyProject());
    await autosave(true);
    setStatus("Everything in this browser was cleared.");
    $("save-status").textContent = "Reset complete. This browser is empty.";
  });
  $("import-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const incoming = parseIncomingFile(await file.text());
      if (importMode === "merge") {
        library = mergeLibraries(library, incoming.project.library);
        selectedStampId = library.stamps.at(-1)?.id || selectedStampId;
        renderGrid();
        renderVariants();
        renderStampLists();
        drawCompose();
        await autosave(true);
        setStatus("Merged letters and stamps from backup.");
        $("save-status").textContent = `Merged ${file.name} — current note kept.`;
        return;
      }
      if (!confirm("Replace everything saved in this browser with this backup? You can Merge instead if you only want to add letters/stamps.")) {
        return;
      }
      applyProject(incoming.project);
      await autosave(true);
      setStatus("Backup restored.");
    } catch (err) {
      alert("Could not import that file: " + err.message);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if ($("panel-stamps").classList.contains("active") && doodleMode()) {
        doodleStrokes.pop();
        doodleCurrent = null;
        syncStampSource();
        autosave();
      } else {
        strokes.pop();
        drawCapture();
        autosave();
      }
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selectedPlacement >= 0) {
      e.preventDefault();
      placements.splice(selectedPlacement, 1);
      selectedPlacement = -1;
      persistPlacements();
    }
  });

  window.addEventListener("pagehide", () => { persistProject(collectProject()); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistProject(collectProject());
  });
}

init();

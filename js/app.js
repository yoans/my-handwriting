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
import { SAMPLE_NOTE } from "./demo.js";
import {
  CUSTOM_FONT_ID, DEFAULT_FONT_ID, SAMPLE_FONTS,
  composeLibrary, stripDemoInk, hasUserGlyphs,
} from "./fonts.js";
import { renderHomeDashboard } from "./home.js";

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

function migrateShadeDensity(ui = {}) {
  const d = Number(ui.density);
  if (!Number.isFinite(d)) return 12;
  if (ui.thicken == null && ui.smooth == null && d >= 1 && d <= 8) {
    return Math.max(1, Math.min(24, Math.round(4 + (d - 1) * (20 / 7))));
  }
  return Math.max(1, Math.min(24, d));
}

function composeNumber(value, fallback) {
  const n = Number(value);
  return value == null || value === "" || !Number.isFinite(n) ? fallback : n;
}

function syncComposeLayoutLabels() {
  const pairs = [
    ["x-height-val", "x-height", 1],
    ["line-height-val", "line-height", 2],
    ["tracking-val", "tracking", 2],
    ["word-space-val", "word-space", 2],
    ["jitter-val", "jitter", 0],
  ];
  for (const [labelId, inputId, digits] of pairs) {
    const label = $(labelId);
    const input = $(inputId);
    if (!label || !input) continue;
    const n = Number(input.value);
    label.textContent = Number.isFinite(n) ? n.toFixed(digits) : input.value;
  }
  const size = Number($("x-height").value);
  const line = size * Number($("line-height").value);
  const letter = size * Number($("tracking").value);
  const word = letter + size * Number($("word-space").value);
  $("line-spacing-help").textContent = `${line.toFixed(1)} mm between writing baselines.`;
  $("letter-spacing-help").textContent = `About ${letter.toFixed(1)} mm between letter strokes. Letters are fitted automatically.`;
  $("word-spacing-help").textContent = `${word.toFixed(1)} mm between words, including letter spacing.`;
  for (const [id, value] of [["x-height", size], ["line-height", line], ["tracking", letter], ["word-space", word]]) {
    $(id).setAttribute("aria-valuetext", `${value.toFixed(1)} millimeters`);
  }
}

function collectProject() {
  return {
    library,
    placements,
    machine,
    compose: {
      text: $("note-text").value,
      xHeight: Number($("x-height").value) || 4.5,
      lineHeight: Number($("line-height").value) || 3,
      tracking: composeNumber($("tracking").value, 0.28),
      wordSpace: Number($("word-space").value) || 0.95,
      seed: Number($("seed").value) || 7,
      jitter: Number($("jitter").value) || 0,
      stampSize: Number($("stamp-size").value) || 28,
      funRunCount: Number($("fun-run-count").value) || 6,
      autoFixExport: $("auto-fix-export").checked,
      fontId: $("note-font")?.value || DEFAULT_FONT_ID,
    },
    capture: {
      mode: $("capture-mode").value,
      glyph: $("glyph-target").value,
      word: $("word-target").value,
      strokes,
    },
    stampsUi: {
      name: $("stamp-name").value,
      doodleName: $("doodle-stamp-name")?.value || "doodle",
      source: $("stamp-source")?.value || "photo",
      mode: $("trace-mode").value,
      threshold: Number($("trace-threshold").value),
      join: Number($("trace-join").value),
      thicken: Number($("trace-thicken").value) || 0,
      specks: Number($("trace-specks").value) || 18,
      smooth: Number($("trace-smooth").value) || 8,
      scribble: Number($("trace-scribble").value) || 5,
      density: Number($("trace-density").value) || 12,
      shades: Number($("trace-shades").value) || 32,
      invert: $("trace-invert").checked,
      doodle: doodleStrokes,
    },
    selectedStampId,
  };
}

function applyProject(project) {
  library = stripDemoInk(project.library || {});
  placements = project.placements || [];
  machine = { ...DEFAULT_MACHINE, ...project.machine };
  selectedStampId = project.selectedStampId || library.stamps[0]?.id || null;
  selectedPlacement = -1;
  strokes = Array.isArray(project.capture?.strokes) ? project.capture.strokes : [];

  fillFontSelect();
  const savedFont = project.compose?.fontId;
  const fontOk = savedFont === CUSTOM_FONT_ID || SAMPLE_FONTS.some((f) => f.id === savedFont);
  $("note-font").value = fontOk ? savedFont : hasUserGlyphs(library) ? CUSTOM_FONT_ID : DEFAULT_FONT_ID;

  $("note-text").value = project.compose?.text ?? "";
  if (!project.savedAt && !$("note-text").value.trim()) {
    $("note-text").value = SAMPLE_NOTE;
  }
  $("x-height").value = composeNumber(project.compose?.xHeight, 4.5);
  $("line-height").value = composeNumber(project.compose?.lineHeight, 3);
  $("tracking").value = composeNumber(project.compose?.tracking, 0.28);
  $("word-space").value = composeNumber(project.compose?.wordSpace, 0.95);
  $("seed").value = project.compose?.seed ?? 7;
  $("jitter").value = project.compose?.jitter ?? 55;
  syncComposeLayoutLabels();
  $("stamp-size").value = project.compose?.stampSize ?? 28;
  $("fun-run-count").value = project.compose?.funRunCount ?? 6;
  $("auto-fix-export").checked = project.compose?.autoFixExport !== false;

  $("capture-mode").value = project.capture?.mode || "glyph";
  $("glyph-target").value = project.capture?.glyph || "a";
  $("word-target").value = project.capture?.word || "the";

  $("stamp-name").value = project.stampsUi?.name || "photo";
  if ($("doodle-stamp-name")) $("doodle-stamp-name").value = project.stampsUi?.doodleName || "doodle";
  setStampTab(project.stampsUi?.source === "doodle" ? "doodle" : "photo", { quiet: true });
  const savedMode = project.stampsUi?.mode || "rings";
  $("trace-mode").value = savedMode;
  $("trace-threshold").value = project.stampsUi?.threshold ?? 145;
  $("trace-join").value = project.stampsUi?.join ?? 1;
  $("trace-thicken").value = project.stampsUi?.thicken ?? 0;
  $("trace-specks").value = project.stampsUi?.specks ?? 18;
  $("trace-smooth").value = project.stampsUi?.smooth ?? 8;
  $("trace-scribble").value = project.stampsUi?.scribble ?? 5;
  $("trace-density").value = migrateShadeDensity(project.stampsUi);
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
  syncFontBanners();
}

function fillFontSelect() {
  const sel = $("note-font");
  if (!sel || sel.dataset.ready === "1") return;
  sel.innerHTML = "";
  const custom = document.createElement("option");
  custom.value = CUSTOM_FONT_ID;
  custom.textContent = "Your handwriting";
  sel.appendChild(custom);
  for (const font of SAMPLE_FONTS) {
    const opt = document.createElement("option");
    opt.value = font.id;
    opt.textContent = font.name;
    sel.appendChild(opt);
  }
  sel.dataset.ready = "1";
}

function syncFontBanners() {
  const fontId = $("note-font")?.value || DEFAULT_FONT_ID;
  const capture = $("demo-banner-capture");
  const compose = $("demo-banner-compose");
  if (capture) {
    capture.hidden = hasUserGlyphs(library);
    capture.textContent = "This grid is only letters you draw. Sample handwriting lives on the Note tab.";
  }
  if (compose) {
    if (fontId === CUSTOM_FONT_ID) {
      compose.hidden = hasUserGlyphs(library);
      compose.textContent = "No letters saved yet. Draw some under Your handwriting, or pick a sample handwriting above.";
    } else {
      const name = SAMPLE_FONTS.find((f) => f.id === fontId)?.name || "sample handwriting";
      compose.hidden = false;
      compose.textContent = `Using ${name}. Your captured letters stay under Your handwriting — pick Your handwriting to use them.`;
    }
  }
}

const PANELS = ["home", "capture", "stamps", "compose", "machine"];

function panelFromHash() {
  const name = location.hash.replace(/^#/, "");
  return PANELS.includes(name) ? name : "home";
}

function goToPanel(name, opts = {}) {
  if (!PANELS.includes(name)) name = "home";
  document.querySelectorAll(".nav-btn[data-panel]").forEach((b) => {
    if (b.dataset.panel === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${name}`));
  document.querySelector(".app-shell")?.classList.toggle("on-home", name === "home");
  if (!opts.fromHash) {
    const heading = document.querySelector(`#panel-${name} h1, #panel-${name} h2`);
    heading?.setAttribute("tabindex", "-1");
    heading?.focus();
  }
  if (name === "home") renderHomeDashboard();
  if (name === "compose") drawCompose();
  if (name === "stamps") {
    if (opts.doodle) setStampTab("doodle");
    else syncStampTab();
    drawStampPreview();
    drawDoodlePreview();
  }
  if (!opts.fromHash) {
    const hash = `#${name}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }
}

function updateSaveStatus(result) {
  const el = $("save-status");
  if (!el) return;
  if (!result.localStorageOk && !result.indexedDbOk) {
    el.textContent = "Could not save in this browser — download a backup now.";
    el.style.color = "#fda4af";
    return;
  }
  const when = new Date(result.project.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const where = [
    result.localStorageOk ? "browser" : null,
    result.indexedDbOk ? "second local copy" : null,
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
  const target = document.querySelector("#panel-compose.active") ? $("compose-status") : $("capture-status");
  target.textContent = msg;
}

function download(filename, data, mime = "text/plain") {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
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
    [g.cap, "#6366f1", "tall letters"],
    [g.xHeight, "#06b6d4", "small letters"],
    [g.baseline, "#1c1712", "baseline"],
    [g.descender, "#a78bfa", "tails"],
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
    ctx.font = "18px 'Space Grotesk', sans-serif";
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
  const xh = Number(xHeightMm) || Number($("x-height").value) || 4.5;
  const jitterAmt = Number($("jitter").value) / 100;
  const paperW = Number(machine.paperWidth) || 170;
  return {
    xHeightMm: xh,
    tracking: composeNumber($("tracking").value, 0.28),
    wordSpace: Number($("word-space").value) || 0.95,
    lineHeight: Number($("line-height").value) || 3,
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

function composeStrokes(xHeightMm = Number($("x-height").value) || 4.5, stampList = placements) {
  const hand = composeLibrary(library, $("note-font")?.value || DEFAULT_FONT_ID);
  const result = layoutText(hand, $("note-text").value, composeLayoutOptions(xHeightMm));
  const stampStrokes = placementsToStrokes(hand, stampList);
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
  const current = Number($("x-height").value) || 4.5;
  const minH = Number($("x-height").min);
  const trial = (xh) => composeStrokes(xh).report;
  if (boundsFit(trial(current))) {
    if (moved) persistPlacements();
    return { changed: Boolean(moved), xHeight: current };
  }
  if (!boundsFit(trial(minH))) {
    $("x-height").value = minH.toFixed(1);
    syncComposeLayoutLabels();
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
  // Round down so the last line cannot overflow again through rounding.
  $("x-height").value = (Math.floor(lo * 10) / 10).toFixed(1);
  syncComposeLayoutLabels();
  persistPlacements();
  drawCompose();
  return { changed: true, xHeight: lo };
}

function updateBoundsUi(report, missing) {
  const miss = $("missing-list");
  const status = $("bounds-status");
  const bar = $("bounds-bar");
  const parts = [];
  if (missing?.length) parts.push(`Missing letters (save them under Your handwriting): ${missing.join(" ")}`);
  if (lastCompose.strokes.length) {
    parts.push(`${lastCompose.strokes.length} strokes · ${lastCompose.bounds.width.toFixed(0)} × ${lastCompose.bounds.height.toFixed(0)} mm`);
    if (placements.length) parts.push(`${placements.length} stamp${placements.length === 1 ? "" : "s"}`);
  } else parts.push("Nothing to draw yet. Save letters under Your handwriting, or add a stamp.");
  miss.textContent = parts.join(" · ");
  if (!bar || !status) return;
  if (!report || report.empty) {
    bar.dataset.state = "ok";
    status.textContent = "Empty page";
    return;
  }
  bar.dataset.state = report.ok ? "ok" : "bad";
  status.textContent = report.ok ? "Fits on the paper and on the printer bed" : report.summary;
}

function drawCompose() {
  const canvas = $("compose-canvas");
  canvas.dataset.interactive = Boolean(library.stamps?.length).toString();
  $("remove-placed-stamp").disabled = !placements[selectedPlacement];
  // Match the paper instead of squeezing it into a landscape canvas.
  const previewHeight = Math.round(1320 * machine.paperHeight / machine.paperWidth + 80);
  if (Number.isFinite(previewHeight) && previewHeight > 80 && previewHeight <= 6000 && canvas.height !== previewHeight) {
    canvas.height = previewHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f3ead6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const packed = composeStrokes();
  lastCompose = {
    strokes: packed.strokes,
    letterStrokes: packed.result.strokes,
    stampStrokes: packed.stampStrokes,
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
    ? (library.words[$("word-target").value] || []).filter((g) => !g.demo && !g.sample)
    : (library.glyphs[$("glyph-target").value] || []).filter((g) => !g.demo && !g.sample);
  items.forEach((glyph, index) => {
    const btn = document.createElement("button");
    btn.className = "variant-thumb" + (index === selectedVariant ? " selected" : "");
    btn.type = "button";
    btn.title = "Click to delete this variant";
    btn.appendChild(drawThumb(glyph));
    btn.addEventListener("click", () => {
      if (!confirm("Delete this saved drawing?")) return;
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
    list.innerHTML = `<p class="hint">Nothing saved yet for this ${mode === "word" ? "word" : "character"}. Draw it on the paper above, then save.</p>`;
  }
}

function syncMode() {
  const mode = $("capture-mode").value;
  $("glyph-target-wrap").hidden = mode !== "glyph";
  $("word-target-wrap").hidden = mode !== "word";
  $("save-capture").textContent = mode === "page" ? "Download this page for the printer" : mode === "word" ? "Save this word" : "Save this letter";
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
    setStatus(warnings.length ? `Downloaded with a warning: ${warnings[0]}` : "Downloaded a print file for this page.");
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
  if (hasUserGlyphs(library)) $("note-font").value = CUSTOM_FONT_ID;
  renderGrid();
  renderVariants();
  drawCapture();
  drawCompose();
  setStatus("Saved. Draw it a couple more times — mixed versions look more like real handwriting.");
  syncFontBanners();
  autosave(true);
}

function paperFromEvent(canvas, event) {
  const p = canvasPoint(canvas, event);
  return {
    x: (p.x - composeView.ox) / composeView.scale,
    y: (p.y - composeView.oy) / composeView.scale,
  };
}

function syncTraceControls() {
  const mode = $("trace-mode").value;
  const shade = isShadeMode(mode);
  const scribble = !shade && mode === "scribble";
  document.querySelectorAll(".stamp-binary-only").forEach((el) => { el.hidden = shade; });
  document.querySelectorAll(".stamp-shade-only").forEach((el) => { el.hidden = !shade; });
  document.querySelectorAll(".stamp-scribble-only").forEach((el) => { el.hidden = !scribble; });
  const name = $("trace-threshold-name");
  if (name) name.textContent = shade ? "Contrast" : "Ink threshold";
  const vals = [
    ["trace-threshold-val", "trace-threshold"],
    ["trace-join-val", "trace-join"],
    ["trace-thicken-val", "trace-thicken"],
    ["trace-specks-val", "trace-specks"],
    ["trace-smooth-val", "trace-smooth"],
    ["trace-scribble-val", "trace-scribble"],
    ["trace-density-val", "trace-density"],
    ["trace-shades-val", "trace-shades"],
  ];
  for (const [labelId, inputId] of vals) {
    const label = $(labelId);
    const input = $(inputId);
    if (label && input) label.textContent = String(input.value);
  }
}

function setStampTab(tab, opts = {}) {
  const next = tab === "doodle" ? "doodle" : "photo";
  if ($("stamp-source")) $("stamp-source").value = next;
  document.querySelectorAll(".stamp-tab").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.stampTab === next ? "true" : "false");
  });
  const photo = $("section-photo");
  const doodle = $("section-doodle");
  if (photo) photo.hidden = next !== "photo";
  if (doodle) doodle.hidden = next !== "doodle";
  if (!opts.quiet) {
    syncStampSource();
    autosave();
  }
}

function syncStampTab() {
  setStampTab($("stamp-source")?.value === "doodle" ? "doodle" : "photo", { quiet: true });
}

function syncStampSource() {
  syncStampTab();
  syncTraceControls();
  if (lastTrace?.count) {
    $("stamp-status").textContent = `${lastTrace.count} paths ready. Save the photo stamp, then plant it on Note.`;
  } else {
    $("stamp-status").textContent = isShadeMode($("trace-mode").value)
      ? "Load a photo. Rings (default), hatch, squiggle, and wander turn darks into pen fills."
      : "Load a photo. Dark marks become the pen path.";
  }
  const ds = $("doodle-status");
  if (ds) {
    ds.textContent = doodleStrokes.length
      ? `${doodleStrokes.length} stroke${doodleStrokes.length === 1 ? "" : "s"}. Save the doodle, then plant it on Note.`
      : "Draw on the paper. The printer follows the same order.";
  }
  drawStampPreview();
  drawDoodlePreview();
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
    thicken: Number($("trace-thicken").value) || 0,
    minBlob: Number($("trace-specks").value) || 18,
    simplify: shade ? 0.7 : (0.25 + (Math.max(1, Number($("trace-smooth").value) || 8) - 1) * 0.22),
    scribbleStep: Number($("trace-scribble").value) || 5,
    density: Number($("trace-density").value) || 12,
    shades: Number($("trace-shades").value) || 32,
  });
  drawStampPreview();
  $("stamp-status").textContent = lastTrace.count
    ? `${lastTrace.count} paths ready${shade ? ` · ${Number($("trace-shades").value) || 32} gray steps` : ""}. Save the photo stamp, then plant it on Note.`
    : shade
      ? "No pen lines yet — try raising Contrast, packing lines tighter, or Invert."
      : "No ink found — try a lower Ink threshold, Invert, or a photo with stronger contrast.";
}

function drawDoodlePreview() {
  const canvas = $("doodle-canvas");
  if (!canvas) return;
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
    ctx.font = "28px 'Space Grotesk', sans-serif";
    ctx.fillText("Draw here. The printer copies these strokes.", 48, canvas.height / 2);
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
  const canvas = $("stamp-canvas");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f3ead6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!stampImage) {
    ctx.fillStyle = "#4a4036";
    ctx.font = "28px 'Space Grotesk', sans-serif";
    ctx.fillText("Drop a photo here, or use Load photo.", 48, canvas.height / 2);
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
  ctx.font = "16px 'Space Grotesk', sans-serif";
  ctx.fillText(previewKind === "gray" ? "what the computer sees" : "what counts as ink", 24, 28);
  ctx.fillText("what the pen will draw", split + 20, 28);
}

function loadStampFile(file) {
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    stampImage = img;
    if ($("stamp-name").value === "doodle" || $("stamp-name").value === "photo") {
      $("stamp-name").value = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "photo";
    }
    setStampTab("photo", { quiet: true });
    syncStampSource();
    retraceStamp();
  };
  img.src = URL.createObjectURL(file);
}

function renderStampLists() {
  $("delete-saved-stamp").disabled = !library.stamps?.length;
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
    box.innerHTML = `<p class="hint">No stamps yet. Load a photo or draw one above, then save.</p>`;
    composeBox.innerHTML = `<p class="hint">No stamps yet. Open Stamps to trace a photo or draw a doodle, then save it. Stamps are optional.</p>`;
    return;
  }
  if (!selectedStampId || !stamps.some((s) => s.id === selectedStampId)) {
    selectedStampId = stamps[0].id;
  }
  for (const stamp of stamps) {
    box.appendChild(makeThumb(stamp, () => {
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
  const canvas = $("doodle-canvas");
  if (!canvas) return;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    doodleCurrent = [canvasPoint(canvas, e)];
    drawDoodlePreview();
  }, { passive: false });
  canvas.addEventListener("pointermove", (e) => {
    if (!doodleCurrent) return;
    e.preventDefault();
    const p = canvasPoint(canvas, e);
    const last = doodleCurrent[doodleCurrent.length - 1];
    if (dist(p, last) >= 1.6) doodleCurrent.push(p);
    drawDoodlePreview();
  }, { passive: false });
  const end = (e) => {
    if (e) e.preventDefault();
    if (doodleCurrent && doodleCurrent.length > 1) doodleStrokes.push(doodleCurrent);
    doodleCurrent = null;
    syncStampSource();
    autosave();
  };
  canvas.addEventListener("pointerup", end, { passive: false });
  canvas.addEventListener("pointercancel", end, { passive: false });
  canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
}

function saveStamp() {
  if (!lastTrace?.count) {
    $("stamp-status").textContent = "Trace a photo first.";
    return;
  }
  const stamp = {
    id: `stamp_${Date.now()}`,
    name: $("stamp-name").value.trim() || "photo",
    strokes: lastTrace.strokes,
    width: lastTrace.width,
    height: lastTrace.height,
  };
  addStamp(library, stamp);
  library = loadLibrary();
  selectedStampId = stamp.id;
  renderStampLists();
  $("stamp-status").textContent = `Saved “${stamp.name}”. Open Note and click the paper to place it.`;
  autosave(true);
}

function saveDoodleStamp() {
  const simplified = doodleStrokes
    .map((s) => simplifyStroke(s, 1.2))
    .filter((s) => s.length >= 2);
  if (!simplified.length) {
    const ds = $("doodle-status");
    if (ds) ds.textContent = "Draw a doodle first.";
    return;
  }
  const norm = normalizeStamp(simplified);
  const stamp = {
    id: `stamp_${Date.now()}`,
    name: $("doodle-stamp-name")?.value.trim() || "doodle",
    strokes: norm.strokes,
    width: norm.width,
    height: norm.height,
  };
  addStamp(library, stamp);
  library = loadLibrary();
  selectedStampId = stamp.id;
  renderStampLists();
  const ds = $("doodle-status");
  if (ds) ds.textContent = `Saved “${stamp.name}”. Open Note and click the paper to place it.`;
  autosave(true);
}

function wireCapture() {
  const canvas = $("capture-canvas");
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    currentStroke = [canvasPoint(canvas, e)];
    drawCapture();
  }, { passive: false });
  canvas.addEventListener("pointermove", (e) => {
    if (!currentStroke) return;
    e.preventDefault();
    const p = canvasPoint(canvas, e);
    const last = currentStroke[currentStroke.length - 1];
    if (dist(p, last) >= 1.6) currentStroke.push(p);
    drawCapture();
  }, { passive: false });
  const end = (e) => {
    if (e) e.preventDefault();
    if (currentStroke && currentStroke.length > 1) strokes.push(currentStroke);
    currentStroke = null;
    drawCapture();
    autosave();
  };
  canvas.addEventListener("pointerup", end, { passive: false });
  canvas.addEventListener("pointercancel", end, { passive: false });
  canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
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

function paperBox() {
  return {
    minX: 0,
    minY: 0,
    maxX: Number(machine.paperWidth) || 170,
    maxY: Number(machine.paperHeight) || 220,
    width: Number(machine.paperWidth) || 170,
    height: Number(machine.paperHeight) || 220,
  };
}

function ensureNoteStrokes() {
  drawCompose();
  if (!lastCompose.strokes.length) {
    alert("Nothing to download yet. Save some letters under Your handwriting, or add a stamp, then come back here.");
    return false;
  }
  return true;
}

function renderNotePng() {
  const paper = paperBox();
  const pxPerMm = 8;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.round(paper.width * pxPerMm));
  canvas.height = Math.max(8, Math.round(paper.height * pxPerMm));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f3ead6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const paint = (strokeList, color, mm) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, mm * pxPerMm);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokeList || []) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x * pxPerMm, stroke[0].y * pxPerMm);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x * pxPerMm, stroke[i].y * pxPerMm);
      ctx.stroke();
    }
  };
  paint(lastCompose.letterStrokes || lastCompose.strokes, "#1c1712", 0.35);
  paint(lastCompose.stampStrokes, "#5a2c24", 0.32);
  return canvas;
}

function exportPng() {
  if (!ensureNoteStrokes()) return;
  renderNotePng().toBlob((blob) => {
    if (!blob) {
      alert("Could not make a PNG in this browser.");
      return;
    }
    download("note.png", blob, "image/png");
    setStatus("Downloaded note.png");
  }, "image/png");
}

function exportSvg() {
  if (!ensureNoteStrokes()) return;
  const paper = paperBox();
  const svg = strokesToSvg(lastCompose.strokes, {
    width: Math.round(paper.width * 8),
    height: Math.round(paper.height * 8),
    strokeWidth: 0.35,
    paper: "#f3ead6",
    box: paper,
  });
  download("note.svg", svg, "image/svg+xml");
  setStatus("Downloaded note.svg");
}

function exportNote(dryRun) {
  if (!ensureNoteStrokes()) return;
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
    } else if (!confirm(`This print would go off the paper or the printer bed:\n${report.summary}\n\nDownload anyway?`)) {
      return;
    }
  }
  const { gcode, warnings } = strokesToGcode(strokes, machine, {
    dryRun,
    title: dryRun ? "note-dry-run" : "note",
  });
  download(dryRun ? "note-dry-run.gcode" : "note.gcode", gcode);
  if (warnings.length && !$("auto-fix-export")?.checked) {
    alert(`Downloaded, but check the paper and printer bed:\n${warnings.slice(0, 6).join("\n")}`);
  } else if (warnings.length) {
    setStatus(`Downloaded with auto-fit. ${warnings[0]}`);
  }
}

function initNav() {
  document.querySelector(".skip-link").addEventListener("click", (event) => {
    event.preventDefault();
    document.querySelector("main").focus();
  });
  document.querySelectorAll(".nav-btn[data-panel]").forEach((btn) => {
    btn.addEventListener("click", () => goToPanel(btn.dataset.panel));
  });
  $("go-home")?.addEventListener("click", (e) => {
    e.preventDefault();
    goToPanel("home");
  });
  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      goToPanel(btn.dataset.go, { doodle: btn.dataset.doodle === "1" });
    });
  });
  window.addEventListener("hashchange", () => goToPanel(panelFromHash(), { fromHash: true }));
}

function init() {
  initNav();
  goToPanel(panelFromHash(), { fromHash: true });
  wireCapture();
  wireStampCanvas();
  wireComposeCanvas();

  loadProject().then((project) => {
    applyProject(project);
    autosave(true);
  }).catch((err) => {
    console.warn(err);
    library = stripDemoInk(library);
    fillMachineForm();
    fillFontSelect();
    $("note-font").value = DEFAULT_FONT_ID;
    syncStampSource();
    renderGrid();
    renderVariants();
    renderStampLists();
    drawCapture();
    drawStampPreview();
    drawDoodlePreview();
    drawCompose();
    syncFontBanners();
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
    $(id).addEventListener("input", () => {
      syncComposeLayoutLabels();
      drawCompose();
      autosave();
    });
  });
  $("show-note-preview").addEventListener("click", () => {
    $("compose-canvas").focus({ preventScroll: true });
    $("compose-canvas").scrollIntoView({ block: "start" });
  });
  $("remove-placed-stamp").addEventListener("click", () => {
    if (!placements[selectedPlacement]) return;
    placements.splice(selectedPlacement, 1);
    selectedPlacement = -1;
    persistPlacements();
  });
  $("delete-saved-stamp").addEventListener("click", () => {
    const stamp = library.stamps?.find((s) => s.id === selectedStampId);
    if (!stamp || !confirm(`Delete stamp “${stamp.name}” and all its copies on the note?`)) return;
    removeStamp(library, stamp.id);
    library = loadLibrary();
    placements = placements.filter((p) => p.stampId !== stamp.id);
    selectedPlacement = -1;
    selectedStampId = library.stamps[0]?.id || null;
    renderStampLists();
    persistPlacements();
  });
  $("reset-writing-layout").addEventListener("click", () => {
    for (const [id, value] of [["x-height", 4.5], ["line-height", 3], ["tracking", 0.28], ["word-space", 0.95]]) {
      $(id).value = value;
    }
    syncComposeLayoutLabels();
    drawCompose();
    autosave();
  });
  $("note-font").addEventListener("change", () => {
    syncFontBanners();
    drawCompose();
    autosave();
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
  ["trace-mode", "trace-threshold", "trace-join", "trace-thicken", "trace-specks", "trace-smooth", "trace-scribble", "trace-density", "trace-shades", "trace-invert"].forEach((id) => {
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
  $("save-doodle-stamp")?.addEventListener("click", saveDoodleStamp);
  document.querySelectorAll(".stamp-tab").forEach((btn) => {
    btn.addEventListener("click", () => setStampTab(btn.dataset.stampTab));
  });
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
      alert("Save a stamp first, then click this button.");
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
  $("doodle-stamp-name")?.addEventListener("input", () => autosave());
  $("fun-run-count").addEventListener("input", () => autosave());
  $("stamp-size").addEventListener("change", () => {
    if (selectedPlacement >= 0 && placements[selectedPlacement]) {
      placements[selectedPlacement].sizeMm = Number($("stamp-size").value) || 28;
      persistPlacements();
    } else {
      autosave();
    }
  });
  $("export-png").addEventListener("click", exportPng);
  $("export-svg").addEventListener("click", exportSvg);
  $("export-gcode").addEventListener("click", () => exportNote(false));
  $("export-dry").addEventListener("click", () => exportNote(true));
  $("fit-page").addEventListener("click", () => {
    const out = shrinkToFitPage();
    setStatus(out.changed ? `Letter height is now ${out.xHeight.toFixed(2)} mm so the note stays on the paper.` : "Already fits on the paper.");
    autosave();
  });
  $("clamp-paper").addEventListener("click", () => {
    clampPaperToBed();
    drawCompose();
    setStatus("Writable area clipped to the bed.");
  });
  $("auto-fix-export").addEventListener("change", () => autosave());

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

  $("open-settings")?.addEventListener("click", () => $("settings-dialog")?.showModal());
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
    const ok = confirm("Clear only what this site saved here — letters, stamps, the note, and printer settings. Other websites are not touched. Download a backup first if you might want this work back.");
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
    setStatus("This site’s saved work was cleared.");
    $("save-status").textContent = "Cleared. This site has no letters, stamps, or note saved here.";
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
      if ($("panel-stamps").classList.contains("active")) {
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

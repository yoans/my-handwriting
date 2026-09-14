# My Handwriting

Turn samples of **your** writing into G-code a 3D printer can follow with a pen in the toolhead.

**Live app (use this on a tablet):** https://yoans.github.io/my-handwriting/

Everything runs in the browser. Capture letters with a stylus, scan doodles into stamps, then download G-code. Your library stays on that device until you export it.

## Why this approach

## Why this approach

A printer is a plotter. It needs a sequence of X/Y moves with the pen down, then a Z lift between strokes. That is not what you get from a scanned TrueType font (filled outlines, no writing order) or from an AI handwriting model trained on other people (Calligrapher / HandCode). Those can look “handwritten,” but they will not be *your* hand, and they often produce the wrong stroke order for a pen.

The reliable path:

1. Capture **ordered strokes** for each letter (and a few whole words).
2. Optionally trace a photo of existing samples so the path matches how you actually write.
3. Compose new text from those glyphs, with small variation so it does not look like a font.
4. Emit G-code: travel with Z up, write with Z down, no extrusion, no heat.

Open the [live app](https://yoans.github.io/my-handwriting/) or `index.html` in a current browser (Chrome, Edge, Safari, or Firefox). On a tablet, add the Pages site to your home screen so it feels like an app. A local server is not required.

## Hardware

Print or buy a pen holder for your hotend / toolhead. Tape a sheet to the bed. Watch the machine. Custom G-code can crash a pen into the bed if Z is wrong.

### Bambu Lab A1

The A1 is the machine this project is tuned for. Bed is **256 × 256 × 256 mm**. It is open-frame (no enclosure to hit), but the pen sits **below the nozzle**, so a normal `G28` / bed-level home will drive the nib into the plate. The **Bambu Lab A1** preset emits a different start sequence:

1. Home **X only**, lift, move to **X128 Y2** (bed at the back so the pen can hang off the rear edge).
2. Home **Z on the nozzle**.
3. Raise by **pen Z offset** (start at 20 mm, then lower) and `G92 Z0` so Z0 is pen-on-paper.

**Holder (print one of these, A1 profile only):**

- [Pen Holder A1 / A1 Mini](https://makerworld.com/en/models/429109-pen-holder-a1-a1-mini-plotter)
- [Easy penholder A1 / A1 Mini](https://makerworld.com/en/models/1362648-easy-penholder-a1-a1-mini)
- [UMTS modular system (A1 / P1 / X1)](https://makerworld.com/en/models/2029113-modular-system-for-a1-p1-x1-series)

**On the printer:**

1. Unload filament. Do not use AMS Lite for plot jobs.
2. Mount the holder and a fineliner.
3. Tape paper to a **smooth / cool plate**, top of the page toward the **back** of the printer. Leave the rear ~25 mm of the bed empty for nozzle homing.
4. In the studio, Printer tab → **Bambu Lab A1**. Export a **dry-run** first.
5. Copy the `.gcode` to the **root** of the MicroSD card. The A1 card is not hot-swappable — [eject it from the screen](https://wiki.bambulab.com/en/a1/manual/how-to-print-from-sd-card) before pulling it.
6. Print Files → the file. Turn **off** bed leveling, flow/nozzle calibration, AMS, and spaghetti detection if those toggles appear.
7. Stay next to it for Z home. If the pen touches first, abort and increase pen Z offset.
8. Then the 20 mm square, then a short word. Lower the offset a millimeter at a time until the line is solid.

That start G-code is the community A1 Mini plotter sequence (tested on Mini) with X/Y limits changed for the full A1 (`X128`, present at `Y254`). Treat the first home as untested on your unit.

### Other printers

Jog Z until a fineliner just marks the paper; that is **Z down**. **Z up** should clear the page by a few millimeters. Home **X and Y only** — never home Z with a pen mounted. Dry-run, then the 20 mm square, then a short word.

## Capture tips

- A tablet/stylus is much better than a mouse.
- Save 3–5 variants of each letter you actually use.
- Capture common words (`the`, `and`, your name) as wholes so connections look natural.
- For paper samples: **Load photo / scan**, fade the overlay, and trace on the guides.
- **Full page** mode exports whatever you draw/trace as G-code immediately — useful for an existing note you just want plotted once.

## Stamps (kid drawings)

Open **Stamps**, load a photo of a drawing on plain paper, tweak the ink threshold until the mask matches the doodle, then save. On **Compose**, select the stamp and click the page to plant copies, or **Fun run** for a wiggly parade across the lower third. Outline is best for marker/crayon; centerline is for thin pen; scribble fill hatches solid blobs. Stamps export in the same G-code as the handwriting.

## Firmware notes

G-code is generic Marlin-style (`G21/G90`, `G0` travels, `G1` writes, `M104 S0` / `M140 S0`) except the **Bambu Lab A1** preset, which writes A1 start/end G-code (nozzle home at the back of the bed, `G92` pen zero, `M18` at the end). Some Marlin firmwares refuse motion with a cold hotend; enable cold extrusion (`M302`) or equivalent.

## Project layout

- `index.html` — studio UI
- `js/layout.js` — glyph assembly
- `js/gcode.js` — machine mapping and export
- `js/library.js` — local library + printer presets

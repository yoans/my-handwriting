# My Handwriting

Turn samples of **your** writing into G-code a 3D printer can follow with a pen in the toolhead.

**Live:** https://yoans.github.io/my-handwriting/

A [Build Beyond Belief](https://buildbeyondbelief.com/) studio tool. Everything runs in the browser. Letters, stamps, the note, and printer settings auto-save on this device. **Download backup** writes a JSON file you can Restore on another phone or after clearing Safari.

## Why this approach

A printer is a plotter. It needs a sequence of X/Y moves with the pen down, then a Z lift between strokes. That is not what you get from a scanned TrueType font (filled outlines, no writing order) or from an AI handwriting model trained on other people. Those can look “handwritten,” but they will not be *your* hand, and they often produce the wrong stroke order for a pen.

1. Capture **ordered strokes** for each letter (and a few whole words).
2. Optionally trace a photo of existing samples so the path matches how you actually write.
3. Compose new text from those glyphs, with small variation so it does not look like a font.
4. Optionally plant **stamps** from doodles or photo shading (wander, hatch, squiggle, rings).
5. Emit G-code: travel with Z up, write with Z down, no extrusion, no heat.

A demo hand is loaded the first time so you can try a note immediately. Capture yours in **Write** to replace it.

## Hardware

Print or buy a pen holder for your hotend / toolhead. Tape a sheet to the bed. Watch the machine. Custom G-code can crash a pen into the bed if Z is wrong.

### Bambu Lab A1

The A1 is the machine this project is tuned for. Bed is **256 × 256 × 256 mm**. It is open-frame, but the pen sits **below the nozzle**, so a normal `G28` / bed-level home will drive the nib into the plate. Use the **Bambu Lab A1** preset in Printer.

**Holder (print one of these, A1 profile only):**

- [Pen Holder A1 / A1 Mini](https://makerworld.com/en/models/429109-pen-holder-a1-a1-mini-plotter)
- [Easy penholder A1 / A1 Mini](https://makerworld.com/en/models/1362648-easy-penholder-a1-a1-mini)
- [UMTS modular system (A1 / P1 / X1)](https://makerworld.com/en/models/2029113-modular-system-for-a1-p1-x1-series)

Dry-run first. Copy `.gcode` to the **root** of the MicroSD card. Eject the card from the screen before pulling it. Stay next to Z home. Details live in the app’s Printer tab.

### Other printers

Jog Z until a fineliner just marks the paper; that is **Z down**. **Z up** should clear the page by a few millimeters. Home **X and Y only** — never home Z with a pen mounted.

## Capture tips

- A tablet/stylus is much better than a mouse.
- Save 3–5 variants of each letter you actually use.
- Capture common words (`the`, `and`, your name) as wholes.
- For paper samples: **Load photo / scan**, fade the overlay, and trace on the guides.

## Stamps

Photo or doodle. Outline for marker; centerline for thin pen; shade modes pack traces tighter in the darks. On **Note**, click the page to plant copies, or **Fun run** for a wiggly parade.

## Firmware

G-code is generic Marlin-style except the **Bambu Lab A1** preset (nozzle home at the back of the bed, `G92` pen zero). Some Marlin firmwares refuse motion with a cold hotend; enable cold extrusion (`M302`).

## Project layout

- `index.html` — studio UI
- `js/layout.js` — glyph assembly
- `js/gcode.js` — machine mapping and export
- `js/trace.js` — photo stamps
- `js/demo.js` — first-run sample hand

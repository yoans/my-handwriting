# My Handwriting

Turn samples of **your** writing into G-code a 3D printer can follow with a pen in the toolhead.

**Live:** https://my-handwriting.buildbeyondbelief.com/

A [Build Beyond Belief](https://buildbeyondbelief.com/) studio tool. Everything runs in the browser. Letters, stamps, the note, and printer settings auto-save on this device. **Download backup** writes a JSON file you can Restore on another computer or after clearing this site’s data.

## A birthday note became a project

I used this to make a birthday note in my own handwriting with a pen attached to a 3D printer. Figuring out how to turn letters into movements was part of the fun. I am sharing the tool so you can try it, make something personal, or build on the idea.

## Try it without a printer

1. Open **Make a note**, choose a sample alphabet, and type a short message.
2. Download a **PNG** to share or an **SVG** to keep the drawing as scalable lines.
3. To use your own writing, open **Your handwriting**, draw and save the characters you need, then choose **Your handwriting** on the Note page. Uppercase and lowercase are separate.
4. Add a doodle or photo stamp if you like. Stamps are optional.

Drawing requires a mouse, touch, or stylus. The sample-alphabet note flow works with a keyboard. A photo of writing can be used as a tracing guide; it is not automatically converted into a personal alphabet.

## How the printer writes

A plotter follows paths with a pen. X and Y move across the page; Z lifts the pen between strokes. This tool records the order of the strokes you draw and assembles them into new messages. Several saved versions of a letter allow variation.

The downloadable G-code contains movement instructions, requests no heat, and uses no extrusion. The browser does not connect to your printer. Check **Printer setup** before running a file: presets cannot account for every holder, pen length, or firmware version. A practice file lifts the pen during drawing but still runs startup and homing.

## Privacy and portability

Free to use, with no sign-in, analytics, tracking scripts, external fonts, or uploads in the app. Processing and project storage stay in your browser. The site host receives ordinary page requests; visiting external links uses those sites normally.

Use **Settings → Download a backup** to save a JSON copy of your work. Restore it on another browser or computer. Browser data can be cleared, so local autosave is not a permanent backup.

### Run your own copy

This is a static HTML/CSS/JavaScript site with no build step or application server. Download or clone the repository, then serve the directory locally. With Python installed:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open http://localhost:8000. Use a local web server rather than double-clicking `index.html`, because the app uses JavaScript modules. With the files on your computer, the local copy works without an internet connection. Keep using the same browser and local address to access its saved work, or restore a backup.

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

G-code is generic Marlin-style except the **Bambu Lab A1** preset (nozzle home at the back of the bed, `G92` pen zero). No cold-extrusion override is needed for the pen paths; they contain no extrusion moves. Check firmware and homing requirements if a machine refuses motion.

## Project layout

- `index.html` — studio UI
- `js/layout.js` — glyph assembly
- `js/gcode.js` — machine mapping and export
- `js/trace.js` — photo stamps
- `js/demo.js` — first-run sample hand

## Deploy

GitHub Pages on `main`, same pattern as [Project Excavation](https://excavation.buildbeyondbelief.com). Cloudflare DNS for `buildbeyondbelief.com`:

| Type  | Name             | Value             | TTL  | Proxy |
|-------|------------------|-------------------|------|-------|
| CNAME | `my-handwriting` | `yoans.github.io` | 3600 | on    |

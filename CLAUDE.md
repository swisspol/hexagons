# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A standalone static web page (`index.html`, `index.css`, `index.js`, no build step and no dependencies) that renders, live, a hexagon pattern growing out of two emitter disks. It is modelled on the hand drawing `reference.jpg` and the painting it led to (coloured dots in each cell). `.nojekyll` indicates it is published with GitHub Pages.

## Running and checking

- Open `index.html` directly, or serve the folder: `python3 -m http.server` → http://localhost:8000.
- Every setting lives in the query string, so a URL reproduces a render exactly, e.g. `index.html?w=800&h=1000&e1x=58&e1y=15&e2x=41.5&e2y=57&r=40&g=25&col=1`.
- There are no tests or linter. Check syntax with `node --check index.js`; check visually with headless Chrome:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=1400,1250 --virtual-time-budget=2000 --screenshot=out.png "file://$PWD/index.html?<params>"`
  (macOS has no `timeout` command; screenshotting a raw `.svg` file hangs Chrome, so wrap it in an HTML `<img>` or use `qlmanage -t`).

## Architecture (index.js)

- **`PARAMS` is the single source of truth for settings.** Each entry (key, URL param, label, unit, UI group, limits, default, optional `type: 'checkbox' | 'color'`) drives the generated sidebar controls (`buildControls` appends to the `data-group` container of the same name in `index.html`), URL reading/writing (`readUrl`, `paramString`) and `config`. Adding a setting = one `PARAMS` entry (plus a `<section>` in `index.html` for a new group). Checkboxes are stored as 1/0; colours as hex without `#` in the URL.
- **Geometry (`buildTiling`)**: a regular hex lattice on a cylinder in w-space, mapped to the image by the inverse of the bipolar conformal map `w = log((z − f1)/(z − f2))`. The foci `f1`, `f2` are chosen so both emitter disks (radius = "Emitter size") are exact lines of constant Re(w); the row spacing is snapped so the disk passes through the side vertices of the first ring (the "Radial stretch" stat is that snap). `w = 0` is the point at infinity and is a cell centre. Rows continue toward the foci until edges get shorter than the line width. Output: line `segments` (each cell emits 3 edges so each edge is drawn once) and `dots` (centre, inradius, gradient position `t` = 0 at disk 1, 0.5 halfway, 1 at disk 2).
- **Rendering has two parallel paths that must stay in sync**: `drawPattern` (canvas, used on screen and for the PNG) and `buildSvg` (vector export). Both draw: white background → lattice lines → coloured dots (`visibleDots`) → overlay discs (`overlayDiscs`, `discColor`). Downloads always omit the background image (`audi_r8.png`) and are rendered on an offscreen canvas, which also avoids canvas tainting under `file://`.
- **Overlay discs** ("Disks → Size") are independent of the emitter size and sit on the lattice ring of that radius (an Apollonius circle), which is only centred exactly on the emitter when Size = Emitter size.

## Constraint from the user

The hexagons must stay as undistorted as possible: keep the map conformal. Rings around an emitter are true circles but drift toward the other emitter as they grow; this is inherent. A non-conformal blend that centred the rings was tried and explicitly rejected because of the visible cell distortion. Don't reintroduce it.

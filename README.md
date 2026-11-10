# Bubblotics Auto Sim

Collaborative autonomous path visualization for FTC BIOBUZZ 2026-27 match strategy. Sketch autos for all four robots in a match (Red 1, Red 2, Blue 1, Blue 2), play them back together, spot footprint overlaps, and share the board with an alliance partner. It favors speed over precision; use a high-fidelity planner for final paths.

Field model: 144 x 144 in, origin bottom-left, +x right, +y up, heading in degrees (0 = +x, CCW positive), Pedro Pathing coordinates.

Field orientation: the red alliance is at the bottom (y < 72) and the blue alliance at the top (y > 72), with the HIVE in the center. The field is 180-degree rotationally symmetric. Default starts: Red 1 (60, 9), Red 2 (120, 9), Blue 1 (84, 135), Blue 2 (24, 135).

## Use

### Autos library (home screen)

- Each saved auto is a card: name, team, thumbnail (field image, path, waypoint dots, green start dot), point count. "IN USE" cards (accent border) are assigned on the active match board.
- Filter row: team chips ("All robots" plus one per team number among saved autos), a search box (name or team) and a sort (Newest, Oldest, Name A-Z).
- "Use in matches" opens a menu (Red 1, Red 2, Blue 1, Blue 2) and replaces what was in that slot; "Stop using" clears it. An auto fills one slot per board. The board strip shows the four slots; boards can be created, renamed and shared.
- An auto drawn for one alliance placed in the other alliance's slot is rendered and simulated through the 180-degree mirror ((x, y, h) -> (144 - x, 144 - y, h + 180)). The stored auto is never changed.
- Rename is inline, Duplicate appends " copy", Delete is immediate with a 6 s Undo toast. The ... menu has Share link and Download .pp.
- Click a card to open the editor: the edited auto is editable, the other board slots are drawn faded for strategy context, and playback and conflicts cover the whole board. The back arrow returns to the library.

### Editor

- Tools: `D` draw, `S` select, `P` start pose, `M` marker. Press `?` for all shortcuts. Alt disables the 1 in snap.
- Waypoints panel: start pose and each segment end, with editable x, y, heading, a line/curve badge, heading mode and marker label. Click a row to select it on the canvas (ring). The x button deletes a waypoint and joins its neighbours; deleting the start promotes the first end. `Del`/`Backspace` deletes the selected waypoint, `L`/`C` toggles line/curve. With the Select tool, double-click a segment to insert a waypoint (de Casteljau split, shape unchanged).
- Clear path shows an Undo toast; Ctrl+Z / Ctrl+Shift+Z undo and redo.
- Playback (Space) uses a trapezoidal velocity profile per robot; overlapping footprints and HIVE-frame hits turn red and are listed. Start-pose legality warnings (G304) show under the timeline.
- Field image: `field.png` is the default; upload your own (IndexedDB) with an opacity slider, Reset returns to `field.png`. "Zones" (Z) outlines loading zones and the HIVE.

### Pedro Pathing import / export

- Import: the Import button (multiple files), drag-and-drop anywhere, or Paste. The format is detected automatically; each path becomes a new auto (name from the filename, team from the filter or the paste dialog).
- `.pp` from the Pedro Visualizer: current (`startPoint.headingDeg`, atomic/compound lines, heading objects, `sequence` with waits) and legacy shapes (heading fields on `startPoint`/`endPoint`, string headings). Waits become markers. Piecewise headings import as linear with a warning; through points are ignored with a warning.
- Java from an OpMode: `new BezierLine/BezierCurve` with `new Pose(...)` / `new Point(...)` or named pose variables, `setLinearHeadingInterpolation`, `setConstantHeadingInterpolation`, `setTangentHeadingInterpolation`, `setReversed`. Every `pathBuilder()...build()` chain is its own auto.
- Export: "Download .pp" (card menu or editor) writes a file the Pedro Visualizer opens. The logic is in `src/pedro.js` (`parsePedro`, `toPP`).

### Sharing and sync

- Share link: a single auto (card) or the whole board with its autos (board strip); both go in the URL hash (deflate + base64url). Old board links still open (converted to autos).
- Data is saved in localStorage (`bubblotics.autosim.v2`); boards from the old `v1` key are migrated once into autos named "<board> <slot>". Tabs on one device sync through BroadcastChannel.
- Live room: WebRTC via PeerJS, loaded from unpkg only when you open a room (needs internet). Autos merge last-writer-wins by `updatedAt`; board slots merge per slot. Deleting an auto is local and does not propagate.

## Run locally

No build step.

```
python3 -m http.server
```

Then open http://localhost:8000. Tests (Node 18+):

```
node --test
```

## Deploy to GitHub Pages

Push to GitHub, then Settings > Pages > Deploy from branch `main` / root. All URLs are relative, so it works under `/repo-name/` or a custom domain. Bump `CACHE` in `sw.js` when shipping changes so installed copies update.

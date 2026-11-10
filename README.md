# Bubblotics Auto Sim

Collaborative autonomous path visualization for FTC match strategy. Sketch autos for all four robots in a match (Red 1, Red 2, Blue 1, Blue 2), play them back together, spot footprint overlaps, and share the board with an alliance partner. It favors speed over precision; use a high-fidelity planner for final paths.

Field model: 144 x 144 in, origin bottom-left, +x right, +y up, heading in degrees (0 = +x, CCW positive), Pedro Pathing coordinates.

## Use

- `1`-`4` pick a robot. Tools: `D` draw, `S` select, `P` start pose, `M` marker. Press `?` in the app for all shortcuts.
- Draw: drag a freehand stroke (simplified with Ramer-Douglas-Peucker, fitted to cubic Beziers, near-straight pieces become lines) or click to add a straight line. Alt disables the 1 in grid snap.
- Select: drag endpoints (squares) and control points (circles). Double-click an endpoint, or use the Marker tool, to add a labeled wait.
- Play with Space; the timeline runs the 30 s auto. Each path uses a trapezoidal velocity profile (per-robot max velocity and acceleration). Overlapping footprints turn red and are listed under the scrub bar.
- Mirror copies the active robot's path to the other alliance (x -> 144 - x, heading -> 180 - h). Shift-click mirrors in place.
- Share: "Copy share link" puts the whole board in the URL hash (deflate + base64url). Export/Import use `.json`; PNG saves the current view.
- Boards are saved in localStorage automatically. Several tabs on one device sync live through BroadcastChannel.
- Live room: syncs across devices over WebRTC using PeerJS, loaded from unpkg only when you open a room. It needs internet; offline, the app says so and share links keep working. Conflicts resolve last-writer-wins per path; joining takes a whole-board snapshot from the host.
- Field image: upload your own picture (stored in IndexedDB) with an opacity slider. No field render is bundled.

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

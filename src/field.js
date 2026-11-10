// FTC BIOBUZZ zone geometry (Pedro inches, origin bottom-left). Pure; no DOM.
import { FIELD, footprint, polysOverlap } from './geometry.js';

const R = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
export const ZONES = {
  hive: R(52, 46, 92, 98),
  loading: { red: R(24, 0, 48, 11), blue: R(96, 133, 120, 144) },
  garden: { red: R(142, 0, 144, 23), blue: R(0, 121, 2, 144) },
  // 6 in footprints on the perimeter wall.
  flowers: [R(45, 138, 51, 144), R(93, 0, 99, 6), R(0, 45, 6, 51), R(138, 93, 144, 99)],
};

export const allianceOf = key => key[0] === 'r' ? 'red' : 'blue';
export const rectPoly = r => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];

// Does a robot footprint (pose + size) overlap the rect? Touching edges do not count.
export const overlapsRect = (pose, size, rect) =>
  polysOverlap(footprint(pose.x, pose.y, pose.h, size.w, size.l), rectPoly(rect));

// G304 start check. Returns a list of human-readable problems (empty = legal).
export function startIssues(key, pose, size) {
  const pts = footprint(pose.x, pose.y, pose.h, size.w, size.l), e = 1e-6, out = [];
  const side = allianceOf(key);
  if (side === 'red' ? pts.some(p => p.y > FIELD / 2 + e) : pts.some(p => p.y < FIELD / 2 - e)) out.push('not fully on its alliance side');
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  if (Math.min(...xs) > e && Math.max(...xs) < FIELD - e && Math.min(...ys) > e && Math.max(...ys) < FIELD - e) out.push('not touching a wall');
  if (Object.values(ZONES.loading).some(r => overlapsRect(pose, size, r))) out.push('inside a LOADING ZONE');
  if (ZONES.flowers.some(r => overlapsRect(pose, size, r))) out.push('touching a FLOWER');
  return out;
}

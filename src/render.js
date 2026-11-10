import { FIELD, rad, bezierPoint, segPoints, footprint } from './geometry.js';
import { poseAt } from './profile.js';
import { ROBOT_KEYS } from './store.js';
import { peerColor } from './sync.js';
import { ZONES } from './field.js';

const PAD = 28;
const TEAL = '#14b8a6';

export function makeView(w, h) {
  const size = Math.max(50, Math.min(w, h) - PAD * 2);
  return { w, h, scale: size / FIELD, ox: (w - size) / 2, oy: (h - size) / 2, size };
}
export const toScreen = (v, x, y) => [v.ox + x * v.scale, v.oy + (FIELD - y) * v.scale];
export const toField = (v, px, py) => ({ x: (px - v.ox) / v.scale, y: FIELD - (py - v.oy) / v.scale });

function drawField(ctx, v, bg, zones) {
  ctx.fillStyle = '#121d24';
  ctx.fillRect(v.ox, v.oy, v.size, v.size);
  if (bg?.img) {
    ctx.globalAlpha = bg.opacity;
    ctx.drawImage(bg.img, v.ox, v.oy, v.size, v.size);
    ctx.globalAlpha = 1;
  }
  if (zones) {
    ctx.setLineDash([5, 3]); ctx.lineWidth = 2;
    const box = (r, c) => {
      const [x, y] = toScreen(v, r.x0, r.y1);
      ctx.strokeStyle = c; ctx.strokeRect(x, y, (r.x1 - r.x0) * v.scale, (r.y1 - r.y0) * v.scale);
    };
    box(ZONES.hive, '#facc15');
    box(ZONES.loading.red, '#ef4444'); box(ZONES.loading.blue, '#60a5fa');
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const p = v.ox + i * 24 * v.scale, q = v.oy + i * 24 * v.scale;
    ctx.moveTo(p, v.oy); ctx.lineTo(p, v.oy + v.size);
    ctx.moveTo(v.ox, q); ctx.lineTo(v.ox + v.size, q);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.strokeRect(v.ox, v.oy, v.size, v.size);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `${Math.max(10, v.scale * 4)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 6; i++) {
    ctx.fillText('ABCDEF'[i], v.ox + (i * 24 + 12) * v.scale, v.oy + v.size + 13);
    ctx.fillText(String(6 - i), v.ox - 13, v.oy + (i * 24 + 12) * v.scale);
  }
}

function tracePath(ctx, v, path) {
  const [sx, sy] = toScreen(v, path.startPose.x, path.startPose.y);
  ctx.moveTo(sx, sy);
  path.segments.forEach((_, i) => {
    const pts = segPoints(path, i);
    if (pts.length === 2) { ctx.lineTo(...toScreen(v, pts[1].x, pts[1].y)); return; }
    for (let k = 1; k <= 28; k++) { const p = bezierPoint(pts, k / 28); ctx.lineTo(...toScreen(v, p.x, p.y)); }
  });
}

function drawRobot(ctx, v, robot, pose, label, hot, ghost) {
  const poly = footprint(pose.x, pose.y, pose.h, robot.size.w, robot.size.l).map(p => toScreen(v, p.x, p.y));
  ctx.beginPath();
  poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = hot ? 'rgba(239,68,68,0.55)' : ghost ? 'transparent' : robot.color + '55';
  ctx.fill();
  ctx.lineWidth = hot ? 3 : 2;
  ctx.strokeStyle = hot ? '#ef4444' : robot.color;
  ctx.setLineDash(ghost ? [4, 3] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  const [cx, cy] = toScreen(v, pose.x, pose.y), r = robot.size.l / 2 * v.scale;
  const a = -rad(pose.h), n = r * 0.55;
  ctx.beginPath(); // heading notch
  ctx.moveTo(cx + Math.cos(a) * r * 1.0, cy + Math.sin(a) * r * 1.0);
  ctx.lineTo(cx + Math.cos(a) * r * 0.55 - Math.sin(a) * n * 0.5, cy + Math.sin(a) * r * 0.55 + Math.cos(a) * n * 0.5);
  ctx.lineTo(cx + Math.cos(a) * r * 0.55 + Math.sin(a) * n * 0.5, cy + Math.sin(a) * r * 0.55 - Math.cos(a) * n * 0.5);
  ctx.closePath();
  ctx.fillStyle = robot.color; ctx.fill();
  if (!ghost) {
    ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.max(9, v.scale * 4)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
  }
}

export function handlePositions(path) {
  const out = [{ handle: 'start', segIndex: 0, x: path.startPose.x, y: path.startPose.y }];
  path.segments.forEach((s, i) => {
    s.controls.forEach((c, j) => out.push({ handle: 'c' + j, segIndex: i, x: c.x, y: c.y }));
    out.push({ handle: 'end', segIndex: i, x: s.end.x, y: s.end.y });
  });
  return out;
}

// ui: transient view state {robot, tool, sel, t, draft, bg, peers, conflicts, snap}
export function draw(ctx, w, h, board, ui) {
  const v = makeView(w, h);
  ctx.clearRect(0, 0, w, h);
  drawField(ctx, v, ui.bg, ui.zones);

  for (const k of ROBOT_KEYS) {
    const r = board.robots[k], active = k === ui.robot;
    ctx.globalAlpha = active ? 1 : 0.5;
    ctx.strokeStyle = r.color; ctx.lineWidth = active ? 3 : 2; ctx.lineJoin = 'round';
    ctx.beginPath(); tracePath(ctx, v, r.path); ctx.stroke();
    if (ui.sel && active && ui.sel.seg != null && r.path.segments[ui.sel.seg]) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.globalAlpha = 0.35;
      ctx.beginPath();
      const pts = segPoints(r.path, ui.sel.seg);
      ctx.moveTo(...toScreen(v, pts[0].x, pts[0].y));
      for (let q = 1; q <= 28; q++) { const p = bezierPoint(pts, q / 28); ctx.lineTo(...toScreen(v, p.x, p.y)); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
    r.markers.forEach(m => {
      const s = r.path.segments[m.segIndex];
      if (!s) return;
      const [x, y] = toScreen(v, s.end.x, s.end.y);
      ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#e5e7eb'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${m.label}${m.waitS ? ' ' + m.waitS + 's' : ''}`, x + 9, y - 9);
    });
    drawRobot(ctx, v, r, r.path.startPose, '', false, true);
  }

  const r0 = board.robots[ui.robot];
  if (r0) {
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([4, 4]);
    r0.path.segments.forEach((s, i) => {
      if (!s.controls.length) return;
      const pts = segPoints(r0.path, i);
      ctx.beginPath(); pts.forEach((p, j) => { const q = toScreen(v, p.x, p.y); j ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.stroke();
    });
    ctx.setLineDash([]);
    for (const hp of handlePositions(r0.path)) {
      const [x, y] = toScreen(v, hp.x, hp.y), c = hp.handle[0] === 'c';
      const on = ui.sel && ui.sel.seg === hp.segIndex;
      ctx.fillStyle = c ? '#0b1115' : hp.handle === 'start' ? '#fff' : r0.color;
      ctx.strokeStyle = on ? TEAL : '#fff'; ctx.lineWidth = 2;
      ctx.beginPath();
      if (c) ctx.arc(x, y, 5, 0, 7); else ctx.rect(x - 5, y - 5, 10, 10);
      ctx.fill(); ctx.stroke();
    }
  }

  if (ui.draft && ui.draft.length > 1) {
    ctx.strokeStyle = TEAL; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ui.draft.forEach((p, i) => { const q = toScreen(v, p.x, p.y); i ? ctx.lineTo(...q) : ctx.moveTo(...q); });
    ctx.stroke(); ctx.setLineDash([]);
  }

  for (const k of ROBOT_KEYS) {
    const r = board.robots[k];
    drawRobot(ctx, v, r, poseAt(r, ui.t), k.toUpperCase(), ui.hot.has(k), false);
  }

  const now = performance.now();
  for (const [id, p] of ui.peers) {
    if (now - p.seen > 6000) continue;
    const [x, y] = toScreen(v, p.x, p.y);
    ctx.fillStyle = peerColor(id); ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(id.slice(0, 4), x + 8, y + 3);
  }
  return v;
}

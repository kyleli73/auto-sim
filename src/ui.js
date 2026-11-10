import { FIELD, dist, deg, tangentAngle, fitStroke, segPoints, normDeg } from './geometry.js';
import { AUTO_SECONDS, findConflicts, totalTime } from './profile.js';
import { ROBOT_KEYS, ROBOT_LABEL, uid } from './store.js';
import { startIssues } from './field.js';
import { toField, toScreen, handlePositions } from './render.js';
import { toPP } from './pedro.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const idb = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open('bubblotics-autosim', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('kv');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const req = fn(open.result.transaction('kv', mode).objectStore('kv'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  };
});

export function initUI(app) {
  const { store, ui } = app;
  const canvas = $('field');
  let drag = null, lastCursor = 0, toastTimer = 0, lastBoard = null;

  const robot = () => store.get().robots[ui.robot];
  const snapPt = (p, e) => {
    const q = { x: clamp(p.x, 0, FIELD), y: clamp(p.y, 0, FIELD) };
    return ui.snap && !(e && e.altKey) ? { x: Math.round(q.x), y: Math.round(q.y) } : { x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 };
  };
  const evField = e => {
    const r = canvas.getBoundingClientRect();
    return toField(app.view, e.clientX - r.left, e.clientY - r.top);
  };
  const evPx = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // opt: { action: 'Undo', onAction, ms }
  function toast(msg, opt = {}) {
    const t = $('toast'), b = $('toastAct');
    $('toastMsg').textContent = msg; t.hidden = false;
    b.hidden = !opt.action; b.textContent = opt.action || '';
    b.onclick = () => { t.hidden = true; clearTimeout(toastTimer); opt.onAction?.(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, opt.ms || 3500);
  }
  app.toast = toast;

  // ---- hit testing
  function hitHandle(e) {
    const r = robot(), p = evPx(e), tol = e.pointerType === 'touch' ? 18 : 11, last = r.path.segments.length - 1;
    let best = null, bd = tol;
    for (const h of handlePositions(r.path)) {
      if (ui.tool === 'draw' && ((h.handle === 'end' && h.segIndex === last) || (h.handle === 'start' && last < 0))) continue;
      const [sx, sy] = toScreen(app.view, h.x, h.y), d = Math.hypot(sx - p.x, sy - p.y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  function hitEnd(e, tol = 20) {
    const r = robot(), p = evPx(e);
    let best = -1, bd = tol;
    r.path.segments.forEach((s, i) => {
      const [sx, sy] = toScreen(app.view, s.end.x, s.end.y), d = Math.hypot(sx - p.x, sy - p.y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function hitSegment(e) { // { i, u } of the nearest point on any segment within a few pixels, else null
    const r = robot(), p = evPx(e);
    let best = null, bd = 12;
    r.path.segments.forEach((_, i) => {
      const pts = segPoints(r.path, i);
      for (let k = 0; k <= 48; k++) {
        const q = bezierAt(pts, k / 48), [sx, sy] = toScreen(app.view, q.x, q.y), d = Math.hypot(sx - p.x, sy - p.y);
        if (d < bd) { bd = d; best = { i, u: k / 48 }; }
      }
    });
    return best;
  }
  const bezierAt = (pts, t) => {
    const p = pts.map(q => ({ ...q }));
    for (let n = p.length - 1; n > 0; n--) for (let i = 0; i < n; i++) p[i] = { x: p[i].x + (p[i + 1].x - p[i].x) * t, y: p[i].y + (p[i + 1].y - p[i].y) * t };
    return p[0];
  };

  // ---- marker dialog
  const PRESET_WAIT = { launch: 1.5, 'intake pollen': 1, flower: 1.5, garden: 0.5, park: 0 };
  $('mLabel').oninput = e => { const w = PRESET_WAIT[e.target.value.trim().toLowerCase()]; if (w !== undefined) $('mWait').value = w; };
  function openMarker(segIndex) {
    const r = robot(), m = r.markers.find(k => k.segIndex === segIndex);
    $('mLabel').value = m ? m.label : 'Launch';
    $('mWait').value = m ? m.waitS : PRESET_WAIT.launch;
    const key = ui.robot, dlg = $('markerDlg');
    dlg.returnValue = '';
    dlg.onclose = () => {
      if (dlg.returnValue === 'save') store.dispatch({ type: 'addMarker', robot: key, segIndex, label: $('mLabel').value.trim() || 'mark', waitS: +$('mWait').value || 0 });
      else if (dlg.returnValue === 'remove') store.dispatch({ type: 'removeMarker', robot: key, segIndex });
    };
    dlg.showModal();
  }

  // ---- drawing
  function finishDraw(e, drag) {
    const r = robot(), path = r.path, n = path.segments.length;
    const end = n ? path.segments[n - 1].end : path.startPose;
    const moved = Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY);
    const key = 'draw' + uid();
    const add = (kind, controls, to, from) => {
      const pts = [from, ...controls, to];
      store.dispatch({
        type: 'addSegment', robot: ui.robot, coalesce: key,
        segment: { kind, controls, end: { x: to.x, y: to.y, h: Math.round(normDeg(tangentAngle(pts, 0.999))) }, heading: { mode: 'linear' } },
      });
    };
    if (moved < 5) {
      const p = snapPt(evField(e), e);
      if (dist(p, end) >= 0.5) add('line', [], p, end);
    } else {
      const pts = drag.pts.slice();
      if (dist(end, pts[0]) < 8) pts[0] = { x: end.x, y: end.y }; else pts.unshift({ x: end.x, y: end.y });
      let prev = { x: end.x, y: end.y };
      const snap = ui.snap && !e.altKey;
      for (const s of fitStroke(pts)) {
        const to = snap ? { x: Math.round(s.end.x), y: Math.round(s.end.y) } : s.end;
        const to2 = { x: clamp(to.x, 0, FIELD), y: clamp(to.y, 0, FIELD) };
        if (dist(prev, to2) < 0.5) continue;
        add(s.kind, s.controls.map(c => ({ x: clamp(c.x, 0, FIELD), y: clamp(c.y, 0, FIELD) })), to2, prev);
        prev = to2;
      }
    }
    const len = robot().path.segments.length;
    ui.sel = len > n ? { seg: len - 1 } : ui.sel;
  }

  canvas.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    canvas.setPointerCapture(e.pointerId);
    const f = evField(e), base = { id: e.pointerId, downX: e.clientX, downY: e.clientY };
    if (ui.tool === 'start') {
      const p = snapPt(f, e);
      drag = { ...base, type: 'start', origin: p, key: 'st' + uid() };
      store.dispatch({ type: 'setStart', robot: ui.robot, pose: { x: p.x, y: p.y }, coalesce: drag.key });
    } else if (ui.tool === 'marker') {
      const i = hitEnd(e);
      if (i >= 0) { ui.sel = { seg: i }; openMarker(i); } else toast('Tap a segment endpoint to add an action.');
    } else {
      const h = hitHandle(e);
      if (h) {
        ui.sel = { seg: h.handle === 'start' ? -1 : h.segIndex };
        drag = { ...base, type: 'handle', h, key: 'mv' + uid() };
      } else if (ui.tool === 'select') {
        const hs = hitSegment(e);
        ui.sel = hs ? { seg: hs.i } : null;
      } else {
        drag = { ...base, type: 'draw', pts: [f] };
        ui.draft = drag.pts;
      }
    }
    app.dirty();
    refresh();
  });

  canvas.addEventListener('pointermove', e => {
    const f = evField(e), now = performance.now();
    if (now - lastCursor > 60) { lastCursor = now; app.sync.sendCursor(f.x, f.y); }
    if (!drag || drag.id !== e.pointerId) {
      if (!drag) canvas.style.cursor = (ui.tool === 'draw' || ui.tool === 'start') && !hitHandle(e) ? 'crosshair' : hitHandle(e) ? 'grab' : 'default';
      return;
    }
    if (drag.type === 'draw') {
      const last = drag.pts[drag.pts.length - 1];
      if (dist(last, f) > 0.4) { drag.pts.push(f); app.dirty(); }
    } else if (drag.type === 'start') {
      const o = drag.origin;
      const pose = { x: o.x, y: o.y };
      if (Math.hypot(f.x - o.x, f.y - o.y) > 2) pose.h = Math.round(deg(Math.atan2(f.y - o.y, f.x - o.x)));
      store.dispatch({ type: 'setStart', robot: ui.robot, pose, coalesce: drag.key });
    } else if (drag.type === 'handle') {
      const p = snapPt(f, e);
      store.dispatch({ type: 'moveHandle', robot: ui.robot, segIndex: drag.h.segIndex, handle: drag.h.handle, x: p.x, y: p.y, coalesce: drag.key });
    }
  });

  canvas.addEventListener('pointerup', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (d.type === 'draw') finishDraw(e, d);
    ui.draft = null;
    app.dirty();
    refresh();
  });
  canvas.addEventListener('pointercancel', () => { drag = null; ui.draft = null; app.dirty(); });

  canvas.addEventListener('dblclick', e => {
    if (ui.tool !== 'select') return;
    const i = hitEnd(e);
    if (i >= 0) { openMarker(i); return; }
    const hs = hitSegment(e);
    if (hs) { store.dispatch({ type: 'splitSegment', robot: ui.robot, segIndex: hs.i, u: hs.u }); ui.sel = { seg: hs.i }; app.dirty(); refresh(); }
  });
  canvas.addEventListener('pointerleave', () => app.sync.sendCursor(-999, -999));

  // ---- toolbar
  const chips = $('chips');
  function setTool(t) { ui.tool = t; app.dirty(); refresh(); }
  document.querySelectorAll('#toolBtns [data-tool]').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
  $('snap').onchange = e => { ui.snap = e.target.checked; };

  const patch = p => store.dispatch({ type: 'setRobot', robot: ui.robot, patch: p });
  $('rTeam').onchange = e => patch({ team: e.target.value });
  $('rW').onchange = e => patch({ size: { ...robot().size, w: clamp(+e.target.value || 18, 6, 30) } });
  $('rL').onchange = e => patch({ size: { ...robot().size, l: clamp(+e.target.value || 18, 6, 30) } });
  $('rVel').onchange = e => patch({ maxVel: Math.max(1, +e.target.value || 50) });
  $('rAcc').onchange = e => patch({ maxAccel: Math.max(1, +e.target.value || 40) });
  $('clearPath').onclick = () => {
    if (!robot().path.segments.length) return;
    ui.sel = null; store.dispatch({ type: 'clearPath', robot: ui.robot });
    const after = store.get();
    toast('Path cleared', { action: 'Undo', ms: 6000, onAction: () => { if (store.get() === after) store.undo(); } });
  };

  const toggleKind = i => {
    const s = robot().path.segments[i];
    if (!s) return;
    const pts = segPoints(robot().path, i), [a, b] = [pts[0], pts[pts.length - 1]];
    const third = t => ({ x: Math.round((a.x + (b.x - a.x) * t) * 100) / 100, y: Math.round((a.y + (b.y - a.y) * t) * 100) / 100 });
    store.dispatch({ type: 'setSegment', robot: ui.robot, segIndex: i, patch: s.kind === 'line' ? { kind: 'curve', controls: [third(1 / 3), third(2 / 3)] } : { kind: 'line', controls: [] } });
  };
  const delWaypoint = i => {
    ui.sel = null;
    store.dispatch(i < 0 ? { type: 'deleteStart', robot: ui.robot } : { type: 'deleteSegment', robot: ui.robot, segIndex: i });
  };

  // ---- waypoints panel
  const wpList = $('wpList');
  let wpRobot = null;
  const wpNum = (val, on) => {
    const i = document.createElement('input');
    i.type = 'number'; i.step = '1'; i.value = Math.round(val * 100) / 100;
    i.onclick = e => e.stopPropagation();
    i.onchange = () => { if (i.value !== '' && Number.isFinite(+i.value)) on(+i.value); else i.value = val; };
    return i;
  };
  function renderWaypoints(force) {
    const r = robot();
    if (!force && r === wpRobot) return;
    wpRobot = r;
    wpList.textContent = '';
    const rows = [{ idx: -1, p: r.path.startPose }, ...r.path.segments.map((s, i) => ({ idx: i, p: s.end, s }))];
    for (const { idx, p, s } of rows) {
      const row = document.createElement('div');
      row.className = 'wprow'; row.dataset.idx = idx;
      row.onclick = () => { ui.sel = { seg: idx }; app.dirty(); markSel(); };
      const n = document.createElement('span');
      n.className = 'idx'; n.textContent = idx < 0 ? 'S' : idx + 1;
      const cx = clamp;
      const x = wpNum(p.x, v => store.dispatch(idx < 0 ? { type: 'setStart', robot: ui.robot, pose: { x: cx(v, 0, FIELD) } } : { type: 'moveHandle', robot: ui.robot, segIndex: idx, handle: 'end', x: cx(v, 0, FIELD), y: p.y }));
      const y = wpNum(p.y, v => store.dispatch(idx < 0 ? { type: 'setStart', robot: ui.robot, pose: { y: cx(v, 0, FIELD) } } : { type: 'moveHandle', robot: ui.robot, segIndex: idx, handle: 'end', x: p.x, y: cx(v, 0, FIELD) }));
      const h = wpNum(p.h, v => store.dispatch({ type: 'setHeading', robot: ui.robot, segIndex: idx, h: normDeg(v) }));
      x.title = 'x (in)'; y.title = 'y (in)'; h.title = 'heading (deg)';
      const del = document.createElement('button');
      del.className = 'del'; del.textContent = '\u00d7'; del.title = idx < 0 ? 'Delete start (first end becomes the start)' : 'Delete waypoint';
      del.disabled = idx < 0 && !r.path.segments.length;
      del.onclick = e => { e.stopPropagation(); delWaypoint(idx); };
      row.append(n, x, y, h, del);
      const meta = document.createElement('div');
      meta.className = 'meta';
      if (s) {
        const badge = document.createElement('button');
        badge.className = 'badge ' + s.kind; badge.textContent = s.kind; badge.title = 'Toggle line / curve (L or C)';
        badge.onclick = e => { e.stopPropagation(); toggleKind(idx); };
        const mode = document.createElement('select');
        mode.className = 'badge'; mode.title = 'Heading mode';
        for (const m of ['linear', 'constant', 'tangential']) mode.add(new Option(m, m, false, m === s.heading.mode));
        mode.onclick = e => e.stopPropagation();
        mode.onchange = () => store.dispatch({ type: 'setHeading', robot: ui.robot, segIndex: idx, heading: { mode: mode.value, ...(s.heading.reverse ? { reverse: true } : {}) } });
        const rev = document.createElement('label');
        rev.title = 'Reversed (tangential)';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = !!s.heading.reverse; cb.disabled = s.heading.mode !== 'tangential';
        cb.onclick = e => e.stopPropagation();
        cb.onchange = () => store.dispatch({ type: 'setHeading', robot: ui.robot, segIndex: idx, heading: { mode: s.heading.mode, ...(cb.checked ? { reverse: true } : {}) } });
        rev.append(cb, ' rev');
        const mk = r.markers.find(k => k.segIndex === idx), lab = document.createElement('span');
        lab.className = 'mk'; lab.textContent = mk ? `${mk.label}${mk.waitS ? ' ' + mk.waitS + 's' : ''}` : '+ action';
        lab.style.cursor = 'pointer'; if (!mk) lab.style.color = 'var(--muted)';
        lab.onclick = e => { e.stopPropagation(); openMarker(idx); };
        meta.append(badge, mode, rev, lab);
      } else meta.textContent = 'start pose';
      row.appendChild(meta);
      wpList.appendChild(row);
    }
    markSel();
  }
  function markSel() {
    wpList.querySelectorAll('.wprow').forEach(r => r.classList.toggle('sel', !!ui.sel && +r.dataset.idx === ui.sel.seg));
    refreshHint();
  }

  // ---- top bar
  $('undo').onclick = () => store.undo();
  $('redo').onclick = () => store.redo();
  const curAuto = () => app.currentAuto();
  $('share').onclick = () => app.shareAuto(curAuto().id);
  $('downloadPP').onclick = () => app.downloadPP(curAuto().id);
  $('edBack').onclick = () => app.showLibrary();
  $('autoName').onchange = e => { const n = e.target.value.trim(); if (n) app.renameAuto(curAuto().id, n); else e.target.value = curAuto().name; };
  $('exportPng').onclick = () => { app.render(); canvas.toBlob(b => b && download(b, `${store.get().name.replace(/[^\w-]+/g, '_')}.png`)); };
  $('helpBtn').onclick = () => $('helpDlg').showModal();

  // ---- live room
  const roomStatus = msg => {
    if (msg) $('roomStatus').textContent = msg;
    const code = app.sync.room;
    $('roomCopy').hidden = !code; $('roomLeave').hidden = !code;
  };
  app.roomStatus = msg => { roomStatus(msg); if (!$('roomDlg').open) toast(msg); };
  app.setPeers = n => document.querySelectorAll('.peerCount').forEach(el => { el.textContent = n; el.hidden = !n; });
  const openRoom = () => { roomStatus(); $('roomDlg').showModal(); };
  $('room').onclick = openRoom; $('libRoom').onclick = openRoom; $('libHelp').onclick = () => $('helpDlg').showModal();
  $('roomStart').onclick = async () => { $('roomStatus').textContent = 'Starting...'; await app.sync.startRoom(); roomStatus(); };
  $('roomJoin').onclick = async () => { const c = $('roomCode').value.trim(); if (c) { $('roomStatus').textContent = 'Connecting...'; await app.sync.joinRoom(c); roomStatus(); } };
  $('roomLeave').onclick = () => { app.sync.leave(); $('roomStatus').textContent = 'Left the room.'; roomStatus(); };
  $('roomCopy').onclick = async () => {
    const url = `${location.href.split('#')[0]}#room=${app.sync.room}`;
    try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch { prompt('Invite link', url); }
  };

  // ---- field image
  const bgOp = d => { try { return +localStorage.getItem('bubblotics.autosim.bgop') || d; } catch { return d; } };
  const showImg = (src, d) => {
    const img = new Image();
    img.onload = () => { ui.bg = { img, opacity: bgOp(d) }; $('bgOpacity').value = ui.bg.opacity; app.dirty(); };
    img.src = src;
  };
  const defaultBg = () => showImg('./field.png', 1);
  const setBg = blob => showImg(URL.createObjectURL(blob), 0.5);
  defaultBg();
  idb('readonly', s => s.get('bg')).then(b => { if (b) setBg(b); }).catch(() => {});
  $('bgPick').onclick = () => $('bgFile').click();
  $('bgFile').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBg(f);
    try { await idb('readwrite', s => s.put(f, 'bg')); } catch { toast('Image shown, but could not be saved for next time.'); }
  };
  $('bgClear').onclick = () => { defaultBg(); idb('readwrite', s => s.delete('bg')).catch(() => {}); };
  $('zones').onchange = e => { ui.zones = e.target.checked; app.dirty(); };
  $('bgOpacity').oninput = e => {
    if (ui.bg) ui.bg.opacity = +e.target.value;
    try { localStorage.setItem('bubblotics.autosim.bgop', e.target.value); } catch { /* ignore */ }
    app.dirty();
  };

  // ---- timeline
  $('play').onclick = () => togglePlay();
  $('restart').onclick = () => { ui.t = 0; ui.playing = false; app.dirty(); tick(); };
  $('scrub').oninput = e => { ui.t = +e.target.value; ui.playing = false; app.dirty(); tick(); };
  function togglePlay() {
    if (!ui.playing && ui.t >= AUTO_SECONDS - 0.01) ui.t = 0;
    ui.playing = !ui.playing;
    tick();
  }
  function tick() {
    $('play').textContent = ui.playing ? 'Pause' : 'Play';
    $('scrub').value = ui.t;
    const c = $('clock');
    c.textContent = `${ui.t.toFixed(1)} / ${AUTO_SECONDS} s`;
  }

  function refreshTimeline(b) {
    const keys = ROBOT_KEYS.filter(k => !ui.hidden.has(k));
    ui.conflicts = findConflicts({ ...b, robots: Object.fromEntries(keys.map(k => [k, b.robots[k]])) });
    const sw = $('startWarn');
    sw.textContent = keys.flatMap(k => startIssues(k, b.robots[k].path.startPose, b.robots[k].size).map(m => `${ROBOT_LABEL[k]} start: ${m}`)).join(' | ');
    const bar = $('conflictBar');
    bar.textContent = '';
    for (const c of ui.conflicts) {
      const i = document.createElement('i');
      i.style.left = `${c.t0 / AUTO_SECONDS * 100}%`;
      i.style.width = `${Math.max(0.6, (c.t1 - c.t0 + 0.1) / AUTO_SECONDS * 100)}%`;
      bar.appendChild(i);
    }
    const list = $('conflicts');
    list.textContent = '';
    for (const c of ui.conflicts) {
      const bt = document.createElement('button');
      bt.textContent = `${c.a.toUpperCase()} x ${c.b.toUpperCase()}  ${c.t0.toFixed(1)}-${c.t1.toFixed(1)} s`;
      bt.onclick = () => { ui.t = c.t0; ui.playing = false; app.dirty(); tick(); };
      list.appendChild(bt);
    }
    if (!ui.conflicts.length) list.textContent = 'No footprint overlaps in the first 30 s.';
    const d = $('durations');
    d.textContent = '';
    for (const k of keys) {
      const t = totalTime(b.robots[k]), s = document.createElement('span');
      s.style.borderColor = b.robots[k].color; s.textContent = `${k.toUpperCase()} ${t.toFixed(1)}s`;
      if (t > AUTO_SECONDS) { s.className = 'over'; s.title = 'Longer than the 30 s autonomous period'; }
      d.appendChild(s);
    }
  }

  const setVal = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
  function refreshHint() {
    $('hint').textContent = {
      draw: 'Drag to sketch a path, click to add a straight line.',
      select: 'Drag handles. Double-click a segment to insert a waypoint, an endpoint for a marker.',
      start: 'Click to place the start, drag to aim the heading.',
      marker: 'Tap a segment endpoint to add a labeled wait.',
    }[ui.tool];
  }
  function refresh() {
    const b = store.get(), r = b.robots[ui.robot];
    if (!r) return;
    const auto = app.currentAuto();
    if (auto && document.activeElement !== $('autoName')) $('autoName').value = auto.name;
    chips.textContent = '';
    for (const l of app.legend()) {
      const c = document.createElement('button');
      c.className = 'chip ro' + (l.key === ui.robot ? ' on' : '') + (l.autoId ? '' : ' empty');
      c.style.borderLeftColor = l.color; c.style.borderLeftWidth = '5px';
      c.textContent = `${l.label}: ${l.name || 'empty'}`;
      c.title = l.autoId && l.key !== ui.robot ? 'Open this auto' : '';
      if (l.autoId && l.key !== ui.robot) c.onclick = () => app.openAuto(l.autoId);
      chips.appendChild(c);
    }
    document.querySelectorAll('#toolBtns [data-tool]').forEach(x => x.classList.toggle('on', x.dataset.tool === ui.tool));
    $('snap').checked = ui.snap;
    setVal('rTeam', r.team); setVal('rW', r.size.w); setVal('rL', r.size.l);
    setVal('rVel', r.maxVel); setVal('rAcc', r.maxAccel);
    if (ui.sel && ui.sel.seg >= 0 && !r.path.segments[ui.sel.seg]) ui.sel = null;
    renderWaypoints(false);
    markSel();
    $('undo').disabled = !store.canUndo(); $('redo').disabled = !store.canRedo();
    const b2 = store.get();
    if (b2 !== lastBoard) {
      const prev = lastBoard;
      lastBoard = b2;
      if (!prev || prev.id !== b2.id || prev.robots !== b2.robots) refreshTimeline(b2);
    }
    tick();
  }

  // ---- keyboard
  addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) && !(tag === 'input' && ['range', 'checkbox'].includes(e.target.type) && e.key !== ' ')) return;
    if (document.querySelector('dialog[open]') || $('editorView').hidden) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); store.redo(); return; }
    if (mod || e.altKey) return;
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 'd') setTool('draw');
    else if (k === 's') setTool('select');
    else if (k === 'p') setTool('start');
    else if (k === 'm') setTool('marker');
    else if (k === 'z') { ui.zones = !ui.zones; $('zones').checked = ui.zones; app.dirty(); }
    else if (k === 'g') { ui.snap = !ui.snap; refresh(); }
    else if (k === '?' || k === '/') $('helpDlg').showModal();
    else if (k === 'delete' || k === 'backspace') { if (ui.sel) { e.preventDefault(); delWaypoint(ui.sel.seg); } }
    else if (k === 'l' || k === 'c') { if (ui.sel && ui.sel.seg >= 0) toggleKind(ui.sel.seg); }
    else if (k === 'arrowleft' || k === 'arrowright') { ui.t = clamp(ui.t + (k === 'arrowright' ? 0.5 : -0.5), 0, AUTO_SECONDS); ui.playing = false; app.dirty(); tick(); }
  });

  return { refresh, tick, togglePlay, forceWaypoints: () => renderWaypoints(true) };
}

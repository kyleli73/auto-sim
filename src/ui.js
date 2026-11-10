import { FIELD, dist, deg, tangentAngle, fitStroke, segPoints, normDeg } from './geometry.js';
import { AUTO_SECONDS, findConflicts, totalTime } from './profile.js';
import { ROBOT_KEYS, ROBOT_LABEL, uid } from './store.js';
import { toField, toScreen, handlePositions } from './render.js';
import { encodeBoard, shareUrl } from './share.js';

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

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
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
  function hitSegment(e) {
    const r = robot(), p = evPx(e);
    let best = -1, bd = 12;
    r.path.segments.forEach((_, i) => {
      const pts = segPoints(r.path, i);
      for (let k = 0; k <= 24; k++) {
        const q = bezierAt(pts, k / 24), [sx, sy] = toScreen(app.view, q.x, q.y), d = Math.hypot(sx - p.x, sy - p.y);
        if (d < bd) { bd = d; best = i; }
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
  function openMarker(segIndex) {
    const r = robot(), m = r.markers.find(k => k.segIndex === segIndex);
    $('mLabel').value = m ? m.label : '';
    $('mWait').value = m ? m.waitS : 1;
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
        ui.sel = { seg: h.segIndex };
        drag = { ...base, type: 'handle', h, key: 'mv' + uid() };
      } else if (ui.tool === 'select') {
        const i = hitSegment(e);
        ui.sel = i >= 0 ? { seg: i } : null;
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
    if (i >= 0) openMarker(i);
  });
  canvas.addEventListener('pointerleave', () => app.sync.sendCursor(-999, -999));

  // ---- toolbar
  const chips = $('chips');
  ROBOT_KEYS.forEach((k, i) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.robot = k; b.title = `${ROBOT_LABEL[k]} (${i + 1})`;
    b.onclick = () => setRobot(k);
    chips.appendChild(b);
  });
  function setRobot(k) { ui.robot = k; ui.sel = null; app.dirty(); refresh(); }
  function setTool(t) { ui.tool = t; app.dirty(); refresh(); }
  document.querySelectorAll('#toolBtns [data-tool]').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
  $('snap').onchange = e => { ui.snap = e.target.checked; };

  const patch = p => store.dispatch({ type: 'setRobot', robot: ui.robot, patch: p });
  $('rTeam').onchange = e => patch({ team: e.target.value });
  $('rColor').onchange = e => patch({ color: e.target.value });
  $('rW').onchange = e => patch({ size: { ...robot().size, w: clamp(+e.target.value || 18, 6, 30) } });
  $('rL').onchange = e => patch({ size: { ...robot().size, l: clamp(+e.target.value || 18, 6, 30) } });
  $('rVel').onchange = e => patch({ maxVel: Math.max(1, +e.target.value || 50) });
  $('rAcc').onchange = e => patch({ maxAccel: Math.max(1, +e.target.value || 40) });
  $('clearPath').onclick = () => { if (robot().path.segments.length && confirm(`Clear ${ROBOT_LABEL[ui.robot]}'s path?`)) { ui.sel = null; store.dispatch({ type: 'clearPath', robot: ui.robot }); } };

  const seg = () => ui.sel && robot().path.segments[ui.sel.seg];
  $('segKind').onclick = () => {
    const i = ui.sel.seg, s = seg(), pts = segPoints(robot().path, i), [a, b] = [pts[0], pts[pts.length - 1]];
    const third = t => ({ x: Math.round((a.x + (b.x - a.x) * t) * 100) / 100, y: Math.round((a.y + (b.y - a.y) * t) * 100) / 100 });
    store.dispatch({ type: 'setSegment', robot: ui.robot, segIndex: i, patch: s.kind === 'line' ? { kind: 'curve', controls: [third(1 / 3), third(2 / 3)] } : { kind: 'line', controls: [] } });
  };
  $('segDel').onclick = () => { const i = ui.sel.seg; ui.sel = null; store.dispatch({ type: 'deleteSegment', robot: ui.robot, segIndex: i }); };
  const setHeading = p => store.dispatch({ type: 'setHeading', robot: ui.robot, segIndex: ui.sel.seg, ...p });
  $('segMode').onchange = e => setHeading({ heading: { mode: e.target.value, ...(seg().heading.reverse ? { reverse: true } : {}) } });
  $('segRev').onchange = e => setHeading({ heading: { mode: seg().heading.mode, ...(e.target.checked ? { reverse: true } : {}) } });
  $('segH').onchange = e => setHeading({ h: normDeg(+e.target.value || 0) });

  // ---- top bar
  $('undo').onclick = () => store.undo();
  $('redo').onclick = () => store.redo();
  $('mirror').onclick = e => {
    const to = e.shiftKey ? ui.robot : undefined;
    store.dispatch({ type: 'mirror', from: ui.robot, to });
    toast(e.shiftKey ? `Mirrored ${ROBOT_LABEL[ui.robot]} in place` : 'Mirrored path copied to the other alliance');
  };
  $('share').onclick = async () => {
    try {
      const url = shareUrl(location.href, await encodeBoard(store.get()));
      try { await navigator.clipboard.writeText(url); toast(`Share link copied (${url.length} chars)`); }
      catch { prompt('Copy this share link', url); }
    } catch { toast('Could not build a share link in this browser.'); }
  };
  $('exportJson').onclick = () => download(new Blob([JSON.stringify(store.get(), null, 2)], { type: 'application/json' }), `${store.get().name.replace(/[^\w-]+/g, '_')}.json`);
  $('importJson').onclick = () => $('importFile').click();
  $('importFile').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { app.boards.importRaw(JSON.parse(await f.text())); toast('Imported as a new board'); } catch { toast('That file is not a valid board.'); }
  };
  $('exportPng').onclick = () => { app.render(); canvas.toBlob(b => b && download(b, `${store.get().name.replace(/[^\w-]+/g, '_')}.png`)); };
  $('helpBtn').onclick = () => $('helpDlg').showModal();

  // ---- boards dialog
  function renderBoards() {
    const ul = $('boardList');
    ul.textContent = '';
    const list = Object.values(app.lib.boards).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const b of list) {
      const li = document.createElement('li');
      if (b.id === store.get().id) li.className = 'cur';
      const nm = document.createElement('span');
      nm.className = 'nm'; nm.textContent = b.name; nm.title = new Date(b.updatedAt).toLocaleString();
      nm.onclick = () => { app.boards.open(b.id); $('boardsDlg').close(); };
      li.appendChild(nm);
      const btn = (label, fn) => { const x = document.createElement('button'); x.className = 'btn'; x.textContent = label; x.onclick = () => { fn(); renderBoards(); }; li.appendChild(x); };
      btn('Rename', () => { const n = prompt('Board name', b.name); if (n && n.trim()) app.boards.rename(b.id, n.trim()); });
      btn('Duplicate', () => app.boards.duplicate(b.id));
      btn('Delete', () => { if (confirm(`Delete "${b.name}"?`)) app.boards.remove(b.id); });
      ul.appendChild(li);
    }
  }
  $('boardName').onclick = () => { app.boards.flush(); renderBoards(); $('boardsDlg').showModal(); };
  $('newBoard').onclick = () => { const n = prompt('Board name', 'Q1 vs '); if (n !== null) { app.boards.create(n.trim() || 'Untitled board'); renderBoards(); } };

  // ---- live room
  const roomStatus = msg => {
    if (msg) $('roomStatus').textContent = msg;
    const code = app.sync.room;
    $('roomCopy').hidden = !code; $('roomLeave').hidden = !code;
  };
  app.roomStatus = msg => { roomStatus(msg); if (!$('roomDlg').open) toast(msg); };
  app.setPeers = n => { $('peerCount').textContent = n; $('peerCount').hidden = !n; };
  $('room').onclick = () => { roomStatus(); $('roomDlg').showModal(); };
  $('roomStart').onclick = async () => { $('roomStatus').textContent = 'Starting...'; await app.sync.startRoom(); roomStatus(); };
  $('roomJoin').onclick = async () => { const c = $('roomCode').value.trim(); if (c) { $('roomStatus').textContent = 'Connecting...'; await app.sync.joinRoom(c); roomStatus(); } };
  $('roomLeave').onclick = () => { app.sync.leave(); $('roomStatus').textContent = 'Left the room.'; roomStatus(); };
  $('roomCopy').onclick = async () => {
    const url = `${location.href.split('#')[0]}#room=${app.sync.room}`;
    try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch { prompt('Invite link', url); }
  };

  // ---- field image
  const bgOp = () => { try { return +localStorage.getItem('bubblotics.autosim.bgop') || 0.5; } catch { return 0.5; } };
  const setBg = blob => {
    if (!blob) { ui.bg = null; app.dirty(); return; }
    const img = new Image(), url = URL.createObjectURL(blob);
    img.onload = () => { ui.bg = { img, opacity: bgOp() }; $('bgOpacity').value = ui.bg.opacity; app.dirty(); };
    img.src = url;
  };
  idb('readonly', s => s.get('bg')).then(setBg).catch(() => {});
  $('bgPick').onclick = () => $('bgFile').click();
  $('bgFile').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBg(f);
    try { await idb('readwrite', s => s.put(f, 'bg')); } catch { toast('Image shown, but could not be saved for next time.'); }
  };
  $('bgClear').onclick = () => { setBg(null); idb('readwrite', s => s.delete('bg')).catch(() => {}); };
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
    ui.conflicts = findConflicts(b);
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
    for (const k of ROBOT_KEYS) {
      const t = totalTime(b.robots[k]), s = document.createElement('span');
      s.style.borderColor = b.robots[k].color; s.textContent = `${k.toUpperCase()} ${t.toFixed(1)}s`;
      if (t > AUTO_SECONDS) { s.className = 'over'; s.title = 'Longer than the 30 s autonomous period'; }
      d.appendChild(s);
    }
  }

  const setVal = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
  function refresh() {
    const b = store.get(), r = b.robots[ui.robot];
    $('boardName').textContent = b.name;
    chips.querySelectorAll('.chip').forEach(c => {
      const k = c.dataset.robot, rr = b.robots[k];
      c.classList.toggle('on', k === ui.robot);
      c.style.borderLeftColor = rr.color;
      c.textContent = ROBOT_LABEL[k] + (rr.team ? ` ${rr.team}` : '');
    });
    document.querySelectorAll('#toolBtns [data-tool]').forEach(x => x.classList.toggle('on', x.dataset.tool === ui.tool));
    $('snap').checked = ui.snap;
    setVal('rTeam', r.team); setVal('rColor', r.color); setVal('rW', r.size.w); setVal('rL', r.size.l);
    setVal('rVel', r.maxVel); setVal('rAcc', r.maxAccel);
    const s = ui.sel && r.path.segments[ui.sel.seg];
    if (ui.sel && !s) ui.sel = null;
    $('segPanel').hidden = !s;
    if (s) {
      $('segTitle').textContent = `#${ui.sel.seg + 1}`;
      $('segKind').textContent = s.kind === 'line' ? 'Make curve' : 'Make line';
      setVal('segMode', s.heading.mode); setVal('segH', Math.round(s.end.h));
      $('segRev').checked = !!s.heading.reverse;
    }
    $('undo').disabled = !store.canUndo(); $('redo').disabled = !store.canRedo();
    $('hint').textContent = {
      draw: 'Drag to sketch a path, click to add a straight line.',
      select: 'Drag handles. Double-click an endpoint for a marker.',
      start: 'Click to place the start, drag to aim the heading.',
      marker: 'Tap a segment endpoint to add a labeled wait.',
    }[ui.tool];
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
    if (document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); store.redo(); return; }
    if (mod || e.altKey) return;
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if ('1234'.includes(k) && k.length === 1) setRobot(ROBOT_KEYS[+k - 1]);
    else if (k === 'd') setTool('draw');
    else if (k === 's') setTool('select');
    else if (k === 'p') setTool('start');
    else if (k === 'm') setTool('marker');
    else if (k === 'g') { ui.snap = !ui.snap; refresh(); }
    else if (k === '?' || k === '/') $('helpDlg').showModal();
    else if (k === 'delete' || k === 'backspace') { if (ui.sel) { e.preventDefault(); const i = ui.sel.seg; ui.sel = null; store.dispatch({ type: 'deleteSegment', robot: ui.robot, segIndex: i }); } }
    else if (k === 'arrowleft' || k === 'arrowright') { ui.t = clamp(ui.t + (k === 'arrowright' ? 0.5 : -0.5), 0, AUTO_SECONDS); ui.playing = false; app.dirty(); tick(); }
  });

  return { refresh, tick, togglePlay };
}

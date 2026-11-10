import { createStore, newBoard, newRobot, uid, ROBOT_KEYS, ROBOT_LABEL } from './store.js';
import { AUTO_SECONDS } from './profile.js';
import { draw } from './render.js';
import { createSync } from './sync.js';
import { encodeBoard, decodeBoard, parseHash, shareUrl } from './share.js';
import { initUI } from './ui.js';
import { initLibrary } from './library-ui.js';
import { parsePedro, toPP } from './pedro.js';
import {
  loadLib, saveLib, newAuto, newBoardRec, normalizeAuto, normalizeBoardRec, addAuto, patchAuto, duplicateAuto, removeAuto, restoreAuto,
  assign, mergeAuto, mergeBoard, mergeLib, editorBoard, robotFromAuto, autoFromRobot, shareAuto, shareBoard, parseShared, importShared,
  autoFromPedro, slotOf,
} from './library.js';

const $ = id => document.getElementById(id);
const storage = (() => { try { localStorage.getItem('x'); return localStorage; } catch { return { getItem: () => null, setItem() { throw new Error('no storage'); } }; } })();
const clientId = uid();
const store = createStore(newBoard('editor'), { author: clientId });

const ui = {
  robot: 'r1', tool: 'draw', sel: null, t: 0, playing: false, snap: true, draft: null,
  bg: null, zones: false, startWarn: [], peers: new Map(), conflicts: [], hot: new Set(), hidden: new Set(),
};
const app = {
  store, ui, lib: loadLib(storage), filter: { team: '', query: '', sort: 'new' }, lastAutoId: '', ed: null,
  view: { w: 1, h: 1, scale: 1, ox: 0, oy: 0, size: 1 }, toast() {}, roomStatus() {}, setPeers() {},
};
let needsDraw = true, saveTimer = 0, controls, library;
app.dirty = () => { needsDraw = true; };

const flush = () => { clearTimeout(saveTimer); saveLib(storage, app.lib); };
const commit = next => { app.lib = next; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); library?.render(); };
const board = () => app.lib.boards[app.lib.activeBoardId];
const sendBoard = id => app.lib.boards[id] && sync.sendBoard(app.lib.boards[id]);
const fileBase = s => (s || 'auto').replace(/[^\w-]+/g, '_');

// ---- editor <-> library bridge ----
app.currentAuto = () => app.lib.autos[app.ed?.autoId];
// The auto shown in slot k of the editor: the edited auto in its own slot, the board's other autos elsewhere.
const autoFor = k => {
  const ed = app.ed, id = board().slots[k];
  return k === ed.key ? app.lib.autos[ed.autoId] : id !== ed.autoId ? app.lib.autos[id] : null;
};
app.legend = () => ROBOT_KEYS.map(k => {
  const a = autoFor(k);
  return { key: k, label: ROBOT_LABEL[k], color: newRobot(k).color, autoId: a?.id || '', name: a?.name || '' };
});
const sigOf = k => { const a = autoFor(k); return a ? `${a.id}:${a.updatedAt}:${a.alliance}:${k}` : ''; };
// Pull library changes (peers, slot assignments) into the open editor without touching undo history.
function syncSlots() {
  if (!app.ed) return;
  const ed = app.ed;
  for (const k of ROBOT_KEYS) {
    const sig = sigOf(k);
    if (sig === ed.sig[k]) continue;
    ed.sig[k] = sig;
    const a = autoFor(k);
    store.dispatch({ type: 'replaceRobot', key: k, robot: a ? robotFromAuto(a, k) : newRobot(k) });
    if (a) ui.hidden.delete(k); else ui.hidden.add(k);
  }
  needsDraw = true;
  controls.forceWaypoints();
  controls.refresh();
}

function show(view) {
  $('libraryView').hidden = view !== 'library';
  $('editorView').hidden = view !== 'editor';
  if (view === 'library') library.render(); else { needsDraw = true; controls.refresh(); }
}
app.showLibrary = () => { flush(); ui.playing = false; app.ed = null; show('library'); };
app.openAuto = id => {
  const a = app.lib.autos[id];
  if (!a) return;
  flush();
  const { board: eb, key, present } = editorBoard(app.lib, app.lib.activeBoardId, id);
  app.ed = { autoId: id, key, sig: {} };
  app.lastAutoId = id;
  ui.robot = key; ui.sel = null; ui.t = 0; ui.playing = false;
  ui.hidden = new Set(ROBOT_KEYS.filter(k => !present.includes(k)));
  store.dispatch({ type: 'loadBoard', board: eb });
  for (const k of ROBOT_KEYS) app.ed.sig[k] = sigOf(k);
  show('editor');
  controls.forceWaypoints();
};

store.subscribe((b, meta) => {
  needsDraw = true;
  const ed = app.ed;
  if (ed && !meta.remote && meta.type !== 'loadBoard') {
    const r = b.robots[ed.key];
    if (r !== meta.prev.robots[ed.key] && app.lib.autos[ed.autoId]) {
      const next = autoFromRobot(app.lib.autos[ed.autoId], r);
      commit(addAuto(app.lib, next));
      ed.sig[ed.key] = sigOf(ed.key);
      sync.sendAuto(next);
    }
  }
  controls.refresh();
});

// ---- actions used by the library screen ----
const bump = (a, patch = {}) => ({ ...a, ...patch, updatedAt: Math.max(Date.now(), a.updatedAt + 1), author: clientId });
app.act = {
  assign(slot, autoId) {
    commit(assign(app.lib, app.lib.activeBoardId, slot, autoId, Date.now()));
    sendBoard(app.lib.activeBoardId);
  },
  rename(id, name) {
    const a = app.lib.autos[id];
    if (!a) return;
    const n = bump(a, { name });
    commit(addAuto(app.lib, n)); sync.sendAuto(n);
  },
  duplicate(id) {
    const r = duplicateAuto(app.lib, id, Date.now(), clientId);
    commit(r.lib); if (r.id) sync.sendAuto(r.lib.autos[r.id]);
  },
  remove(id) {
    const before = app.lib, r = removeAuto(before, id, Date.now());
    if (!r.undo) return;
    commit(r.lib);
    for (const bid of new Set(r.undo.slots.map(s => s.boardId))) sendBoard(bid);
    app.toast(`Deleted "${r.undo.auto.name}"`, {
      action: 'Undo', ms: 6000,
      onAction: () => {
        const back = restoreAuto(app.lib, r.undo, Date.now());
        commit(back);
        sync.sendAuto(back.autos[id]);
        for (const bid of new Set(r.undo.slots.map(s => s.boardId))) sendBoard(bid);
      },
    });
  },
  create({ name, team, alliance }) {
    const a = newAuto({ name, team, alliance, author: clientId });
    commit(addAuto(app.lib, a)); sync.sendAuto(a);
    app.openAuto(a.id);
  },
  setBoard(id) { if (app.lib.boards[id]) commit({ ...app.lib, activeBoardId: id }); },
  newBoard(name) {
    const b = newBoardRec(name);
    commit({ ...app.lib, boards: { ...app.lib.boards, [b.id]: b }, activeBoardId: b.id });
    sendBoard(b.id);
  },
  renameBoard(name) {
    const b = board();
    commit({ ...app.lib, boards: { ...app.lib.boards, [b.id]: { ...b, name, updatedAt: Date.now() } } });
    sendBoard(b.id);
  },
  async importFiles(files) {
    const items = [];
    for (const f of files) { try { items.push({ name: f.name, text: await f.text() }); } catch { items.push({ name: f.name, text: '' }); } }
    app.act.importTexts(items, app.filter.team);
  },
  importTexts(items, team) {
    let added = 0;
    const warnings = [];
    let lib = app.lib;
    const fresh = [];
    for (const it of items) {
      const name = it.name || 'Pasted auto';
      if (!it.text.trim()) { warnings.push(`${name}: empty`); continue; }
      let shared = null;
      if (/^\s*\{/.test(it.text) && /"kind"\s*:\s*"autos"|"robots"/.test(it.text)) { try { shared = parseShared(JSON.parse(it.text)); } catch { /* fall through */ } }
      if (shared) { lib = importShared(lib, shared); fresh.push(...shared.autos); added += shared.autos.length; continue; }
      const r = parsePedro(it.text, it.name || '');
      warnings.push(...r.warnings);
      for (const p of r.autos) {
        const a = autoFromPedro(p, { team, alliance: p.path.startPose.y > 72 ? 'blue' : 'red', author: clientId });
        if (it.name === '' && r.autos.length === 1) a.name = 'Pasted auto';
        lib = addAuto(lib, a); fresh.push(a); added++;
      }
    }
    commit(lib);
    fresh.forEach(a => sync.sendAuto(a));
    const w = warnings.length ? ` Warnings: ${warnings.slice(0, 3).join('; ')}${warnings.length > 3 ? ` (+${warnings.length - 3} more)` : ''}` : '';
    app.toast(added ? `Imported ${added} auto${added > 1 ? 's' : ''} from ${items.length} source${items.length > 1 ? 's' : ''}.${w}` : `Nothing imported.${w}`, { ms: warnings.length ? 9000 : 4000 });
  },
};

app.downloadPP = id => {
  const a = app.lib.autos[id];
  if (!a) return;
  const x = document.createElement('a');
  x.href = URL.createObjectURL(new Blob([toPP(a)], { type: 'application/json' }));
  x.download = `${fileBase(a.name)}.pp`;
  x.click();
  setTimeout(() => URL.revokeObjectURL(x.href), 2000);
};
async function copyLink(payload, label) {
  try {
    const url = shareUrl(location.href, await encodeBoard(payload));
    try { await navigator.clipboard.writeText(url); app.toast(`${label} link copied (${url.length} chars)`); } catch { prompt('Copy this share link', url); }
  } catch { app.toast('Could not build a share link in this browser.'); }
}
app.shareAuto = id => app.lib.autos[id] && copyLink(shareAuto(app.lib.autos[id]), 'Auto');
app.shareBoard = () => copyLink(shareBoard(app.lib, board().id), 'Board');

// ---- live sync ----
const sync = createSync({
  clientId,
  getLib: () => ({ autos: app.lib.autos, boards: app.lib.boards }),
  getAutoId: () => app.ed?.autoId || '',
  onAuto(raw) {
    try {
      const next = mergeAuto(app.lib, normalizeAuto(raw));
      if (next !== app.lib) { commit(next); syncSlots(); }
    } catch { /* ignore malformed peer data */ }
  },
  onBoard(raw) {
    try {
      const next = mergeBoard(app.lib, normalizeBoardRec(raw));
      if (next !== app.lib) { commit(next); syncSlots(); }
    } catch { /* ignore malformed peer data */ }
  },
  onSnapshot(raw) {
    try { commit(mergeLib(app.lib, raw)); syncSlots(); app.toast('Synced the autos library from the room'); } catch { app.toast('Received an invalid library from the room.'); }
  },
  onCursor(id, x, y) {
    if (x === null || x < -100) ui.peers.delete(id); else ui.peers.set(id, { x, y, seen: performance.now() });
    needsDraw = true;
  },
  onPeers: n => app.setPeers(n),
  onStatus: msg => app.roomStatus(msg),
});
app.sync = sync;

// ---- canvas loop ----
const canvas = $('field');
const ctx = canvas.getContext('2d');
const stage = $('stage');

function render() {
  const w = stage.clientWidth, h = stage.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ui.hot = new Set();
  for (const c of ui.conflicts) if (ui.t >= c.t0 - 1e-6 && ui.t <= c.t1 + 0.05) { ui.hot.add(c.a); ui.hot.add(c.b); }
  app.view = draw(ctx, w, h, store.get(), ui);
}
app.render = render;

controls = initUI(app);
library = initLibrary(app);
new ResizeObserver(() => { needsDraw = true; }).observe(stage);
show('library');

let last = performance.now();
(function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app.ed) {
    if (ui.playing) {
      ui.t += dt;
      if (ui.t >= AUTO_SECONDS) { ui.t = AUTO_SECONDS; ui.playing = false; }
      controls.tick();
      needsDraw = true;
    }
    if (needsDraw || ui.peers.size) { needsDraw = false; render(); }
  }
  requestAnimationFrame(frame);
})(last);

addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

async function handleHash() {
  const h = parseHash(location.hash);
  if (!h) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (h.kind === 'room') { sync.joinRoom(h.value); return; }
  try {
    const parsed = parseShared(await decodeBoard(h.value));
    commit(importShared(app.lib, parsed));
    parsed.autos.forEach(a => sync.sendAuto(a));
    app.toast(parsed.board ? `Opened board "${parsed.board.name}" with ${parsed.autos.length} autos` : `Added ${parsed.autos.length} shared auto${parsed.autos.length === 1 ? '' : 's'}`);
  } catch { app.toast('That share link is not valid.'); }
}
addEventListener('hashchange', handleHash);
handleHash();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
void patchAuto; void slotOf;

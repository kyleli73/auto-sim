import { createStore, readLibrary, writeLibrary, newBoard, normalizeBoard, uid, ROBOT_KEYS } from './store.js';
import { AUTO_SECONDS } from './profile.js';
import { draw } from './render.js';
import { createSync } from './sync.js';
import { decodeBoard, parseHash } from './share.js';
import { initUI } from './ui.js';

const storage = (() => { try { localStorage.getItem('x'); return localStorage; } catch { return { getItem: () => null, setItem() { throw new Error('no storage'); } }; } })();
const clientId = uid();
const lib = readLibrary(storage);
const store = createStore(lib.boards[lib.currentId], { author: clientId });

const ui = {
  robot: 'r1', tool: 'draw', sel: null, t: 0, playing: false, snap: true, draft: null,
  bg: null, peers: new Map(), conflicts: [], hot: new Set(),
};
const app = { store, ui, lib, view: { w: 1, h: 1, scale: 1, ox: 0, oy: 0, size: 1 }, toast() {}, roomStatus() {}, setPeers() {} };
let needsDraw = true, saveTimer = 0;
app.dirty = () => { needsDraw = true; };

const flush = () => {
  lib.boards[store.get().id] = store.get();
  lib.currentId = store.get().id;
  writeLibrary(storage, lib);
};
const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); };

function open(id, skipFlush) {
  if (!skipFlush) flush();
  if (!lib.boards[id]) return;
  lib.currentId = id;
  ui.sel = null; ui.t = 0; ui.playing = false;
  store.dispatch({ type: 'loadBoard', board: lib.boards[id] });
}
function add(board) { flush(); lib.boards[board.id] = board; open(board.id, true); }
const clone = b => normalizeBoard(JSON.parse(JSON.stringify(b)));

app.boards = {
  flush, open,
  create: name => add(newBoard(name)),
  rename(id, name) {
    if (id === store.get().id) { store.dispatch({ type: 'renameBoard', name }); flush(); }
    else lib.boards[id] = { ...lib.boards[id], name, updatedAt: Date.now() };
    writeLibrary(storage, lib);
  },
  duplicate(id) {
    if (id === store.get().id) flush();
    const b = clone(lib.boards[id]);
    b.id = uid(); b.name = `${b.name} copy`; b.updatedAt = Date.now();
    lib.boards[b.id] = b;
    writeLibrary(storage, lib);
  },
  remove(id) {
    const cur = id === store.get().id;
    delete lib.boards[id];
    if (cur) {
      const next = Object.keys(lib.boards)[0];
      if (next) { lib.currentId = next; ui.sel = null; store.dispatch({ type: 'loadBoard', board: lib.boards[next] }); }
      else add(newBoard('Untitled board'));
    }
    writeLibrary(storage, lib);
  },
  importRaw(raw) { const b = normalizeBoard(raw); b.id = uid(); add(b); },
};

const sync = createSync({
  clientId,
  getBoard: () => store.get(),
  onRobot(key, robot) {
    try {
      const r = normalizeBoard({ robots: { [key]: robot } }).robots[key];
      if (ROBOT_KEYS.includes(key)) store.dispatch({ type: 'remoteUpdate', key, robot: r });
    } catch { /* ignore malformed peer data */ }
  },
  onSnapshot(raw) {
    try {
      const b = normalizeBoard(raw);
      add(b);
      app.toast(`Joined "${b.name}"`);
    } catch { app.toast('Received an invalid board from the room.'); }
  },
  onCursor(id, x, y) {
    if (x === null || x < -100) ui.peers.delete(id); else ui.peers.set(id, { x, y, seen: performance.now() });
    needsDraw = true;
  },
  onPeers: n => app.setPeers(n),
  onStatus: msg => app.roomStatus(msg),
});
app.sync = sync;

store.subscribe((board, meta) => {
  needsDraw = true;
  scheduleSave();
  if (!meta.remote && meta.type !== 'loadBoard' && meta.type !== 'renameBoard') {
    for (const k of ROBOT_KEYS) if (board.robots[k] !== meta.prev.robots[k]) sync.sendRobot(k, board.robots[k]);
  }
  controls.refresh();
});

const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
let controls;

function render() {
  const w = stage.clientWidth, h = stage.clientHeight, dpr = window.devicePixelRatio || 1;
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
new ResizeObserver(() => { needsDraw = true; }).observe(stage);
controls.refresh();
render();

let last = performance.now();
(function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (ui.playing) {
    ui.t += dt;
    if (ui.t >= AUTO_SECONDS) { ui.t = AUTO_SECONDS; ui.playing = false; }
    controls.tick();
    needsDraw = true;
  }
  if (needsDraw || ui.peers.size) { needsDraw = false; render(); }
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
    const raw = await decodeBoard(h.value), b = normalizeBoard(raw);
    const dirty = ROBOT_KEYS.some(k => store.get().robots[k].path.segments.length);
    if (dirty && !confirm(`Open shared board "${b.name}"? It is added to your boards and your current board stays saved.`)) return;
    b.id = uid();
    add(b);
    app.toast(`Opened "${b.name}"`);
  } catch { app.toast('That share link is not valid.'); }
}
addEventListener('hashchange', handleHash);
handleHash();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

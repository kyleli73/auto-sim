const PEER_SRC = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const ID_PREFIX = 'bbl-autosim-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const peerColor = id => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 85% 60%)`;
};

const makeCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

function loadPeerJS() {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEER_SRC;
    s.onload = () => globalThis.Peer ? resolve(globalThis.Peer) : reject(new Error('PeerJS failed to initialise'));
    s.onerror = () => reject(new Error('Could not load PeerJS (no internet?)'));
    document.head.appendChild(s);
  });
}

// Same-device tabs via BroadcastChannel (always on); cross-device rooms via PeerJS (lazy, online only).
// Messages: auto {auto}, board {board}, snap {lib} (host to joiner), cur {autoId,x,y}. Receivers merge last-writer-wins.
export function createSync({ clientId, getLib, getAutoId, onAuto, onBoard, onSnapshot, onCursor, onPeers, onStatus }) {
  const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('bubblotics-auto-sim') : null;
  const conns = new Set();
  let peer = null, isHost = false, roomCode = '';

  const handle = (m, viaRoom) => {
    if (!m || m.from === clientId) return;
    if (m.t === 'snap') { if (viaRoom) onSnapshot(m.lib); }
    else if (m.t === 'auto') onAuto(m.auto);
    else if (m.t === 'board') onBoard(m.board);
    else if (m.t === 'cur' && m.autoId === getAutoId()) onCursor(m.from, m.x, m.y);
  };

  if (bc) bc.onmessage = e => handle(e.data, false);

  const send = (msg, except) => {
    const m = { ...msg, from: clientId };
    bc?.postMessage(m);
    for (const c of conns) if (c !== except && c.open) c.send(m);
  };

  function setup(conn) {
    conn.on('open', () => {
      conns.add(conn);
      if (isHost) conn.send({ t: 'snap', lib: getLib(), from: clientId });
      onPeers(conns.size);
    });
    conn.on('data', m => {
      handle(m, true);
      if (isHost && m && m.t !== 'snap') for (const c of conns) if (c !== conn && c.open) c.send(m);
    });
    const drop = () => { conns.delete(conn); onPeers(conns.size); onCursor(conn.peer, null, null); };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  async function open(host, code) {
    if (!navigator.onLine) {
      onStatus('You are offline. Live rooms need internet; share links and same-device tabs still work.');
      return false;
    }
    leave();
    let Peer;
    try { Peer = await loadPeerJS(); } catch (e) { onStatus(e.message + '. Share links still work.'); return false; }
    isHost = host;
    roomCode = code;
    peer = host ? new Peer(ID_PREFIX + code) : new Peer();
    peer.on('open', () => {
      if (host) { onStatus(`Room ${code} is open. Share the code or link.`); return; }
      onStatus(`Joining ${code}...`);
      setup(peer.connect(ID_PREFIX + code, { reliable: true }));
    });
    peer.on('connection', setup);
    peer.on('error', err => {
      if (host && err.type === 'unavailable-id') { open(true, makeCode()); return; }
      onStatus(err.type === 'peer-unavailable' ? `No room ${code} found.` : `Live room error: ${err.type || err.message}`);
    });
    return true;
  }

  function leave() {
    for (const c of conns) c.close();
    conns.clear();
    peer?.destroy();
    peer = null; roomCode = ''; isHost = false;
    onPeers(0);
  }

  return {
    sendAuto: auto => send({ t: 'auto', auto }),
    sendBoard: board => send({ t: 'board', board }),
    sendCursor: (x, y) => { const autoId = getAutoId(); if (autoId) send({ t: 'cur', autoId, x, y }); },
    startRoom: () => open(true, makeCode()),
    joinRoom: code => open(false, code.trim().toUpperCase()),
    leave,
    get room() { return roomCode; },
    get isHost() { return isHost; },
  };
}

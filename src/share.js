function toB64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(str) {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeBoard(board) {
  const raw = new TextEncoder().encode(JSON.stringify(board));
  return toB64Url(await pipe(raw, new CompressionStream('deflate-raw')));
}

export async function decodeBoard(code) {
  const raw = await pipe(fromB64Url(code), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(raw));
}

export function parseHash(hash) {
  const m = /^#?(b|room)=([A-Za-z0-9_-]+)$/.exec(hash || '');
  return m ? { kind: m[1], value: m[2] } : null;
}

export const shareUrl = (base, code) => `${base.split('#')[0]}#b=${code}`;

// Node's crypto as far as the main-process code uses it, synchronously (WebCrypto's digest is async): createHash for
// sha1 (cache file names), sha256 and md5 (Last.fm's signatures), createHmac('sha256'), randomBytes,
// timingSafeEqual. Small, plain implementations: the inputs are names and short texts.

const utf8 = (s) => new TextEncoder().encode(s);
const toBytes = (data, enc) => {
  if (typeof data === 'string') return enc === 'hex' ? Uint8Array.from(data.match(/../g) || [], (h) => parseInt(h, 16)) : utf8(data);
  return data instanceof Uint8Array ? data : new Uint8Array(data);
};
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const rotl = (x, n) => (x << n) | (x >>> (32 - n));
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

// Message padding shared by the three (bigEndian: sha; little-endian: md5).
function pad(bytes, bigEndian) {
  const bits = bytes.length * 8;
  const len = ((bytes.length + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(len);
  m.set(bytes); m[bytes.length] = 0x80;
  const dv = new DataView(m.buffer);
  const hi = Math.floor(bits / 2 ** 32), lo = bits >>> 0;
  if (bigEndian) { dv.setUint32(len - 8, hi); dv.setUint32(len - 4, lo); } else { dv.setUint32(len - 8, lo, true); dv.setUint32(len - 4, hi, true); }
  return dv;
}

function sha1(bytes) {
  const dv = pad(bytes, true);
  let [a0, b0, c0, d0, e0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Int32Array(80);
  for (let off = 0; off < dv.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = a0, b = b0, c = c0, d = d0, e = e0;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? ((b & c) | (~b & d)) + 0x5a827999 : i < 40 ? (b ^ c ^ d) + 0x6ed9eba1 : i < 60 ? ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc : (b ^ c ^ d) + 0xca62c1d6;
      const t = (rotl(a, 5) + f + e + w[i]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0; e0 = (e0 + e) | 0;
  }
  const out = new DataView(new ArrayBuffer(20));
  [a0, b0, c0, d0, e0].forEach((v, i) => out.setInt32(i * 4, v));
  return new Uint8Array(out.buffer);
}

const K256 = Int32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
function sha256(bytes) {
  const dv = pad(bytes, true);
  const h = Int32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Int32Array(64);
  for (let off = 0; off < dv.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
  }
  const out = new DataView(new ArrayBuffer(32));
  h.forEach((v, i) => out.setInt32(i * 4, v));
  return new Uint8Array(out.buffer);
}

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const KMD5 = Int32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
function md5(bytes) {
  const dv = pad(bytes, false);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let off = 0; off < dv.byteLength; off += 64) {
    const m = Array.from({ length: 16 }, (_, i) => dv.getInt32(off + i * 4, true));
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      const r = i >> 4;
      let f, g;
      if (r === 0) { f = (b & c) | (~b & d); g = i; } else if (r === 1) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; } else if (r === 2) { f = b ^ c ^ d; g = (3 * i + 5) & 15; } else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const t = d; d = c; c = b;
      b = (b + rotl((a + f + KMD5[i] + m[g]) | 0, S[r * 4 + (i & 3)])) | 0;
      a = t;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setInt32(i * 4, v, true));
  return new Uint8Array(out.buffer);
}

const ALGOS = { sha1: [sha1, 64], sha256: [sha256, 64], md5: [md5, 64] };
const encode = (bytes, enc) => (enc === 'hex' ? Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  : enc === 'base64' ? Buffer.from(bytes).toString('base64') : Buffer.from(bytes));

function createHash(name) {
  const algo = ALGOS[String(name).toLowerCase()];
  if (!algo) throw new Error(`crypto.createHash(${name}): not on Android`);
  const parts = [];
  return {
    update(data, enc) { parts.push(toBytes(data, enc)); return this; },
    digest(enc) { return encode(algo[0](concat(parts)), enc); },
  };
}
function createHmac(name, key) {
  const algo = ALGOS[String(name).toLowerCase()];
  if (!algo) throw new Error(`crypto.createHmac(${name}): not on Android`);
  const [hash, block] = algo;
  let k = toBytes(key);
  if (k.length > block) k = hash(k);
  const ipad = new Uint8Array(block), opad = new Uint8Array(block);
  for (let i = 0; i < block; i++) { ipad[i] = (k[i] || 0) ^ 0x36; opad[i] = (k[i] || 0) ^ 0x5c; }
  const parts = [ipad];
  return {
    update(data, enc) { parts.push(toBytes(data, enc)); return this; },
    digest(enc) { return encode(hash(concat([opad, hash(concat(parts))])), enc); },
  };
}
const randomBytes = (n) => Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
const timingSafeEqual = (a, b) => { if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length'); let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
const randomUUID = () => crypto.randomUUID();

module.exports = { createHash, createHmac, randomBytes, timingSafeEqual, randomUUID, webcrypto: globalThis.crypto };

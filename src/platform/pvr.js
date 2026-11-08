// PowerVR legacy (v2, "PVR!") texture decoder for the original INGAME*.pvr files.
// Formats present in Angry Birds 1.0:
//   0x10  OGL_RGBA_4444 (linear)            INGAME, INGAME_1, _3, _4, _5
//   0x19  OGL_PVRTC4 (twiddled, +mipmaps)    INGAME_2, _6, _7, _8
// Returns { width, height, rgba: Uint8ClampedArray } for the top mip level.

export function decodePVR(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const headerSize = dv.getUint32(0, true);
  const height = dv.getUint32(4, true);
  const width = dv.getUint32(8, true);
  const flags = dv.getUint32(16, true);
  const tag = dv.getUint32(44, true);
  if (tag !== 0x21525650) throw new Error('Not a PVR v2 texture');
  const fmt = flags & 0xff;
  const data = u8.subarray(headerSize);
  let rgba;
  if (fmt === 0x10) rgba = decode4444(data, width, height);
  else if (fmt === 0x19) rgba = decodePVRTC4(data, width, height);
  else throw new Error('Unsupported PVR format 0x' + fmt.toString(16));
  if (flags & 0x10000) flipY(rgba, width, height);
  return { width, height, rgba };
}

function flipY(rgba, w, h) {
  const row = w * 4, tmp = new Uint8ClampedArray(row);
  for (let y = 0; y < h >> 1; y++) {
    const a = y * row, b = (h - 1 - y) * row;
    tmp.set(rgba.subarray(a, a + row)); rgba.copyWithin(a, b, b + row); rgba.set(tmp, b);
  }
}

function decode4444(d, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const v = d[i * 2] | (d[i * 2 + 1] << 8);
    out[i * 4] = ((v >> 12) & 15) * 17;
    out[i * 4 + 1] = ((v >> 8) & 15) * 17;
    out[i * 4 + 2] = ((v >> 4) & 15) * 17;
    out[i * 4 + 3] = (v & 15) * 17;
  }
  return out;
}

// ---- PVRTC 4bpp (Imagination reference algorithm) ----
function twiddle(x, y, minDim) {
  let t = 0, src = 1, dst = 1;
  while (src < minDim) {
    if (y & src) t |= dst;
    if (x & src) t |= dst << 1;
    src <<= 1; dst <<= 2;
  }
  const shift = Math.log2(minDim) | 0;
  const rest = (x | y) >> shift; // only one of x,y exceeds minDim
  return t | (rest << (2 * shift));
}

function colorA(c) { // returns [r5,g5,b5,a4]
  if (c & 0x8000) return [(c >> 10) & 31, (c >> 5) & 31, (c & 0x1e) | ((c & 0x1e) >> 4), 15];
  return [((c & 0xf00) >> 7) | ((c & 0xf00) >> 11), ((c & 0xf0) >> 3) | ((c & 0xf0) >> 7), ((c & 0xe) << 1) | ((c & 0xe) >> 2), (c & 0x7000) >> 11];
}
function colorB(c) {
  if (c & 0x80000000) return [(c >>> 26) & 31, (c >>> 21) & 31, (c >>> 16) & 31, 15];
  return [((c & 0xf000000) >>> 23) | ((c & 0xf000000) >>> 27), ((c & 0xf00000) >>> 19) | ((c & 0xf00000) >>> 23), ((c & 0xf0000) >>> 15) | ((c & 0xf0000) >>> 19), (c & 0x70000000) >>> 27];
}

function decodePVRTC4(d, w, h) {
  const bw = w >> 2, bh = h >> 2;
  const minDim = Math.min(bw, bh);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const nb = bw * bh;
  const A = new Int32Array(nb * 4), B = new Int32Array(nb * 4);
  const mod = new Uint32Array(nb), mode = new Uint8Array(nb);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const off = twiddle(bx, by, minDim) * 8;
      const m = dv.getUint32(off, true);
      const c = dv.getUint32(off + 4, true);
      const i = by * bw + bx;
      mod[i] = m; mode[i] = c & 1;
      const a = colorA(c & 0xffff), b = colorB(c);
      A.set(a, i * 4); B.set(b, i * 4);
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  const ca = [0, 0, 0, 0], cb = [0, 0, 0, 0];
  for (let py = 0; py < h; py++) {
    const yy = py - 2;
    const by0 = ((yy >> 2) + bh) % bh, by1 = (by0 + 1) % bh;
    const fy = yy & 3;
    for (let px = 0; px < w; px++) {
      const xx = px - 2;
      const bx0 = ((xx >> 2) + bw) % bw, bx1 = (bx0 + 1) % bw;
      const fx = xx & 3;
      const p = (by0 * bw + bx0) * 4, q = (by0 * bw + bx1) * 4, r = (by1 * bw + bx0) * 4, s = (by1 * bw + bx1) * 4;
      const wp = (4 - fx) * (4 - fy), wq = fx * (4 - fy), wr = (4 - fx) * fy, ws = fx * fy;
      for (let k = 0; k < 4; k++) {
        ca[k] = A[p + k] * wp + A[q + k] * wq + A[r + k] * wr + A[s + k] * ws; // *16
        cb[k] = B[p + k] * wp + B[q + k] * wq + B[r + k] * wr + B[s + k] * ws;
      }
      // expand to 8 bits: rgb 5-bit (x16 weights) and alpha 4-bit (x16 weights)
      for (let k = 0; k < 3; k++) { ca[k] = (ca[k] * 255 / 496) | 0; cb[k] = (cb[k] * 255 / 496) | 0; }
      ca[3] = (ca[3] * 255 / 240) | 0; cb[3] = (cb[3] * 255 / 240) | 0;
      const bi = (py >> 2) * bw + (px >> 2);
      const bits = (mod[bi] >>> (((py & 3) * 4 + (px & 3)) * 2)) & 3;
      let wgt, punch = false;
      if (mode[bi] === 0) wgt = [0, 3, 5, 8][bits];
      else { wgt = [0, 4, 4, 8][bits]; punch = bits === 2; }
      const o = (py * w + px) * 4;
      out[o] = (ca[0] * (8 - wgt) + cb[0] * wgt) >> 3;
      out[o + 1] = (ca[1] * (8 - wgt) + cb[1] * wgt) >> 3;
      out[o + 2] = (ca[2] * (8 - wgt) + cb[2] * wgt) >> 3;
      out[o + 3] = punch ? 0 : (ca[3] * (8 - wgt) + cb[3] * wgt) >> 3;
    }
  }
  return out;
}

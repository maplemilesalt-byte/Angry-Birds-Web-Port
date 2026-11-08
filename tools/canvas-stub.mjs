// Minimal software Canvas2D for headless testing (affine drawImage, fillRect, patterns, source-in).
import zlib from 'zlib'; import fs from 'fs';

class Ctx {
  constructor(c) { this.c = c; this.m = [1, 0, 0, 1, 0, 0]; this.stack = []; this.fillStyle = '#000'; this.strokeStyle = '#000'; this.globalAlpha = 1; this.globalCompositeOperation = 'source-over'; this.lineWidth = 1; this.imageSmoothingEnabled = true; this.path = []; }
  get px() { if (!this.c._px) this.c._px = new Uint8ClampedArray(this.c.width * this.c.height * 4); return this.c._px; }
  save() { this.stack.push([this.m.slice(), this.fillStyle, this.globalAlpha, this.globalCompositeOperation]); }
  restore() { const s = this.stack.pop(); if (s) [this.m, this.fillStyle, this.globalAlpha, this.globalCompositeOperation] = s; }
  setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
  transform(a, b, c, d, e, f) { const m = this.m; this.m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]]; }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this.transform(c, s, -s, c, 0, 0); }
  _stat() { this.c.__stats.calls++; }
  createPattern(img) { return { pattern: img, setTransform(m) { this.mat = m; } }; }
  clearRect() { this.px.fill(0); }
  putImageData(d) { this.c._px = new Uint8ClampedArray(d.data); }
  getImageData(x, y, w, h) { return { data: this.px, width: this.c.width, height: this.c.height }; }
  // rasterize a quad given local rect and a per-pixel sampler(u,v)->[r,g,b,a]
  _raster(x0, y0, w, h, sample) {
    this._stat();
    if (process.env.NORENDER && !globalThis.__forceRender) return;
    const m = this.m, W = this.c.width, H = this.c.height;
    const det = m[0] * m[3] - m[1] * m[2]; if (!det) return;
    const ia = m[3] / det, ib = -m[1] / det, ic = -m[2] / det, id = m[0] / det;
    const pts = [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    const minX = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])))), maxX = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])))), maxY = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p[1]))));
    const px = this.px, ga = this.globalAlpha, op = this.globalCompositeOperation;
    for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {
      const dx = x + 0.5 - m[4], dy = y + 0.5 - m[5];
      const u = ia * dx + ic * dy, v = ib * dx + id * dy;
      if (u < x0 || v < y0 || u >= x0 + w || v >= y0 + h) continue;
      const s = sample(u - x0, v - y0, u, v); if (!s) continue;
      const o = (y * W + x) * 4; const a = (s[3] / 255) * ga;
      if (op === 'source-in') { const da = px[o + 3] / 255; px[o] = s[0]; px[o + 1] = s[1]; px[o + 2] = s[2]; px[o + 3] = 255 * a * da; continue; }
      if (a <= 0) continue;
      const da = px[o + 3] / 255, oa = a + da * (1 - a);
      for (let k = 0; k < 3; k++) px[o + k] = (s[k] * a + px[o + k] * da * (1 - a)) / (oa || 1);
      px[o + 3] = oa * 255;
    }
  }
  drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (dx === undefined) { dx = sx; dy = sy; dw = img.width; dh = img.height; sx = 0; sy = 0; sw = img.width; sh = img.height; }
    const src = img._px || (img.getContext && img.getContext('2d').px); const IW = img.width;
    this._raster(dx, dy, dw, dh, (u, v) => { const X = Math.min(img.width - 1, Math.floor(sx + u * sw / dw)), Y = Math.min(img.height - 1, Math.floor(sy + v * sh / dh)); const o = (Y * IW + X) * 4; return [src[o], src[o + 1], src[o + 2], src[o + 3]]; });
  }
  fillRect(x, y, w, h) {
    const fs = this.fillStyle;
    if (fs && fs.pattern) {
      const img = fs.pattern, src = img._px || img.getContext('2d').px, mt = fs.mat || { e: 0, f: 0 };
      const ox = mt.e ?? (mt[4] || 0), oy = mt.f ?? (mt[5] || 0);
      this._raster(x, y, w, h, (u, v, gx, gy) => { let X = Math.floor(gx - ox) % img.width, Y = Math.floor(gy - oy) % img.height; if (X < 0) X += img.width; if (Y < 0) Y += img.height; const o = (Y * img.width + X) * 4; return [src[o], src[o + 1], src[o + 2], src[o + 3]]; });
      return;
    }
    const c = parseColor(fs);
    this._raster(x, y, w, h, () => c);
  }
  beginPath() { this.path = []; } moveTo(x, y) { this.path.push([x, y]); } lineTo(x, y) { this.path.push([x, y]); }
  stroke() { this._stat(); /* lines approximated as thin rects */ const c = parseColor(this.strokeStyle); for (let i = 1; i < this.path.length; i++) { const [a, b] = [this.path[i - 1], this.path[i]]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!len) continue; this.save(); this.translate(a[0], a[1]); this.rotate(Math.atan2(b[1] - a[1], b[0] - a[0])); this._raster(0, -this.lineWidth / 2, len, this.lineWidth, () => c); this.restore(); } }
}
function parseColor(s) {
  if (typeof s !== 'string') return [0, 0, 0, 255];
  let m = s.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] * 255 : 255]; }
  return [0, 0, 0, 255];
}
class Canvas { constructor() { this.width = 300; this.height = 150; this.style = {}; this.__stats = { calls: 0 }; } getContext() { if (!this._ctx) this._ctx = new Ctx(this); return this._ctx; } addEventListener() {} getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; } }
export function installCanvasStub() {
  globalThis.document = { createElement: () => new Canvas() };
  globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
  globalThis.DOMMatrix = class { constructor(a) { [this.a, this.b, this.c, this.d, this.e, this.f] = a; } };
  globalThis.localStorage = { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, v); } };
  globalThis.window = globalThis;
  globalThis.innerWidth = 480; globalThis.innerHeight = 320;
}
export function readPngSize(b) { const dv = new DataView(b.buffer, b.byteOffset); return [dv.getUint32(16), dv.getUint32(20)]; }
export function createCanvasFromPng(bytes) {
  const b = Buffer.from(bytes); const [w, h] = readPngSize(bytes);
  let p = 8, idat = [], ct = 6, bd = 8, plte = null, trns = null;
  while (p < b.length) { const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8); const d = b.subarray(p + 8, p + 8 + len); if (type === 'IHDR') { bd = d[8]; ct = d[9]; } if (type === 'IDAT') idat.push(d); if (type === 'PLTE') plte = d; if (type === 'tRNS') trns = d; p += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]; const bpp = Math.max(1, ch * bd / 8); const stride = Math.ceil(w * ch * bd / 8);
  const out = new Uint8ClampedArray(w * h * 4); const prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) { const a = i >= bpp ? cur[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let x = line[i];
      if (f === 1) x += a; else if (f === 2) x += up; else if (f === 3) x += (a + up) >> 1; else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); x += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; } cur[i] = x & 255; }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if (ct === 6) { out.set(cur.subarray(x * 4, x * 4 + 4), o); } else if (ct === 2) { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255; } else if (ct === 3) { const idx = bd === 8 ? cur[x] : (cur[(x * bd) >> 3] >> (8 - bd - ((x * bd) & 7))) & ((1 << bd) - 1); out[o] = plte[idx * 3]; out[o + 1] = plte[idx * 3 + 1]; out[o + 2] = plte[idx * 3 + 2]; out[o + 3] = trns && idx < trns.length ? trns[idx] : 255; } else if (ct === 0) { out[o] = out[o + 1] = out[o + 2] = cur[x]; out[o + 3] = 255; } else if (ct === 4) { out[o] = out[o + 1] = out[o + 2] = cur[x * 2]; out[o + 3] = cur[x * 2 + 1]; } }
    prev.set(cur);
  }
  const c = new Canvas(); c.width = w; c.height = h; c._px = out; return c;
}
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
export function savePng(canvas, file) {
  const w = canvas.width, h = canvas.height, px = canvas.getContext('2d').px; const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = x % 4 === 3 ? 255 : px[y * w * 4 + x]; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

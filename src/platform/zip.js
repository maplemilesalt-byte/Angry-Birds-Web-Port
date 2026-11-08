// Minimal ZIP (IPA) reader: reads the central directory and inflates entries with
// the platform DecompressionStream('deflate-raw'). The original IPA is loaded unchanged.

async function inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class ZipArchive {
  constructor(buffer) {
    this.u8 = new Uint8Array(buffer);
    this.dv = new DataView(this.u8.buffer, this.u8.byteOffset, this.u8.byteLength);
    this.entries = new Map();
    this._parse();
  }
  _parse() {
    const { dv, u8 } = this;
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a ZIP/IPA archive');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Bad central directory');
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      this.entries.set(name, { method, csize, usize, lho });
      p += 46 + nlen + xlen + clen;
    }
  }
  list() { return Array.from(this.entries.keys()); }
  has(name) { return this.entries.has(name); }
  async read(name) {
    const e = this.entries.get(name);
    if (!e) throw new Error('Missing archive entry: ' + name);
    const { dv, u8 } = this;
    const nlen = dv.getUint16(e.lho + 26, true);
    const xlen = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + nlen + xlen;
    const raw = u8.subarray(start, start + e.csize);
    if (e.method === 0) return raw.slice();
    if (e.method === 8) return inflateRaw(raw);
    throw new Error('Unsupported zip method ' + e.method);
  }
}

// Java-style DataInputStream (big-endian), matching io::DataInputStream used by the original engine.
export class DataInput {
  constructor(u8) {
    this.u8 = u8;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.p = 0;
  }
  byte() { return this.u8[this.p++]; }
  short() { const v = this.dv.getInt16(this.p); this.p += 2; return v; }
  ushort() { const v = this.dv.getUint16(this.p); this.p += 2; return v; }
  int() { const v = this.dv.getInt32(this.p); this.p += 4; return v; }
  utf() {
    const n = this.ushort();
    const s = new TextDecoder().decode(this.u8.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  get eof() { return this.p >= this.u8.length; }
}

// Lua strings in the VM are byte strings (one char per byte); convert UTF-8 <-> JS.
export function luaToJs(s) {
  if (typeof s !== 'string') return s;
  let ascii = true;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) { ascii = false; break; }
  if (ascii) return s;
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
  return new TextDecoder().decode(b);
}
export function jsToLua(s) {
  let ascii = true;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) { ascii = false; break; }
  if (ascii) return s;
  const b = new TextEncoder().encode(s);
  let o = '';
  for (let i = 0; i < b.length; i++) o += String.fromCharCode(b[i]);
  return o;
}

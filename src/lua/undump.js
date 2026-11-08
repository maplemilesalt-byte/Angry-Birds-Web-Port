// Lua 5.1 binary chunk loader ("undump") for the original Angry Birds 1.0 scripts.
// The shipped chunks use header: 1B 'LuaQ' 0x51 fmt0 little-endian int=4 size_t=4
// Instruction=4 lua_Number=4 integral=0  -> lua_Number is a 32-bit IEEE float.

export const OPNAMES = [
  'MOVE', 'LOADK', 'LOADBOOL', 'LOADNIL', 'GETUPVAL', 'GETGLOBAL', 'GETTABLE',
  'SETGLOBAL', 'SETUPVAL', 'SETTABLE', 'NEWTABLE', 'SELF', 'ADD', 'SUB', 'MUL',
  'DIV', 'MOD', 'POW', 'UNM', 'NOT', 'LEN', 'CONCAT', 'JMP', 'EQ', 'LT', 'LE',
  'TEST', 'TESTSET', 'CALL', 'TAILCALL', 'RETURN', 'FORLOOP', 'FORPREP',
  'TFORLOOP', 'SETLIST', 'CLOSE', 'CLOSURE', 'VARARG',
];

export class Proto {
  constructor() {
    this.source = null;
    this.lineDefined = 0;
    this.lastLineDefined = 0;
    this.nups = 0;
    this.numparams = 0;
    this.isVararg = 0;
    this.maxStack = 0;
    this.code = null; // Int32Array raw
    this.op = null; this.A = null; this.B = null; this.C = null; // decoded
    this.k = [];
    this.p = [];
    this.lineinfo = [];
    this.locvars = [];
    this.upvalNames = [];
  }
}

function bytesToStr(u8, off, len) {
  // Lua strings are byte strings; represent each byte as one UTF-16 code unit.
  let s = '';
  const CH = 8192;
  for (let i = 0; i < len; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(off + i, off + Math.min(len, i + CH)));
  }
  return s;
}

export function undump(buf, chunkName = '?') {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let pos = 0;
  const hdr = [0x1b, 0x4c, 0x75, 0x61, 0x51, 0x00, 0x01, 0x04, 0x04, 0x04, 0x04, 0x00];
  for (let i = 0; i < 12; i++) {
    if (u8[i] !== hdr[i]) throw new Error(`${chunkName}: unsupported chunk header byte ${i}=${u8[i]}`);
  }
  pos = 12;
  const int = () => { const v = dv.getInt32(pos, true); pos += 4; return v; };
  const byte = () => u8[pos++];
  const str = () => {
    const n = dv.getUint32(pos, true); pos += 4;
    if (n === 0) return null;
    const s = bytesToStr(u8, pos, n - 1); pos += n;
    return s;
  };
  const num = () => { const v = dv.getFloat32(pos, true); pos += 4; return v; };

  function fn(parentSource) {
    const f = new Proto();
    f.source = str() ?? parentSource;
    f.lineDefined = int();
    f.lastLineDefined = int();
    f.nups = byte(); f.numparams = byte(); f.isVararg = byte(); f.maxStack = byte();
    const nc = int();
    f.code = new Int32Array(nc);
    f.op = new Uint8Array(nc); f.A = new Uint16Array(nc); f.B = new Int32Array(nc); f.C = new Int32Array(nc);
    for (let i = 0; i < nc; i++) {
      const ins = dv.getUint32(pos, true); pos += 4;
      f.code[i] = ins;
      const op = ins & 0x3f;
      f.op[i] = op;
      f.A[i] = (ins >>> 6) & 0xff;
      // iABx ops: LOADK GETGLOBAL SETGLOBAL CLOSURE (Bx); JMP FORLOOP FORPREP (sBx)
      if (op === 1 || op === 5 || op === 7 || op === 36) { f.B[i] = ins >>> 14; f.C[i] = 0; }
      else if (op === 22 || op === 31 || op === 32) { f.B[i] = (ins >>> 14) - 131071; f.C[i] = 0; }
      else { f.B[i] = (ins >>> 23) & 0x1ff; f.C[i] = (ins >>> 14) & 0x1ff; }
    }
    const nk = int();
    for (let i = 0; i < nk; i++) {
      const t = byte();
      if (t === 0) f.k.push(undefined);
      else if (t === 1) f.k.push(byte() !== 0);
      else if (t === 3) f.k.push(num());
      else if (t === 4) f.k.push(str());
      else throw new Error(`${chunkName}: bad constant type ${t}`);
    }
    const np = int();
    for (let i = 0; i < np; i++) f.p.push(fn(f.source));
    const nl = int();
    for (let i = 0; i < nl; i++) f.lineinfo.push(int());
    const nlv = int();
    for (let i = 0; i < nlv; i++) f.locvars.push({ name: str(), startpc: int(), endpc: int() });
    const nu = int();
    for (let i = 0; i < nu; i++) f.upvalNames.push(str());
    return f;
  }
  const main = fn('=' + chunkName);
  return main;
}

export function disassemble(f, out = [], depth = 0, path = 'main') {
  const ind = '  '.repeat(depth);
  out.push(`${ind}function <${f.source}:${f.lineDefined},${f.lastLineDefined}> ${path} params=${f.numparams} vararg=${f.isVararg} ups=${f.nups} stack=${f.maxStack}`);
  const rk = (x) => (x & 256 ? `K(${JSON.stringify(f.k[x & 255])})` : `R${x}`);
  for (let i = 0; i < f.code.length; i++) {
    const op = f.op[i], a = f.A[i], b = f.B[i], c = f.C[i];
    const name = OPNAMES[op];
    let s;
    switch (op) {
      case 1: case 5: case 7: s = `${a} K(${JSON.stringify(f.k[b])})`; break;
      case 36: s = `${a} proto${b}`; break;
      case 22: case 31: case 32: s = `${a} -> ${i + 1 + b}`; break;
      case 6: case 11: s = `${a} R${b} ${rk(c)}`; break;
      case 9: case 12: case 13: case 14: case 15: case 16: case 17: case 23: case 24: case 25:
        s = `${a} ${rk(b)} ${rk(c)}`; break;
      case 4: case 8: s = `${a} U${b}(${f.upvalNames[b] ?? ''})`; break;
      default: s = `${a} ${b} ${c}`;
    }
    out.push(`${ind}  [${i}] ${f.lineinfo[i] ?? ''} ${name} ${s}`);
  }
  if (f.locvars.length) out.push(`${ind}  locals: ${f.locvars.map((l) => l.name).join(', ')}`);
  f.p.forEach((p, j) => disassemble(p, out, depth + 1, `${path}.${j}`));
  return out;
}

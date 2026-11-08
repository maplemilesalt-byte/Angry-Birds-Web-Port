// Lua 5.1 virtual machine that executes the ORIGINAL compiled Angry Birds 1.0 bytecode.
// Configuration recovered from the shipped binary / chunks:
//   * lua_Number = 32-bit float  (chunk header byte 10 == 4, integral flag 0)
//   * LUAI_NUMFMT = "%.6g"        (string found in the executable's Lua core)
// Values: nil=undefined, boolean, number, string (byte string), LuaTable, LuaFunction, JS function.

import { undump } from './undump.js';

const fr = Math.fround;

export class LuaError extends Error {
  constructor(value, traceback) {
    super(typeof value === 'string' ? value : 'lua error');
    this.value = value;
    this.luaTraceback = traceback;
  }
}

export class LuaTable {
  constructor() {
    this.arr = []; // arr[i] holds key i+1
    this.hash = new Map();
    this.mt = null;
  }
  get(k) {
    if (typeof k === 'number') {
      if (k >= 1 && k <= this.arr.length && (k | 0) === k) return this.arr[k - 1];
    }
    return this.hash.get(k);
  }
  set(k, v) {
    if (typeof k === 'number') {
      if (k !== k) throw new LuaError('table index is NaN');
      if ((k | 0) === k && k >= 1) {
        const n = this.arr.length;
        if (k <= n) {
          if (v === undefined && k === n) {
            this.arr.pop();
            while (this.arr.length && this.arr[this.arr.length - 1] === undefined) this.arr.pop();
          } else this.arr[k - 1] = v;
          return;
        }
        if (k === n + 1) {
          if (v === undefined) { this.hash.delete(k); return; }
          this.arr.push(v);
          this.hash.delete(k);
          // migrate following keys from hash
          let nk = k + 1;
          while (this.hash.has(nk)) {
            this.arr.push(this.hash.get(nk));
            this.hash.delete(nk);
            nk++;
          }
          return;
        }
      }
      if (k === 0) k = 0; // normalise -0
    } else if (k === undefined) {
      throw new LuaError('table index is nil');
    }
    if (v === undefined) this.hash.delete(k);
    else this.hash.set(k, v);
  }
  length() {
    let n = this.arr.length;
    if (n > 0 && this.arr[n - 1] === undefined) {
      // binary search for a border (as luaH_getn)
      let i = 0, j = n;
      while (j - i > 1) {
        const m = (i + j) >>> 1;
        if (this.arr[m - 1] === undefined) j = m; else i = m;
      }
      return i;
    }
    if (n === 0 && !this.hash.has(1)) return 0;
    if (this.hash.size === 0) return n;
    // unbound search in hash part
    let j = n + 1;
    while (this.hash.get(j) !== undefined) j++;
    return j - 1;
  }
  // iteration helper: returns next key after k, mimicking `next`
  next(k) {
    if (k === undefined) {
      for (let i = 0; i < this.arr.length; i++) if (this.arr[i] !== undefined) return [i + 1, this.arr[i]];
      return this._hashFirst();
    }
    if (typeof k === 'number' && (k | 0) === k && k >= 1 &&
        (k <= this.arr.length || !(this._keys && this._keys.includes(k)))) {
      // array-part key (possibly cleared during traversal): continue after it
      for (let i = k; i < this.arr.length; i++) if (this.arr[i] !== undefined) return [i + 1, this.arr[i]];
      return this._hashFirst();
    }
    // hash part: traverse the key snapshot taken at the start of the traversal
    let keys = this._keys;
    let idx = -1;
    if (keys) idx = (this._iterPos !== undefined && keys[this._iterPos] === k) ? this._iterPos : keys.indexOf(k);
    if (idx < 0) {
      keys = this._keys = Array.from(this.hash.keys());
      idx = keys.indexOf(k);
      if (idx < 0) throw new LuaError("invalid key to 'next'");
    }
    for (let i = idx + 1; i < keys.length; i++) {
      const kk = keys[i];
      const v = this.hash.get(kk);
      if (v !== undefined) { this._iterPos = i; return [kk, v]; }
    }
    return undefined;
  }
  _hashFirst() {
    this._keys = Array.from(this.hash.keys());
    this._keysVer = this.hash.size;
    for (let i = 0; i < this._keys.length; i++) {
      const kk = this._keys[i];
      if (this.hash.has(kk)) { this._iterPos = i; return [kk, this.hash.get(kk)]; }
    }
    return undefined;
  }
}

export class LuaFunction {
  constructor(p, upvals, env) {
    this.p = p;
    this.upvals = upvals;
    this.env = env;
  }
}

class UpVal {
  constructor(regs, idx) {
    this.regs = regs; this.idx = idx; this.open = true; this.value = undefined;
  }
  get() { return this.open ? this.regs[this.idx] : this.value; }
  set(v) { if (this.open) this.regs[this.idx] = v; else this.value = v; }
  close() { this.value = this.regs[this.idx]; this.open = false; this.regs = null; }
}

// ---------- number formatting / conversion ----------
function fmtG(x, prec) {
  if (x !== x) return x > 0 ? 'nan' : (Object.is(x, NaN) ? 'nan' : '-nan');
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return (Object.is(x, -0) ? '-0' : '0');
  const p = prec === 0 ? 1 : prec;
  const exp = Math.floor(Math.log10(Math.abs(x)));
  let s = x.toExponential(p - 1);
  let e = parseInt(s.slice(s.indexOf('e') + 1), 10);
  if (e < -4 || e >= p) {
    let [m, ex] = s.split('e');
    if (m.indexOf('.') >= 0) m = m.replace(/0+$/, '').replace(/\.$/, '');
    const sign = ex[0] === '-' ? '-' : '+';
    let digits = ex.replace(/^[+-]/, '');
    if (digits.length < 2) digits = '0' + digits;
    return `${m}e${sign}${digits}`;
  }
  void exp;
  s = x.toFixed(Math.max(0, p - 1 - e));
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
export function numberToString(n) { return fmtG(n, 6); }

export function str2number(s) {
  s = s.trim();
  if (s === '') return undefined;
  let v;
  if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(s)) v = parseInt(s, 16);
  else if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) v = parseFloat(s);
  else if (/^[+-]?(inf|nan)/i.test(s)) return undefined;
  else return undefined;
  return fr(v);
}

export function type(v) {
  if (v === undefined || v === null) return 'nil';
  const t = typeof v;
  if (t === 'boolean') return 'boolean';
  if (t === 'number') return 'number';
  if (t === 'string') return 'string';
  if (v instanceof LuaTable) return 'table';
  if (v instanceof LuaFunction || t === 'function') return 'function';
  return 'userdata';
}

export function tostring(v) {
  switch (typeof v) {
    case 'undefined': return 'nil';
    case 'boolean': return v ? 'true' : 'false';
    case 'number': return numberToString(v);
    case 'string': return v;
    default:
      if (v instanceof LuaTable) {
        const mt = v.mt;
        if (mt) {
          const ts = mt.get('__tostring');
          if (ts) return tostring(currentVM.call(ts, [v])[0]);
        }
        if (!v._id) v._id = ++idCounter;
        return 'table: 0x' + v._id.toString(16).padStart(8, '0');
      }
      if (!v._id) v._id = ++idCounter;
      return (typeof v === 'function' ? 'builtin: 0x' : 'function: 0x') + v._id.toString(16).padStart(8, '0');
  }
}
let idCounter = 0;
let currentVM = null;

// ---------- the interpreter ----------
export class LuaVM {
  constructor() {
    this.G = new LuaTable();
    this.stringMeta = null;
    this.callDepth = 0;
    currentVM = this;
  }

  load(bytes, name) {
    const p = undump(bytes, name);
    return new LuaFunction(p, [], this.G);
  }

  error(msg) { throw new LuaError(msg); }

  // ---- metatable helpers ----
  getmetatable(v) {
    if (v instanceof LuaTable) return v.mt;
    if (typeof v === 'string') return this.stringMeta;
    return null;
  }
  metaOf(v, ev) {
    const mt = this.getmetatable(v);
    return mt ? mt.get(ev) : undefined;
  }

  index(o, k) {
    for (let loop = 0; loop < 100; loop++) {
      let h;
      if (o instanceof LuaTable) {
        const v = o.get(k);
        if (v !== undefined) return v;
        if (!o.mt || (h = o.mt.get('__index')) === undefined) return undefined;
      } else {
        h = this.metaOf(o, '__index');
        if (h === undefined) this.error(`attempt to index a ${type(o)} value` + this._varInfo(k));
      }
      if (typeof h === 'function' || h instanceof LuaFunction) return this.call(h, [o, k])[0];
      o = h;
    }
    this.error('loop in gettable');
  }

  setindex(o, k, v) {
    for (let loop = 0; loop < 100; loop++) {
      let h;
      if (o instanceof LuaTable) {
        if (!o.mt || o.get(k) !== undefined || (h = o.mt.get('__newindex')) === undefined) {
          o.set(k, v);
          return;
        }
      } else {
        h = this.metaOf(o, '__newindex');
        if (h === undefined) this.error(`attempt to index a ${type(o)} value` + this._varInfo(k));
      }
      if (typeof h === 'function' || h instanceof LuaFunction) { this.call(h, [o, k, v]); return; }
      o = h;
    }
    this.error('loop in settable');
  }

  _varInfo(k) { return k !== undefined ? ` (field '${tostring(k)}')` : ''; }

  tonum(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return str2number(v);
    return undefined;
  }

  arith(op, a, b) {
    const na = this.tonum(a), nb = this.tonum(b);
    if (na !== undefined && nb !== undefined) return arithRaw(op, na, nb);
    const ev = ARITH_EV[op];
    let h = this.metaOf(a, ev);
    if (h === undefined) h = this.metaOf(b, ev);
    if (h === undefined) {
      const bad = na === undefined ? a : b;
      this.error(`attempt to perform arithmetic on a ${type(bad)} value`);
    }
    return this.call(h, [a, b])[0];
  }

  eq(a, b) {
    if (a === b) return true;
    const ta = type(a);
    if (ta !== type(b)) return false;
    if (ta === 'table') {
      const h1 = this.metaOf(a, '__eq'), h2 = this.metaOf(b, '__eq');
      if (h1 !== undefined && h1 === h2) return !!truthy(this.call(h1, [a, b])[0]);
    }
    return false;
  }

  lt(a, b) {
    const ta = typeof a, tb = typeof b;
    if (ta === 'number' && tb === 'number') return a < b;
    if (ta === 'string' && tb === 'string') return a < b;
    const h = this.metaOf(a, '__lt');
    if (h !== undefined && h === this.metaOf(b, '__lt')) return truthy(this.call(h, [a, b])[0]);
    this.compareError(a, b);
  }
  le(a, b) {
    const ta = typeof a, tb = typeof b;
    if (ta === 'number' && tb === 'number') return a <= b;
    if (ta === 'string' && tb === 'string') return a <= b;
    let h = this.metaOf(a, '__le');
    if (h !== undefined && h === this.metaOf(b, '__le')) return truthy(this.call(h, [a, b])[0]);
    h = this.metaOf(a, '__lt');
    if (h !== undefined && h === this.metaOf(b, '__lt')) return !truthy(this.call(h, [b, a])[0]);
    this.compareError(a, b);
  }
  compareError(a, b) {
    const t1 = type(a), t2 = type(b);
    if (t1 === t2) this.error(`attempt to compare two ${t1} values`);
    this.error(`attempt to compare ${t1} with ${t2}`);
  }

  len(v) {
    if (typeof v === 'string') return v.length;
    if (v instanceof LuaTable) return v.length();
    const h = this.metaOf(v, '__len');
    if (h !== undefined) return this.call(h, [v])[0];
    this.error(`attempt to get length of a ${type(v)} value`);
  }

  concat(a, b) {
    const ta = typeof a, tb = typeof b;
    if ((ta === 'string' || ta === 'number') && (tb === 'string' || tb === 'number')) {
      return (ta === 'number' ? numberToString(a) : a) + (tb === 'number' ? numberToString(b) : b);
    }
    let h = this.metaOf(a, '__concat');
    if (h === undefined) h = this.metaOf(b, '__concat');
    if (h === undefined) {
      const bad = (ta === 'string' || ta === 'number') ? b : a;
      this.error(`attempt to concatenate a ${type(bad)} value`);
    }
    return this.call(h, [a, b])[0];
  }

  // Call any callable value with an args array; returns results array.
  call(f, args) {
    if (f instanceof LuaFunction) return this.execute(f, args);
    if (typeof f === 'function') {
      const r = f.apply(this, args);
      if (r === undefined) return [];
      return r;
    }
    const h = this.metaOf(f, '__call');
    if (h !== undefined) return this.call(h, [f, ...args]);
    this.error(`attempt to call a ${type(f)} value`);
  }

  execute(cl, args) {
    if (++this.callDepth > 190) { this.callDepth = 0; this.error('stack overflow'); }
    const p = cl.p;
    const code_op = p.op, code_A = p.A, code_B = p.B, code_C = p.C;
    const K = p.k;
    const R = new Array(p.maxStack + 1);
    const np = p.numparams;
    for (let i = 0; i < np; i++) R[i] = args[i];
    let varargs = null;
    if (p.isVararg) varargs = args.length > np ? args.slice(np) : [];
    let openUps = null; // array of UpVal
    let top = 0;
    let pc = 0;
    const self = this;
    const upvals = cl.upvals;
    const env = cl.env;

    const closeUps = (level) => {
      if (!openUps) return;
      for (let i = openUps.length - 1; i >= 0; i--) {
        const u = openUps[i];
        if (u.idx >= level) { u.close(); openUps.splice(i, 1); }
      }
    };
    const findUp = (idx) => {
      if (!openUps) openUps = [];
      for (let i = 0; i < openUps.length; i++) if (openUps[i].idx === idx) return openUps[i];
      const u = new UpVal(R, idx);
      openUps.push(u);
      return u;
    };

    try {
      for (;;) {
        const i = pc++;
        const A = code_A[i];
        switch (code_op[i]) {
          case 0: R[A] = R[code_B[i]]; break; // MOVE
          case 1: R[A] = K[code_B[i]]; break; // LOADK
          case 2: R[A] = code_B[i] !== 0; if (code_C[i]) pc++; break; // LOADBOOL
          case 3: for (let r = A, b = code_B[i]; r <= b; r++) R[r] = undefined; break; // LOADNIL
          case 4: R[A] = upvals[code_B[i]].get(); break; // GETUPVAL
          case 5: { // GETGLOBAL
            const k = K[code_B[i]];
            const v = env.get(k);
            R[A] = (v !== undefined || !env.mt) ? v : self.index(env, k);
            break;
          }
          case 6: { // GETTABLE
            const t = R[code_B[i]];
            const c = code_C[i];
            const k = c & 256 ? K[c & 255] : R[c];
            if (t instanceof LuaTable) {
              const v = t.get(k);
              R[A] = (v !== undefined || !t.mt) ? v : self.index(t, k);
            } else R[A] = self.index(t, k);
            break;
          }
          case 7: { // SETGLOBAL
            const k = K[code_B[i]];
            if (self.onSetGlobal) self.onSetGlobal(k, R[A], p, i);
            if (!env.mt) env.set(k, R[A]); else self.setindex(env, k, R[A]);
            break;
          }
          case 8: upvals[code_B[i]].set(R[A]); break; // SETUPVAL
          case 9: { // SETTABLE
            const b = code_B[i], c = code_C[i];
            const k = b & 256 ? K[b & 255] : R[b];
            const v = c & 256 ? K[c & 255] : R[c];
            const t = R[A];
            if (t instanceof LuaTable && !t.mt) t.set(k, v);
            else self.setindex(t, k, v);
            break;
          }
          case 10: R[A] = new LuaTable(); break; // NEWTABLE
          case 11: { // SELF
            const o = R[code_B[i]];
            const c = code_C[i];
            const k = c & 256 ? K[c & 255] : R[c];
            R[A + 1] = o;
            R[A] = self.index(o, k);
            break;
          }
          case 12: case 13: case 14: case 15: case 16: case 17: { // arith
            const b = code_B[i], c = code_C[i];
            const x = b & 256 ? K[b & 255] : R[b];
            const y = c & 256 ? K[c & 255] : R[c];
            const op = code_op[i];
            if (typeof x === 'number' && typeof y === 'number') {
              switch (op) {
                case 12: R[A] = fr(x + y); break;
                case 13: R[A] = fr(x - y); break;
                case 14: R[A] = fr(x * y); break;
                case 15: R[A] = fr(x / y); break;
                case 16: R[A] = fr(x - Math.floor(fr(x / y)) * y); break;
                case 17: R[A] = fr(Math.pow(x, y)); break;
              }
            } else R[A] = self.arith(op, x, y);
            break;
          }
          case 18: { // UNM
            const x = R[code_B[i]];
            if (typeof x === 'number') R[A] = -x;
            else {
              const n = self.tonum(x);
              if (n !== undefined) R[A] = -n;
              else {
                const h = self.metaOf(x, '__unm');
                if (h === undefined) self.error(`attempt to perform arithmetic on a ${type(x)} value`);
                R[A] = self.call(h, [x, x])[0];
              }
            }
            break;
          }
          case 19: { const x = R[code_B[i]]; R[A] = x === undefined || x === false; break; } // NOT
          case 20: R[A] = self.len(R[code_B[i]]); break; // LEN
          case 21: { // CONCAT
            const b = code_B[i], c = code_C[i];
            let acc = R[c];
            for (let r = c - 1; r >= b; r--) acc = self.concat(R[r], acc);
            R[A] = acc;
            break;
          }
          case 22: pc += code_B[i]; break; // JMP
          case 23: case 24: case 25: { // EQ LT LE
            const b = code_B[i], c = code_C[i];
            const x = b & 256 ? K[b & 255] : R[b];
            const y = c & 256 ? K[c & 255] : R[c];
            let res;
            const op = code_op[i];
            if (op === 23) res = x === y || self.eq(x, y);
            else if (op === 24) res = (typeof x === 'number' && typeof y === 'number') ? x < y : self.lt(x, y);
            else res = (typeof x === 'number' && typeof y === 'number') ? x <= y : self.le(x, y);
            if (res !== (A !== 0)) pc++;
            else pc += code_B[pc] + 1; // following JMP
            break;
          }
          case 26: { // TEST
            const v = R[A];
            const t = !(v === undefined || v === false);
            if (t !== (code_C[i] !== 0)) pc++;
            else pc += code_B[pc] + 1;
            break;
          }
          case 27: { // TESTSET
            const v = R[code_B[i]];
            const t = !(v === undefined || v === false);
            if (t !== (code_C[i] !== 0)) pc++;
            else { R[A] = v; pc += code_B[pc] + 1; }
            break;
          }
          case 28: case 29: { // CALL / TAILCALL
            const b = code_B[i];
            const nargs = b === 0 ? top - A - 1 : b - 1;
            const f = R[A];
            const cargs = new Array(nargs);
            for (let j = 0; j < nargs; j++) cargs[j] = R[A + 1 + j];
            let res;
            if (f instanceof LuaFunction) res = self.execute(f, cargs);
            else if (typeof f === 'function') {
              res = f.apply(self, cargs);
              if (res === undefined) res = [];
            } else {
              if (self.metaOf(f, '__call') === undefined) {
                self.error(`attempt to call ${self._describeReg(p, i, A)} (a ${type(f)} value)`);
              }
              res = self.call(f, cargs);
            }
            if (code_op[i] === 29) { // TAILCALL -> return results
              closeUps(0);
              this.callDepth--;
              return res;
            }
            const c = code_C[i];
            if (c === 0) {
              for (let j = 0; j < res.length; j++) R[A + j] = res[j];
              top = A + res.length;
            } else {
              for (let j = 0; j < c - 1; j++) R[A + j] = res[j];
            }
            break;
          }
          case 30: { // RETURN
            const b = code_B[i];
            const n = b === 0 ? top - A : b - 1;
            const out = new Array(n);
            for (let j = 0; j < n; j++) out[j] = R[A + j];
            closeUps(0);
            this.callDepth--;
            return out;
          }
          case 31: { // FORLOOP
            const step = R[A + 2];
            const idx = fr(R[A] + step);
            const limit = R[A + 1];
            if (step > 0 ? idx <= limit : limit <= idx) {
              pc += code_B[i];
              R[A] = idx;
              R[A + 3] = idx;
            }
            break;
          }
          case 32: { // FORPREP
            const init = self.tonum(R[A]), lim = self.tonum(R[A + 1]), st = self.tonum(R[A + 2]);
            if (init === undefined) self.error("'for' initial value must be a number");
            if (lim === undefined) self.error("'for' limit must be a number");
            if (st === undefined) self.error("'for' step must be a number");
            R[A] = fr(init - st); R[A + 1] = lim; R[A + 2] = st;
            pc += code_B[i];
            break;
          }
          case 33: { // TFORLOOP
            const c = code_C[i];
            const res = self.call(R[A], [R[A + 1], R[A + 2]]);
            for (let j = 0; j < c; j++) R[A + 3 + j] = res[j];
            const v = R[A + 3];
            if (v !== undefined) { R[A + 2] = v; pc += code_B[pc] + 1; }
            else pc++;
            break;
          }
          case 34: { // SETLIST
            let n = code_B[i];
            let c = code_C[i];
            if (n === 0) n = top - A - 1;
            if (c === 0) c = p.code[pc++] >>> 0;
            const t = R[A];
            const base = (c - 1) * 50;
            for (let j = 1; j <= n; j++) t.set(base + j, R[A + j]);
            break;
          }
          case 35: closeUps(A); break; // CLOSE
          case 36: { // CLOSURE
            const np2 = p.p[code_B[i]];
            const ups = new Array(np2.nups);
            for (let j = 0; j < np2.nups; j++) {
              const pi = pc++;
              if (code_op[pi] === 0) ups[j] = findUp(code_B[pi]); // MOVE
              else ups[j] = upvals[code_B[pi]]; // GETUPVAL
            }
            R[A] = new LuaFunction(np2, ups, env);
            break;
          }
          case 37: { // VARARG
            const b = code_B[i];
            if (b === 0) {
              for (let j = 0; j < varargs.length; j++) R[A + j] = varargs[j];
              top = A + varargs.length;
            } else {
              for (let j = 0; j < b - 1; j++) R[A + j] = varargs[j];
            }
            break;
          }
          default:
            self.error('bad opcode ' + code_op[i]);
        }
      }
    } catch (e) {
      closeUps(0);
      this.callDepth--;
      if (e instanceof LuaError) {
        if (!e.located) {
          e.located = true;
          const line = p.lineinfo[pc - 1];
          const src = (p.source || '?').replace(/^[=@]/, '');
          if (typeof e.value === 'string') { e.value = `${src}:${line}: ${e.value}`; e.message = e.value; }
        }
        if (!e.luaTraceback) e.luaTraceback = [];
        e.luaTraceback.push(`${(p.source || '?').replace(/^[=@]/, '')}:${p.lineinfo[pc - 1]} (function at line ${p.lineDefined})`);
        throw e;
      }
      if (e instanceof RangeError) {
        throw new LuaError('stack overflow (js)');
      }
      // native JS error inside a builtin: wrap with location
      const le = new LuaError(`${(p.source || '?').replace(/^[=@]/, '')}:${p.lineinfo[pc - 1]}: ${e && e.message}`);
      le.located = true;
      le.jsError = e;
      le.luaTraceback = [`${(p.source || '?').replace(/^[=@]/, '')}:${p.lineinfo[pc - 1]}`];
      throw le;
    }
  }

  _describeReg(p, pc, reg) {
    // best effort: look back for GETGLOBAL/GETTABLE that loaded reg
    for (let j = pc - 1; j >= 0; j--) {
      if (p.A[j] === reg) {
        if (p.op[j] === 5) return `global '${p.k[p.B[j]]}'`;
        if (p.op[j] === 6 && (p.C[j] & 256)) return `field '${p.k[p.C[j] & 255]}'`;
        if (p.op[j] === 11 && (p.C[j] & 256)) return `method '${p.k[p.C[j] & 255]}'`;
        break;
      }
    }
    return 'a value';
  }
}

const ARITH_EV = { 12: '__add', 13: '__sub', 14: '__mul', 15: '__div', 16: '__mod', 17: '__pow' };
function arithRaw(op, x, y) {
  switch (op) {
    case 12: return fr(x + y);
    case 13: return fr(x - y);
    case 14: return fr(x * y);
    case 15: return fr(x / y);
    case 16: return fr(x - Math.floor(fr(x / y)) * y);
    case 17: return fr(Math.pow(x, y));
  }
}

export function truthy(v) { return !(v === undefined || v === false); }

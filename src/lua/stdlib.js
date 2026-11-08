// Lua 5.1 standard library subset used by the original Angry Birds scripts
// (base, math, table, string, os), with float32 number semantics.
import { LuaTable, LuaFunction, LuaError, tostring, type, str2number, truthy, numberToString } from './vm.js';

const fr = Math.fround;

// Lua 5.1 math.random uses C rand(). iPhone OS libc (FreeBSD-derived rand.c) is the
// Park-Miller "minimal standard" generator, RAND_MAX = 0x7fffffff, default seed 1.
let seed = 1;
function crand() {
  if (seed === 0) seed = 123459876;
  const hi = Math.floor(seed / 127773), lo = seed % 127773;
  let x = 16807 * lo - 2836 * hi;
  if (x < 0) x += 0x7fffffff;
  seed = x;
  return x % (0x7fffffff + 1);
}
const RAND_MAX = 0x7fffffff;

export function installStdlib(vm) {
  const G = vm.G;
  const err = (m) => { throw new LuaError(m); };
  const checkTable = (t, n, fname) => { if (!(t instanceof LuaTable)) err(`bad argument #${n} to '${fname}' (table expected, got ${type(t) === 'nil' ? 'no value' : type(t)})`); return t; };
  const checkNum = (v, n, fname) => {
    const x = vm.tonum(v);
    if (x === undefined) err(`bad argument #${n} to '${fname}' (number expected, got ${type(v)})`);
    return x;
  };

  G.set('_G', G);
  G.set('_VERSION', 'Lua 5.1');
  G.set('type', (v) => [type(v)]);
  G.set('tostring', (v) => [tostring(v)]);
  G.set('tonumber', (v, base) => {
    if (base === undefined || base === 10) {
      if (typeof v === 'number') return [v];
      if (typeof v === 'string') return [str2number(v)];
      return [undefined];
    }
    const n = parseInt(String(v).trim(), base);
    return [isNaN(n) ? undefined : fr(n)];
  });
  G.set('print', (...a) => { console.log(a.map(tostring).join('\t')); });
  G.set('rawget', (t, k) => [checkTable(t, 1, 'rawget').get(k)]);
  G.set('rawset', (t, k, v) => { checkTable(t, 1, 'rawset').set(k, v); return [t]; });
  G.set('rawequal', (a, b) => [a === b]);
  G.set('setmetatable', (t, m) => { checkTable(t, 1, 'setmetatable'); t.mt = m || null; return [t]; });
  G.set('getmetatable', (t) => { const m = vm.getmetatable(t); if (!m) return [undefined]; const p = m.get('__metatable'); return [p !== undefined ? p : m]; });
  const next = (t, k) => { checkTable(t, 1, 'next'); const r = t.next(k); return r ? r : [undefined]; };
  G.set('next', next);
  G.set('pairs', (t) => { checkTable(t, 1, 'pairs'); return [next, t, undefined]; });
  const inext = (t, i) => { i = i + 1; const v = vm.index(t, i); return v === undefined ? [undefined] : [i, v]; };
  G.set('ipairs', (t) => { checkTable(t, 1, 'ipairs'); return [inext, t, 0]; });
  G.set('unpack', (t, i, j) => {
    checkTable(t, 1, 'unpack');
    i = i === undefined ? 1 : i; j = j === undefined ? t.length() : j;
    const out = [];
    for (let k = i; k <= j; k++) out.push(t.get(k));
    return out;
  });
  G.set('select', (n, ...a) => {
    if (n === '#') return [a.length];
    n = checkNum(n, 1, 'select');
    if (n < 0) n = a.length + n; else if (n === 0) err("bad argument #1 to 'select' (index out of range)"); else n = n - 1;
    return a.slice(n);
  });
  G.set('error', (m, level) => {
    const e = new LuaError(m);
    if (level === 0) e.located = true;
    throw e;
  });
  G.set('assert', (v, m, ...rest) => { if (!truthy(v)) err(m === undefined ? 'assertion failed!' : m); return [v, m, ...rest]; });
  G.set('pcall', (f, ...a) => {
    const depth = vm.callDepth;
    try { return [true, ...vm.call(f, a)]; } catch (e) {
      vm.callDepth = depth;
      if (e instanceof LuaError) return [false, e.value];
      return [false, String(e && e.message)];
    }
  });
  G.set('xpcall', (f, h) => {
    const depth = vm.callDepth;
    try { return [true, ...vm.call(f, [])]; } catch (e) {
      vm.callDepth = depth;
      return [false, ...vm.call(h, [e instanceof LuaError ? e.value : String(e)])];
    }
  });
  G.set('collectgarbage', () => [0]);
  G.set('setfenv', (f) => [f]);
  G.set('getfenv', () => [G]);
  G.set('loadstring', () => [undefined, 'loadstring unsupported: no Lua compiler in the original runtime path']);

  // ---------- math ----------
  const math = new LuaTable();
  const m1 = (name, fn) => math.set(name, (x) => [fr(fn(checkNum(x, 1, name)))]);
  m1('floor', Math.floor); m1('ceil', Math.ceil); m1('abs', Math.abs); m1('sqrt', Math.sqrt);
  m1('sin', Math.sin); m1('cos', Math.cos); m1('tan', Math.tan); m1('asin', Math.asin);
  m1('acos', Math.acos); m1('atan', Math.atan); m1('exp', Math.exp); m1('log', Math.log);
  m1('log10', Math.log10); m1('sinh', Math.sinh); m1('cosh', Math.cosh); m1('tanh', Math.tanh);
  m1('deg', (x) => x * (180 / Math.PI)); m1('rad', (x) => x * (Math.PI / 180));
  math.set('atan2', (y, x) => [fr(Math.atan2(checkNum(y, 1, 'atan2'), checkNum(x, 2, 'atan2')))]);
  math.set('pow', (x, y) => [fr(Math.pow(checkNum(x, 1, 'pow'), checkNum(y, 2, 'pow')))]);
  math.set('fmod', (x, y) => [fr(checkNum(x, 1, 'fmod') % checkNum(y, 2, 'fmod'))]);
  math.set('modf', (x) => { x = checkNum(x, 1, 'modf'); const i = x >= 0 ? Math.floor(x) : Math.ceil(x); return [fr(i), fr(x - i)]; });
  math.set('min', (...a) => { let m = checkNum(a[0], 1, 'min'); for (let i = 1; i < a.length; i++) { const v = checkNum(a[i], i + 1, 'min'); if (v < m) m = v; } return [m]; });
  math.set('max', (...a) => { let m = checkNum(a[0], 1, 'max'); for (let i = 1; i < a.length; i++) { const v = checkNum(a[i], i + 1, 'max'); if (v > m) m = v; } return [m]; });
  math.set('pi', fr(Math.PI));
  math.set('huge', Infinity);
  math.set('random', (m, n) => {
    const r = fr((crand() % RAND_MAX) / RAND_MAX);
    if (m === undefined) return [r];
    if (n === undefined) { m = checkNum(m, 1, 'random'); if (m < 1) err("bad argument #1 to 'random' (interval is empty)"); return [fr(Math.floor(r * m) + 1)]; }
    m = checkNum(m, 1, 'random'); n = checkNum(n, 2, 'random');
    if (m > n) err("bad argument #2 to 'random' (interval is empty)");
    return [fr(Math.floor(r * (n - m + 1)) + m)];
  });
  math.set('randomseed', (s) => { seed = (checkNum(s, 1, 'randomseed') >>> 0) % 0x100000000; });
  G.set('math', math);

  // ---------- table ----------
  const table = new LuaTable();
  table.set('insert', (...a) => {
    const t = checkTable(a[0], 1, 'insert');
    const e = t.length() + 1;
    if (a.length === 2) { t.set(e, a[1]); return; }
    if (a.length !== 3) err("wrong number of arguments to 'insert'");
    let pos = checkNum(a[1], 2, 'insert');
    for (let i = e; i > pos; i--) t.set(i, t.get(i - 1));
    t.set(pos, a[2]);
  });
  table.set('remove', (t, pos) => {
    checkTable(t, 1, 'remove');
    const e = t.length();
    if (e === 0) return [undefined];
    pos = pos === undefined ? e : checkNum(pos, 2, 'remove');
    const v = t.get(pos);
    for (let i = pos; i < e; i++) t.set(i, t.get(i + 1));
    t.set(e, undefined);
    return [v];
  });
  table.set('getn', (t) => [checkTable(t, 1, 'getn').length()]);
  table.set('concat', (t, sep, i, j) => {
    checkTable(t, 1, 'concat');
    sep = sep === undefined ? '' : sep; i = i === undefined ? 1 : i; j = j === undefined ? t.length() : j;
    const parts = [];
    for (let k = i; k <= j; k++) { const v = t.get(k); parts.push(typeof v === 'number' ? numberToString(v) : v); }
    return [parts.join(sep)];
  });
  table.set('sort', (t, cmp) => {
    checkTable(t, 1, 'sort');
    const n = t.length();
    const a = [];
    for (let k = 1; k <= n; k++) a.push(t.get(k));
    const lt = cmp ? (x, y) => truthy(vm.call(cmp, [x, y])[0]) : (x, y) => vm.lt(x, y);
    a.sort((x, y) => (lt(x, y) ? -1 : lt(y, x) ? 1 : 0));
    for (let k = 1; k <= n; k++) t.set(k, a[k - 1]);
  });
  G.set('table', table);

  // ---------- string ----------
  const string = new LuaTable();
  const checkStr = (v, n, f) => { if (typeof v === 'number') return numberToString(v); if (typeof v !== 'string') err(`bad argument #${n} to '${f}' (string expected, got ${type(v)})`); return v; };
  string.set('len', (s) => [checkStr(s, 1, 'len').length]);
  string.set('sub', (s, i, j) => {
    s = checkStr(s, 1, 'sub'); const l = s.length;
    i = i === undefined ? 1 : Math.trunc(i); j = j === undefined ? -1 : Math.trunc(j);
    if (i < 0) i = Math.max(l + i + 1, 1); else if (i === 0) i = 1;
    if (j < 0) j = l + j + 1; else if (j > l) j = l;
    return [i > j ? '' : s.substring(i - 1, j)];
  });
  string.set('upper', (s) => [checkStr(s, 1, 'upper').toUpperCase()]);
  string.set('lower', (s) => [checkStr(s, 1, 'lower').toLowerCase()]);
  string.set('rep', (s, n) => [checkStr(s, 1, 'rep').repeat(Math.max(0, n | 0))]);
  string.set('reverse', (s) => [checkStr(s, 1, 'reverse').split('').reverse().join('')]);
  string.set('byte', (s, i, j) => {
    s = checkStr(s, 1, 'byte'); i = i === undefined ? 1 : i; j = j === undefined ? i : j;
    const out = []; for (let k = i; k <= j && k <= s.length; k++) out.push(s.charCodeAt(k - 1)); return out;
  });
  string.set('char', (...a) => [String.fromCharCode(...a.map((x) => x & 255))]);
  string.set('format', (fmt, ...args) => [luaFormat(checkStr(fmt, 1, 'format'), args, err)]);
  string.set('find', (s, pat, init, plain) => {
    s = checkStr(s, 1, 'find'); pat = checkStr(pat, 2, 'find');
    init = init === undefined ? 1 : init; if (init < 0) init = Math.max(1, s.length + init + 1);
    if (truthy(plain) || !/[\^$*+?.()[\]%-]/.test(pat)) {
      const idx = s.indexOf(pat, init - 1);
      return idx < 0 ? [undefined] : [idx + 1, idx + pat.length];
    }
    const re = luaPatternToRegExp(pat, err);
    re.lastIndex = init - 1;
    const m = re.exec(s);
    if (!m) return [undefined];
    return [m.index + 1, m.index + m[0].length, ...m.slice(1)];
  });
  string.set('match', (s, pat, init) => {
    s = checkStr(s, 1, 'match'); pat = checkStr(pat, 2, 'match');
    const re = luaPatternToRegExp(pat, err);
    re.lastIndex = (init || 1) - 1;
    const m = re.exec(s);
    if (!m) return [undefined];
    return m.length > 1 ? m.slice(1) : [m[0]];
  });
  string.set('gmatch', (s, pat) => {
    s = checkStr(s, 1, 'gmatch');
    const re = luaPatternToRegExp(checkStr(pat, 2, 'gmatch'), err, true);
    return [() => {
      const m = re.exec(s);
      if (!m) return [undefined];
      if (m[0] === '') re.lastIndex++;
      return m.length > 1 ? m.slice(1) : [m[0]];
    }];
  });
  string.set('gsub', (s, pat, repl, n) => {
    s = checkStr(s, 1, 'gsub');
    const re = luaPatternToRegExp(checkStr(pat, 2, 'gsub'), err, true);
    let count = 0;
    const max = n === undefined ? Infinity : n;
    const out = s.replace(re, (...m) => {
      if (count >= max) return m[0];
      count++;
      const caps = m.slice(1, -2);
      const whole = m[0];
      const first = caps.length ? caps[0] : whole;
      let r;
      if (typeof repl === 'string' || typeof repl === 'number') {
        r = String(typeof repl === 'number' ? numberToString(repl) : repl).replace(/%([0-9%])/g, (_, d) => (d === '%' ? '%' : d === '0' ? whole : caps[+d - 1] ?? whole));
        return r;
      }
      if (repl instanceof LuaTable) r = repl.get(first);
      else r = vm.call(repl, caps.length ? caps : [whole])[0];
      if (r === undefined || r === false) return whole;
      return typeof r === 'number' ? numberToString(r) : r;
    });
    return [out, count];
  });
  G.set('string', string);
  const smeta = new LuaTable();
  smeta.set('__index', string);
  vm.stringMeta = smeta;

  // ---------- os ----------
  const os = new LuaTable();
  os.set('time', () => [fr(Math.floor(Date.now() / 1000))]);
  os.set('clock', () => [fr(performance.now() / 1000)]);
  os.set('date', () => [new Date().toString()]);
  G.set('os', os);
}

function luaFormat(fmt, args, err) {
  let ai = 0;
  return fmt.replace(/%([-+ #0]*)(\d*)(?:\.(\d+))?([diouxXeEfgGqsc%])/g, (all, flags, width, prec, conv) => {
    if (conv === '%') return '%';
    const a = args[ai++];
    let s;
    switch (conv) {
      case 'd': case 'i': {
        const n = Math.trunc(Number(a)); s = Math.abs(n).toString();
        if (prec !== undefined) s = s.padStart(+prec, '0');
        if (n < 0) s = '-' + s; else if (flags.includes('+')) s = '+' + s; else if (flags.includes(' ')) s = ' ' + s;
        break;
      }
      case 'u': s = String(Math.trunc(Number(a)) >>> 0); break;
      case 'o': s = (Math.trunc(Number(a)) >>> 0).toString(8); break;
      case 'x': s = (Math.trunc(Number(a)) >>> 0).toString(16); break;
      case 'X': s = (Math.trunc(Number(a)) >>> 0).toString(16).toUpperCase(); break;
      case 'c': s = String.fromCharCode(Number(a)); break;
      case 'f': { const n = Number(a); s = n.toFixed(prec === undefined ? 6 : +prec); if (n >= 0 && flags.includes('+')) s = '+' + s; break; }
      case 'e': case 'E': { s = Number(a).toExponential(prec === undefined ? 6 : +prec).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); break; }
      case 'g': case 'G': { s = gfmt(Number(a), prec === undefined ? 6 : +prec); if (conv === 'G') s = s.toUpperCase(); break; }
      case 'q': s = '"' + String(a).replace(/[\\"\n\r\0]/g, (c) => (c === '\n' ? '\\\n' : c === '\r' ? '\\r' : c === '\0' ? '\\000' : '\\' + c)) + '"'; break;
      case 's': s = tostring(a); if (prec !== undefined) s = s.slice(0, +prec); break;
      default: err('invalid option to format');
    }
    if (width && s.length < +width) {
      if (flags.includes('-')) s = s.padEnd(+width);
      else if (flags.includes('0') && 'dioxXfeEgG'.includes(conv)) {
        const neg = s[0] === '-' || s[0] === '+';
        s = neg ? s[0] + s.slice(1).padStart(+width - 1, '0') : s.padStart(+width, '0');
      } else s = s.padStart(+width);
    }
    return s;
  });
}
function gfmt(x, p) {
  if (p === 0) p = 1;
  if (!isFinite(x)) return x !== x ? 'nan' : x > 0 ? 'inf' : '-inf';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(Number(x.toExponential(p - 1)))));
  if (e < -4 || e >= p) {
    let [m, ex] = x.toExponential(p - 1).split('e');
    if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
    const sign = ex[0] === '-' ? '-' : '+'; let d = ex.replace(/^[+-]/, ''); if (d.length < 2) d = '0' + d;
    return `${m}e${sign}${d}`;
  }
  let s = x.toFixed(Math.max(0, p - 1 - e));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

const CLASS = { a: 'A-Za-z', d: '0-9', l: 'a-z', s: '\\s', u: 'A-Z', w: 'A-Za-z0-9', x: 'A-Fa-f0-9', p: '!-\\/:-@\\[-`{-~', c: '\\x00-\\x1f\\x7f' };
function luaPatternToRegExp(pat, err, global) {
  let re = '';
  let i = 0;
  const cls = (c, inSet) => {
    const lc = c.toLowerCase();
    if (CLASS[lc]) {
      if (c === lc) return inSet ? CLASS[lc] : `[${CLASS[lc]}]`;
      return inSet ? null : `[^${CLASS[lc]}]`;
    }
    return '\\' + c;
  };
  if (pat[0] === '^') { re += '^'; i = 1; }
  while (i < pat.length) {
    const c = pat[i];
    if (c === '%') {
      const n = pat[i + 1];
      i += 2;
      re += cls(n, false);
    } else if (c === '[') {
      let j = i + 1; let set = '[';
      if (pat[j] === '^') { set += '^'; j++; }
      while (j < pat.length && (pat[j] !== ']' || j === i + 1)) {
        if (pat[j] === '%') { set += cls(pat[j + 1], true) ?? ''; j += 2; } else { set += pat[j] === '\\' || pat[j] === ']' || pat[j] === '[' ? '\\' + pat[j] : pat[j]; j++; }
      }
      re += set + ']'; i = j + 1;
    } else if (c === '-') { re += '*?'; i++; } else if (c === '.') { re += '[\\s\\S]'; i++; } else if ('*+?()$'.includes(c)) {
      if (c === '$' && i !== pat.length - 1) re += '\\$'; else re += c;
      i++;
    } else { re += c.replace(/[\\^{}|\/]/g, '\\$&'); i++; }
  }
  try { return new RegExp(re, global ? 'g' : 'y'.replace('y', 'g')); } catch (e) { err('malformed pattern: ' + pat); }
}

export { luaFormat };

import fs from 'fs';
import { LuaVM, LuaTable, tostring } from '../src/lua/vm.js';
import { installStdlib } from '../src/lua/stdlib.js';
const vm = new LuaVM(); installStdlib(vm);
const before = new Set(Array.from(vm.G.hash.keys()));
for (const f of process.argv.slice(2)) vm.call(vm.load(fs.readFileSync(f), f.split('/').pop()), []);
function conv(v, d=0) { if (v instanceof LuaTable) { if (d>8) return '...'; const o = {}; let k; let r = v.next(undefined); while (r) { o[tostring(r[0])] = conv(r[1], d+1); r = v.next(r[0]); } return o; } return typeof v === 'function' ? '<fn>' : (v && v.p ? '<lua fn>' : v); }
const out = {}; for (const [k, v] of vm.G.hash) if (!before.has(k)) out[k] = conv(v);
console.log(JSON.stringify(out, null, 1));

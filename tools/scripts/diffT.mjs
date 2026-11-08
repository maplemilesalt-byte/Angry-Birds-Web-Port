import taps from './taps.mjs';
const [a, b] = (process.env.RANGE || '0:0').split(':').map(Number);
let prev = null;
const snap = (T) => { const m = new Map(); for (const [k, v] of T.hash) { if (typeof v === 'function' || (v && v.p)) continue; if (v && v.hash) { for (const [k2, v2] of v.hash) if (typeof v2 !== 'object' && typeof v2 !== 'function') m.set(k + '.' + k2, v2); } else m.set(k, v); } return m; };
export default async function (app, i) {
  await taps(app, i);
  if (i < a || i > b) return;
  const s = snap(app.game.T);
  if (prev) for (const [k, v] of s) if (prev.get(k) !== v && !/Timer|timer|Slider|fps|percentage|offset|Time/.test(k)) console.log(i, k, prev.get(k), '->', v);
  prev = s;
}

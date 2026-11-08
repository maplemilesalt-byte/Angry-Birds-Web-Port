import taps from './taps.mjs';
const vars = (process.env.VARS || '').split(',').filter(Boolean);
const [a, b] = (process.env.RANGE || '0:0').split(':').map(Number);
const fmt = (v) => (v && v.hash ? '{' + [...v.hash].filter(([k, x]) => typeof x !== 'object' && typeof x !== 'function').map(([k, x]) => `${k}=${typeof x === 'number' ? +x.toFixed(2) : x}`).join(' ') + '}' : v);
export default async function (app, i) {
  await taps(app, i);
  if (i >= a && i <= b) console.log(i, vars.map((k) => `${k}=${fmt(app.game.T.get(k))}`).join(' | '));
}

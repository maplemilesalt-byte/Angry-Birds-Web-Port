import taps from './taps.mjs';
const vars = (process.env.VARS || '').split(',').filter(Boolean);
const last = {};
export default async function (app, i) {
  await taps(app, i);
  for (const k of vars) { const v = app.game.T.get(k); const s = v && v.hash ? '[t]' : String(v); if (last[k] !== s) { console.log(i, k, '=', s); last[k] = s; } }
}

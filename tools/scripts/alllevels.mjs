import taps from './taps.mjs';
import fs from 'fs';
const START = 1500, PER = 330;
let levels = null;
const results = [];
export default async function (app, i) {
  await taps(app, i);
  const T = app.game.T;
  if (!levels) levels = [...app.res.fs.keys()].filter((k) => /^data\/Level\d+\.lua$/.test(k)).map((k) => k.slice(5, -4)).sort((a, b) => +a.slice(5) - +b.slice(5));
  if (i < START) return;
  const idx = Math.floor((i - START) / PER), off = (i - START) % PER;
  if (idx >= levels.length) { if (off === 0 && idx === levels.length) { console.log(JSON.stringify(results)); fs.writeFileSync(process.env.OUT || '/dev/null', JSON.stringify(results, null, 1)); } return; }
  const pigs = () => { let n = 0; const w = app.game.objectsTable.get('world'); for (const [k, v] of w.hash) if (v && v.hash && v.get('levelGoal') === true) n++; return n; };
  if (off === 0) {
    T.set('levelName', levels[idx]);
    app.vm.call(T.get('loadLevelInternal'), [levels[idx]]);
    results.push({ level: levels[idx], objects: app.game.objects.size, pigs0: null });
  }
  const r = results[results.length - 1];
  if (off === 30) r.pigs0 = pigs();
  if (off === PER - 1) { r.pigsEnd = pigs(); r.theme = app.game.themeImage; console.log(r.level, 'objects', r.objects, 'pigs', r.pigs0, '->', r.pigsEnd, r.theme); }
}

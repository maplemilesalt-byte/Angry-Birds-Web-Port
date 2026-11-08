import taps from './taps.mjs';
export default async function (app, i) {
  await taps(app, i);
  if (i === +(process.env.AT || 1700)) {
    const T = app.game.T, w = app.game.objectsTable.get('world');
    for (const k of (process.env.GLOBALS || 'levelStartPosition,slingshotX,slingshotY').split(',')) {
      const v = T.get(k); console.log(k, v && v.hash ? JSON.stringify(Object.fromEntries([...v.hash].filter(([a, b]) => typeof b !== 'object'))) : v);
    }
    for (const [n, o] of app.game.objects) if (/Bird|Pig|Sling|Shoot/.test(n)) console.log(n, o.x.toFixed(2), o.y.toFixed(2), o.body.getType());
  }
}

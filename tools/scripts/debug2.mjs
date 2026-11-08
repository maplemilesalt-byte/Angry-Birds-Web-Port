import dbg from './debug1.mjs';
export default async function (app, i) {
  await dbg(app, i);
  const w = app.game.objectsTable.get('world');
  const p = w && w.get(process.env.OBJ || 'SmallPiglette_7');
  if (p && i % (+process.env.EVERY || 10) === 0 && i > (+process.env.FROM || 1400)) {
    const o = app.game.objects.get(process.env.OBJ || 'SmallPiglette_7');
    console.log(i, 'x', p.get('x'), 'y', p.get('y'), 'frozen', p.get('frozen'), 'str', p.get('strength'), 'awake', o && o.body.isAwake(), 'v', o && o.body.getLinearVelocity().y);
  }
}

import go from './gotolevel.mjs';
export default async function (app, i) {
  await go(app, i);
  if (i === +process.env.DUMP_AT) {
    for (const [n, o] of app.game.objects) if (!/Piglette|Bird/.test(n)) console.log(n, o.body.getType(), 'sprite', o.sprite ? o.sprite.name : '-', 'tex', !!o.texture, o.x.toFixed(1), o.y.toFixed(1));
  }
}

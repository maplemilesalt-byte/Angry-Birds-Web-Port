import taps from './taps.mjs';
export default async function (app, i) {
  await taps(app, i);
  if (i === +(process.env.GOTO_AT || 1500)) { app.game.T.set('levelName', process.env.LEVEL); app.vm.call(app.game.T.get('loadLevelInternal'), [process.env.LEVEL]); }
  if (process.env.FORCE_AT && i === +process.env.FORCE_AT) globalThis.__forceRender = true;
}

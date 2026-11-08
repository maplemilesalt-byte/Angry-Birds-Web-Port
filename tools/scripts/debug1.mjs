import taps from './taps.mjs';
let hooked = false, frame = 0;
export default async function (app, i) {
  frame = i;
  const g = app.game;
  if (!hooked) {
    hooked = true;
    const T = g.T;
    const wrap = (name) => { const f = T.get(name); T.set(name, (...a) => { console.log(frame, name, ...a.map((x) => (typeof x === 'object' ? '[t]' : x))); return f(...a); }); };
    (process.env.WRAP || 'removeObject,loadLevel').split(',').forEach(wrap);
    const orig = g.call.bind(g);
    g.call = (name, ...a) => { if (name === 'blockCollision' || name === 'birdCollision') console.log(frame, name, ...a); return orig(name, ...a); };
  }
  await taps(app, i);
}

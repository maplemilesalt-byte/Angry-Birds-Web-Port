import taps from './taps.mjs';
const keys = new Set((process.env.KEYS || '').split(','));
const [a, b] = (process.env.RANGE || '0:0').split(':').map(Number);
let frame = 0, hooked = false;
export default async function (app, i) {
  frame = i;
  if (!hooked) { hooked = true; app.vm.onSetGlobal = (k, v, p, pc) => { if (frame >= a && frame <= b && keys.has(k)) console.log(frame, 'SET', k, '=', v && v.hash ? '[t]' : v, `@ line${p.lineDefined} pc${pc}`); }; }
  await taps(app, i);
}

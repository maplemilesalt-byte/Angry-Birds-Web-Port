import taps from './taps.mjs';
export default async function (app, i) {
  await taps(app, i);
  if (i === +process.env.AT) { console.log('storage keys:', [...localStorage._m.keys()]); for (const [k, v] of localStorage._m) console.log(k, v.slice(0, 300)); }
}

// Scripted input for headless runs. TAPS env: "frame:x:y,frame:x:y" ; DRAG env: "frame:x1:y1:x2:y2:len"
const taps = (process.env.TAPS || '').split(',').filter(Boolean).map((s) => s.split(':').map(Number));
const drags = (process.env.DRAG || '').split(',').filter(Boolean).map((s) => s.split(':').map(Number));
export default async function (app, i) {
  for (const [f, x, y] of taps) {
    if (i === f) { app.mouseMove(x, y); app.pressed = true; app.keyDown = true; app.touchCount = 1; }
    if (i === f + 2) { app.mouseMove(x, y); app.released = true; app.keyDown = false; app.touchCount = 0; }
  }
  for (const [f, x1, y1, x2, y2, len] of drags) {
    if (i === f) { app.mouseMove(x1, y1); app.pressed = true; app.keyDown = true; app.touchCount = 1; }
    if (i > f && i <= f + len) { const t = (i - f) / len; app.mouseMove(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t); }
    if (i === f + len + 3) { app.released = true; app.keyDown = false; app.touchCount = 0; }
  }
  if (process.env.SHOTS && process.env.SHOTS.split(',').map(Number).includes(i)) {
    const { savePng } = await import('../canvas-stub.mjs');
    savePng(app.canvas, `${process.env.SHOTDIR}/f${i}.png`);
  }
}

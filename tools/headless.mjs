// Headless runner: executes the port in Node with a stub canvas (for testing without a browser).
import fs from 'fs';
import { installCanvasStub, readPngSize } from './canvas-stub.mjs';
installCanvasStub();
const { GameApp, loadFileSystem, setStatusFn } = await import('../src/app.js');
setStatusFn((s) => s && console.log('[status]', s));
const ipa = process.argv[2] || 'Angry Birds 1.0.ipa';
const frames = +(process.argv[3] || 120);
const buf = fs.readFileSync(ipa);
const fsys = await loadFileSystem(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), async (bytes) => {
  const { createCanvasFromPng } = await import('./canvas-stub.mjs');
  return createCanvasFromPng(bytes);
});
const canvas = document.createElement('canvas');
const app = new GameApp(fsys, canvas, {});
globalThis.__app = app;
app.renderer.resize(+(process.env.K || 1));
const script = process.env.SCRIPT ? (await import(process.env.SCRIPT)).default : null;
for (let i = 0; i < frames; i++) {
  if (script) await script(app, i);
  app.step(1 / 30);
}
console.log('ran', frames, 'frames; draw calls last frame:', canvas.__stats ? canvas.__stats.calls : '?');
if (process.env.SHOT) { const { savePng } = await import('./canvas-stub.mjs'); savePng(canvas, process.env.SHOT); console.log('saved', process.env.SHOT); }

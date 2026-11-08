// Real-browser smoke test (Playwright/Chromium). Usage: node tools/browser-test.mjs <playwright-core dir> <outdir>
import { createRequire } from 'module'; import { spawn } from 'child_process'; import path from 'path';
const [,, pwDir, outDir] = process.argv;
const require = createRequire(path.join(pwDir, 'package.json'));
const { chromium } = require('playwright-core');
const server = spawn(process.execPath, ['tools/serve.mjs', '8799'], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:8799/');
try { await page.waitForFunction(() => document.body.classList.contains('running'), null, { timeout: 60000 }); } catch (e) { console.log('status:', await page.textContent('#status'), errors); await page.screenshot({ path: outDir + '/fail.png' }); process.exit(1); }
const box = await page.locator('#screen').boundingBox();
const at = (x, y) => [box.x + (x / 480) * box.width, box.y + (y / 320) * box.height];
const tap = async (x, y) => { const [px, py] = at(x, y); await page.mouse.move(px, py); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); };
const shot = (n) => page.screenshot({ path: `${outDir}/${n}.png` });
const waitT = (s) => page.waitForTimeout(s * 1000);
await waitT(6); await shot('b1_menu');
await tap(240, 180); await waitT(3); await shot('b2_levels');
await tap(33, 113);
const state = (k) => page.evaluate((k) => { const v = window.__app.game.T.get(k); return v && v.hash ? true : v; }, k);
for (let i = 0; i < 40 && !(await page.evaluate(() => window.__app.game.objects.size > 0)); i++) { await tap(240, 160); await waitT(1); }
await waitT(4); await shot('b3_level');
for (let i = 0; i < 10 && !(await state('birdReady')); i++) await waitT(1);
await tap(370, 247); await waitT(2); await tap(300, 100); await waitT(2);
for (let i = 0; i < 10 && !(await state('birdReady')); i++) await waitT(1);
await waitT(6);
const birdPos = () => page.evaluate(() => { const g = window.__app.game; const n = g.T.get('currentBirdName'); const o = g.objects.get(n); return o ? [(o.x * 20 - g.topLeftX) * g.worldScale, (o.y * 20 - g.topLeftY) * g.worldScale] : null; });
for (let k = 0; k < 6; k++) {
  const p = await birdPos(); if (!p || p[0] > 40) break;
  let [x0, y0] = at(60, 160); await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= 15; i++) { const [x, y] = at(60 + i * 25, 160); await page.mouse.move(x, y); await page.waitForTimeout(16); }
  await page.mouse.up(); await waitT(1.5);
}
const birdScreen = await page.evaluate(() => { const g = window.__app.game; const n = g.T.get('currentBirdName'); const o = g.objects.get(n); return o ? [(o.x * 20 - g.topLeftX) * g.worldScale, (o.y * 20 - g.topLeftY) * g.worldScale] : null; });
console.log('bird on screen at', birdScreen);
await shot('b4_ready');
// drag the bird
const [bx, by] = birdScreen; let [px, py] = at(bx, by); await page.mouse.move(px, py); await page.mouse.down();
for (let i = 1; i <= 20; i++) { const [x, y] = at(bx - i * 4, by + i * 2); await page.mouse.move(x, y); await page.waitForTimeout(16); }
await shot('b5_aim'); await page.mouse.up(); await waitT(1.2); await shot('b6_flight'); await waitT(4); await shot('b7_after');
const score = await page.evaluate(() => { const st = window.__app.game.T.get('scoreTable'); return st && st.get('blocks').get('score'); });
console.log('block score:', score);
const audio = await page.evaluate(() => { const r = window.__app.res; let ok = 0, n = 0; const missing = []; for (const [k, c] of r.clips) { n++; if (c.buffer) ok++; else missing.push(k); } return { n, ok, missing: missing.slice(0, 10), played: r.audio.nextId - 1, ctx: r.audio.ctx && r.audio.ctx.state }; });
console.log('audio:', JSON.stringify(audio));
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); server.kill();

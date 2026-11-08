// Browser check: jump to a level via the original loadLevelInternal and screenshot. node tools/browser-level.mjs <pwdir> <out.png> <LevelN>
import { createRequire } from 'module'; import { spawn } from 'child_process'; import path from 'path';
const [,, pwDir, out, level] = process.argv;
const { chromium } = createRequire(path.join(pwDir, 'package.json'))('playwright-core');
const server = spawn(process.execPath, ['tools/serve.mjs', '8798'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8798/');
await page.waitForFunction(() => document.body.classList.contains('running'), null, { timeout: 60000 });
await page.waitForTimeout(5000);
const box = await page.locator('#screen').boundingBox();
const tap = async (x, y) => { await page.mouse.move(box.x + x / 480 * box.width, box.y + y / 320 * box.height); await page.mouse.down(); await page.waitForTimeout(50); await page.mouse.up(); };
await tap(240, 180); await page.waitForTimeout(3000); await tap(33, 113); await page.waitForTimeout(3000);
for (let i = 0; i < 40 && !(await page.evaluate(() => window.__app.game.objects.size > 0)); i++) { await tap(33, 113); await page.waitForTimeout(1200); await tap(240, 160); await page.waitForTimeout(1200); }
await page.waitForTimeout(3000);
await page.evaluate((lv) => { const T = window.__app.game.T; T.set('levelName', lv); window.__app.vm.call(T.get('loadLevelInternal'), [lv]); }, level);
await page.waitForTimeout(900);
await page.screenshot({ path: out });
const perf = await page.evaluate(async () => { const app = window.__app; const orig = app.frame.bind(app); let n = 0, t = 0; app.frame = (dt) => { const a = performance.now(); orig(dt); t += performance.now() - a; n++; }; await new Promise((r) => setTimeout(r, 3000)); app.frame = orig; return { fps: n / 3, msPerFrame: t / n }; });
console.log('perf:', JSON.stringify(perf));
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); server.kill();

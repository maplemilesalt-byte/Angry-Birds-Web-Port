// Browser host for the Angry Birds 1.0 port: the equivalent of the native GameApp /
// framework::App / MyEAGLView layers. Loads the ORIGINAL IPA, runs the original Lua bytecode
// in the bundled Lua 5.1 VM and supplies the reimplemented native engine services.
import { ZipArchive } from './platform/zip.js';
import { LuaVM, LuaTable, LuaError, numberToString } from './lua/vm.js';
import { installStdlib } from './lua/stdlib.js';
import { Renderer } from './engine/renderer.js';
import { Resources, parseAnchor } from './engine/resources.js';
import { GameLua } from './engine/gamelua.js';
import { luaToJs, jsToLua } from './engine/datastream.js';

const SCREEN_W = 480, SCREEN_H = 320; // iPhone (2009) landscape framebuffer
const APP_PREFIX = 'Payload/AngryBirds.app/';

let setStatus = () => {};
export function setStatusFn(f) { setStatus = f; }

class Storage {
  constructor() { this.prefix = 'angrybirds10:'; }
  get(k) { try { return localStorage.getItem(this.prefix + k); } catch (e) { return null; } }
  set(k, v) { try { localStorage.setItem(this.prefix + k, v); } catch (e) { /* storage unavailable */ } }
}

export async function loadFileSystem(buffer, decodePng = defaultDecodePng) {
  const zip = new ZipArchive(buffer);
  const fs = new Map();
  const decoded = new Map();
  const names = zip.list().filter((n) => n.startsWith(APP_PREFIX) && !n.endsWith('/'));
  if (!names.length) throw new Error('This IPA does not contain Payload/AngryBirds.app');
  let done = 0;
  for (const n of names) {
    const rel = n.slice(APP_PREFIX.length);
    const bytes = await zip.read(n);
    fs.set(rel, bytes);
    if (rel.toLowerCase().endsWith('.png') && rel.startsWith('data/')) {
      decoded.set(rel, await decodePng(bytes));
    }
    if (++done % 40 === 0) setStatus(`Extracting original resources… ${done}/${names.length}`);
  }
  return { fs, decoded };
}

async function defaultDecodePng(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return c;
}

function num(v) { return typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) || 0 : 0); }
function str(v) { return typeof v === 'string' ? v : typeof v === 'number' ? numberToString(v) : ''; }

// game::LuaResources: the global `res` table
function installRes(vm, res) {
  const t = new LuaTable();
  const anchorArgs = (a, b) => { const an = { v: 4, h: 3 }; parseAnchor(an, a && luaToJs(a)); parseAnchor(an, b && luaToJs(b)); return an; };
  const f = (name, fn) => t.set(name, fn);
  f('setPath', () => []);
  f('createSpriteSheet', (p) => { res.createSpriteSheet(str(p)); return []; });
  f('releaseSpriteSheet', (p) => { res.releaseSpriteSheet(luaToJs(str(p)).replace(/^.*\//, '').replace(/\.dat$/i, '')); return []; });
  f('createBitmapFont', (p) => { res.createBitmapFont(str(p)); return []; });
  f('createSystemFont', () => []);
  f('createTextGroupSet', (p) => { res.createTextGroupSet(str(p)); return []; });
  f('createAudioOutput', () => { res.createAudioOutput(); return []; });
  f('createAudioInput', () => []);
  f('startAudioOutput', () => []);
  f('stopAudioOutput', () => []);
  f('startAudioInput', () => []);
  f('stopAudioInput', () => []);
  f('createAudio', (file, name) => { res.createAudio(str(file), str(name)); return []; });
  f('playAudio', (name, vol, loop, track) => {
    res.playAudio(str(name), vol === undefined ? 1 : num(vol), loop === undefined ? false : !!loop && loop !== false, track === undefined ? 0 : num(track) | 0);
    return [];
  });
  f('stopAudio', (name) => { res.stopAudio(str(name)); return []; });
  f('stopAllAudio', () => { res.stopAllAudio(); return []; });
  f('isAudioPlaying', (name) => [res.isAudioPlaying(str(name))]);
  f('setMasterVolume', (v) => { res.audio.setMasterVolume(num(v)); return []; });
  f('getMasterVolume', () => [res.audio.master]);
  f('setTrackVolume', (v, track) => { res.audio.setTrackVolume(num(v), num(track) | 0); return []; });
  f('loadLocale', () => []);
  f('useLocale', (l) => { res.useLocale(str(l)); return []; });
  f('useFont', (n) => { res.useFont(str(n)); return []; });
  f('getString', (set, key) => [jsToLua(res.getString(str(set), str(key)))]);
  f('getStringWidth', (s) => [res.getStringWidth(str(s))]);
  f('getFontLeading', () => [res.font ? res.font.leading : 0]);
  f('getFontTracking', () => [res.font ? res.font.tracking : 0]);
  f('getFontHeight', () => { if (!res.font) throw new LuaError('No font is set while trying to get font height!'); return [res.font.maxAsc + res.font.maxDesc]; });
  f('getFontMaxAscending', () => [res.font ? res.font.maxAsc : 0]);
  f('getFontMaxDescending', () => [res.font ? res.font.maxDesc : 0]);
  f('drawSprite', (sheet, sprite, x, y, a1, a2) => {
    const an = anchorArgs(a1, a2);
    const sh = str(sheet), sp = luaToJs(str(sprite));
    res.drawSprite(sh === '' ? null : luaToJs(sh), sp, num(x), num(y), an.v, an.h);
    return [];
  });
  f('drawString', (set, text, x, y, a1, a2) => {
    const an = anchorArgs(a1, a2);
    res.drawString(str(set), str(text), num(x), num(y), an.v, an.h);
    return [];
  });
  f('getSpriteBounds', (sheet, sprite) => {
    const sh = str(sheet);
    const s = res.getSprite(sh === '' ? null : luaToJs(sh), luaToJs(str(sprite)));
    return s ? [s.w, s.h] : [0, 0];
  });
  f('getSpritePivot', (sheet, sprite) => {
    const sh = str(sheet);
    const s = res.getSprite(sh === '' ? null : luaToJs(sh), luaToJs(str(sprite)));
    return s ? [s.px, s.py] : [0, 0];
  });
  f('openURL', (u) => { try { window.open(luaToJs(str(u)), '_blank', 'noopener'); } catch (e) { /* blocked */ } return []; });
  vm.G.set('res', t);
}

export class GameApp {
  constructor(fsys, canvas, win = window) {
    this.canvas = canvas;
    this.win = win;
    this.renderer = new Renderer(canvas, SCREEN_W, SCREEN_H);
    this.res = new Resources(fsys.fs, this.renderer);
    this.res.decoded = fsys.decoded;
    this.vm = new LuaVM();
    installStdlib(this.vm);
    installRes(this.vm, this.res);
    this.storage = new Storage();
    this.zoom = 1; this.zoomRef = 1;       // App +0x27c / +0x280
    this.touchCount = 0;
    this.keyDown = false; this.pressed = false; this.released = false;
    this.pointers = new Map();
    this.pinch = null;
    this.game = new GameLua(this.vm, this, this.res, this.renderer, this.storage);
    this.game.compile();
    this.game.createAssets();
    for (const tb of [this.game.keyPressed, this.game.keyReleased, this.game.keyHold]) tb.set('LBUTTON', false);
    const hs = this.game.T.get('highscores');
    if (hs instanceof LuaTable && typeof hs.get('volume') === 'number') this.res.audio.setMasterVolume(hs.get('volume'));
    if (win.addEventListener) {
      this.fit();
      win.addEventListener('resize', () => this.fit());
      this.bindInput();
    }
  }
  quit() { setStatus('The game requested exit.'); }

  fit() {
    const canvas = this.canvas;
    const k = Math.max(1, Math.min(window.innerWidth / SCREEN_W, window.innerHeight / SCREEN_H));
    const dpr = window.devicePixelRatio || 1;
    this.renderer.resize(k * dpr);
    canvas.style.width = `${SCREEN_W * k}px`;
    canvas.style.height = `${SCREEN_H * k}px`;
  }
  toScreen(e) {
    const canvas = this.canvas;
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SCREEN_W, ((e.clientY - r.top) / r.height) * SCREEN_H];
  }
  mouseMove(x, y) {
    this.game.cursor.set('x', Math.fround(x | 0));
    this.game.cursor.set('y', Math.fround(y | 0));
  }
  bindInput() {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.res.audio.resume();
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, this.toScreen(e));
      this.touchCount = this.pointers.size;
      if (this.pointers.size === 1) {
        this.primary = e.pointerId;
        const [x, y] = this.toScreen(e);
        this.mouseMove(x, y);
        if (!this.keyDown) { this.pressed = true; this.keyDown = true; }
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, this.toScreen(e));
      if (e.pointerId === this.primary) {
        const [x, y] = this.toScreen(e);
        this.mouseMove(x, y);
        if (!this.keyDown) { this.pressed = true; this.keyDown = true; }
      }
    });
    const up = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      this.touchCount = this.pointers.size;
      if (e.pointerId === this.primary) {
        this.primary = null;
        const [x, y] = this.toScreen(e);
        this.mouseMove(x, y);
        if (this.keyDown) { this.released = true; this.keyDown = false; }
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // GameApp::mouseWheel
      const ticks = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
      let z = this.zoom;
      const step = z >= 1 ? 0.05 : 0.025;
      this.zoomRef = z;
      if (ticks < 0 && !(z <= 0.01)) z += ticks * step;
      else if (ticks > 0 && z < 100) z += ticks * step;
      if (z < 0.01) z = 0.01; else if (z > 100) z = 100;
      this.zoom = z;
      this.game.cursor.set('wheel', ticks);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  frame(dt) {
    // two-finger pinch zoom (GameApp::update)
    if (this.pointers.size === 2) {
      const [a, b] = Array.from(this.pointers.values());
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (!this.pinch) this.pinch = { d0: d, s0: this.zoom };
      this.zoom = (d / this.pinch.d0) * this.pinch.s0;
    } else this.pinch = null;
    const g = this.game;
    g.keyPressed.set('LBUTTON', this.pressed);
    g.keyReleased.set('LBUTTON', this.released);
    g.keyHold.set('LBUTTON', this.keyDown);
    this.pressed = false; this.released = false;
    this.renderer.getRenderState2D().reset();
    this.renderer.clear(g.bgColor);
    g.update(dt);
  }

  step(dt) {
    this.frame(Math.fround(dt));
  }

  run() {
    let last = performance.now();
    const tick = (now) => {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      try {
        this.frame(Math.fround(dt));
      } catch (e) {
        console.error(e, e.luaTraceback);
        setStatus('Runtime error: ' + (e && e.message) + (e && e.luaTraceback ? '\n' + e.luaTraceback.join('\n') : ''));
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

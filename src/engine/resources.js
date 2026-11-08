// Port of game::Resources / game::LuaResources from the original executable.
// File formats (recovered from SpriteSheet::SpriteSheet, BitmapFont::BitmapFont,
// TextGroupSet::loadLocaleCodes/loadTextGroup):
//   sprite sheet .dat : UTF imageFile, u16 count, { UTF name, s16 x,y,w,h,pivotX,pivotY }
//   bitmap font  .dat : UTF imageFile, s16 leading, s16 tracking, s16 count,
//                       { u16 char, s16 x,y,w,h,pivotY }
//   text group   .dat : u8, s32, u8 nLang, UTF[nLang] codes, u16 nKeys, UTF[nKeys] keys,
//                       s32[nLang] offsets, then per language UTF[nKeys] strings
import { DataInput, luaToJs, jsToLua } from './datastream.js';
import { Image2D } from './renderer.js';
import { decodePVR } from '../platform/pvr.js';

export const VANCHOR = { TOP: 0, VCENTER: 1, BOTTOM: 2, BASELINE: 3, VPIVOT: 4 };
export const HANCHOR = { LEFT: 0, HCENTER: 1, RIGHT: 2, HPIVOT: 3 };

// Anchor::fromString — one anchor string can set either the vertical or horizontal part.
export function parseAnchor(anchor, s) {
  if (s === undefined || s === null || s === '') return;
  if (s in VANCHOR) anchor.v = VANCHOR[s];
  else if (s in HANCHOR) anchor.h = HANCHOR[s];
  else throw new Error('Invalid anchor: ' + s);
}

export class Sprite {
  constructor(sheet, name, x, y, w, h, px, py) {
    Object.assign(this, { sheet, name, x, y, w, h, px, py });
  }
  // game::SpriteSheet::drawSprite anchor arithmetic
  draw(r, x, y, v = VANCHOR.VPIVOT, h = HANCHOR.HPIVOT) {
    if (v === 1) y -= this.h >> 1;
    else if (v === 2) y -= this.h;
    else if (v === 4) y -= this.py;
    if (h === 1) x -= this.w >> 1;
    else if (h === 2) x -= this.w;
    else if (h === 3) x -= this.px;
    r.drawImage(this.sheet.image, x, y, this.x, this.y, this.w, this.h);
  }
}

export class SpriteSheet {
  constructor(name, image) {
    this.name = name;
    this.image = image;
    this.sprites = new Map();
  }
  createSprite(name, x, y, w, h, px, py) {
    const s = new Sprite(this, name, x, y, w, h, px, py);
    this.sprites.set(name, s);
    return s;
  }
  getSprite(name) { return this.sprites.get(name); }
}

export class BitmapFont {
  constructor(res, path) {
    const d = new DataInput(res.file(path));
    const imageFile = d.utf();
    this.sheet = new SpriteSheet(path, res.image(res.sibling(path, imageFile)));
    this.leading = d.short();
    this.tracking = d.short();
    const n = d.short();
    this.glyphs = new Map();
    this.maxAsc = 0; this.maxDesc = 0;
    for (let i = 0; i < n; i++) {
      const ch = d.ushort();
      const x = d.short(), y = d.short(), w = d.short(), h = d.short(), py = d.short();
      if (py > this.maxAsc) this.maxAsc = py;
      if (h - py > this.maxDesc) this.maxDesc = h - py;
      this.glyphs.set(ch, this.sheet.createSprite(String(ch), x, y, w, h, 0, py));
    }
  }
  getStringWidth(str) {
    let w = 0, n = 0;
    for (const ch of str) {
      const g = this.glyphs.get(ch.codePointAt(0));
      if (g) w += g.w;
      n++;
    }
    return n ? w + this.tracking * (n - 1) : 0;
  }
  // game::BitmapFont::drawString(ctx, chars, x, y, vAnchor, hAnchor)
  drawString(r, str, x, y, v, h) {
    if (v === 0) y += this.maxAsc;
    else if (v === 1) y += this.maxAsc - ((this.maxAsc + this.maxDesc) >> 1);
    else if (v === 2) y -= this.maxDesc;
    if (h === 1) x -= this.getStringWidth(str) >> 1;
    else if (h === 2) x -= this.getStringWidth(str);
    const chars = Array.from(str);
    for (let i = 0; i < chars.length; i++) {
      const g = this.glyphs.get(chars[i].codePointAt(0));
      if (!g) throw new Error('Trying to draw character not present in font: ' + chars[i].codePointAt(0));
      g.draw(r, x, y, VANCHOR.VPIVOT, HANCHOR.HPIVOT);
      if (i !== chars.length - 1) x += this.tracking + g.w;
    }
  }
}

export class TextGroupSet {
  constructor(bytes) {
    const d = new DataInput(bytes);
    d.byte(); d.int();
    const nl = d.byte();
    this.langs = [];
    for (let i = 0; i < nl; i++) this.langs.push(d.utf());
    const nk = d.ushort();
    this.keys = [];
    for (let i = 0; i < nk; i++) this.keys.push(d.utf());
    for (let i = 0; i < nl; i++) d.int();
    this.groups = new Map();
    for (const lang of this.langs) {
      const g = new Map();
      for (const k of this.keys) g.set(k, d.utf());
      this.groups.set(lang, g);
    }
  }
}

// ---- audio (audio::AudioOutput equivalent on WebAudio) ----
class AudioOutput {
  constructor() {
    this.ctx = null;
    this.master = 1;
    this.trackVolume = new Map();
    this.clipCountLimit = new Map();
    this.playing = []; // {id, name, track, src, gain}
    this.nextId = 1;
    this.buffers = new Map();
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
      this.out.gain.value = this.master;
    }
    return this.ctx;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMasterVolume(v) { this.master = v; if (this.out) this.out.gain.value = v; }
  setTrackVolume(v, track) {
    this.trackVolume.set(track, v);
    for (const p of this.playing) if (p.track === track) p.gain.gain.value = p.vol * v;
  }
  play(clip, name, vol, loop, track) {
    const ctx = this.ensure();
    if (!ctx || !clip.buffer) return -1;
    const limit = this.clipCountLimit.get(track);
    if (limit !== undefined) {
      const same = this.playing.filter((p) => p.track === track);
      if (same.length >= limit) this.stopId(same[0].id); // drop oldest
    }
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.loop = !!loop;
    const gain = ctx.createGain();
    const tv = this.trackVolume.has(track) ? this.trackVolume.get(track) : 1;
    gain.gain.value = vol * tv;
    src.connect(gain); gain.connect(this.out);
    const id = this.nextId++;
    const entry = { id, name, track, src, gain, vol };
    src.onended = () => { const i = this.playing.indexOf(entry); if (i >= 0) this.playing.splice(i, 1); };
    this.playing.push(entry);
    src.start();
    return id;
  }
  stopId(id) {
    const i = this.playing.findIndex((p) => p.id === id);
    if (i >= 0) { const p = this.playing[i]; this.playing.splice(i, 1); try { p.src.stop(); } catch (e) { /* already stopped */ } }
  }
  stopName(name) { for (const p of this.playing.slice()) if (p.name === name) this.stopId(p.id); }
  stopAll() { for (const p of this.playing.slice()) this.stopId(p.id); }
  isPlaying(name) { return this.playing.some((p) => p.name === name); }
  setClipVolume(id, v) {
    const p = this.playing.find((q) => q.id === id);
    if (p) { p.vol = v; p.gain.gain.value = v * (this.trackVolume.has(p.track) ? this.trackVolume.get(p.track) : 1); }
  }
}

export class Resources {
  constructor(fs, renderer) {
    this.fs = fs;           // Map path -> Uint8Array  (files from the IPA's AngryBirds.app/)
    this.r = renderer;
    this.path = 'data/';
    this.sheets = new Map();      // sheet name -> SpriteSheet
    this.spriteIndex = new Map(); // sprite name -> SpriteSheet
    this.images = new Map();      // decoded images cache (path -> Image2D)
    this.fonts = new Map();
    this.font = null;
    this.textSets = new Map();
    this.locale = 'en_EN';
    this.audio = new AudioOutput();
    this.clips = new Map();
  }

  file(path) {
    const f = this.fs.get(path) || this.fs.get(this.path + path);
    if (!f) throw new Error('File not found: ' + path);
    return f;
  }
  hasFile(path) { return this.fs.has(path) || this.fs.has(this.path + path); }
  sibling(path, name) {
    const full = this.fs.has(path) ? path : this.path + path;
    const i = full.lastIndexOf('/');
    return (i >= 0 ? full.slice(0, i + 1) : '') + name;
  }
  image(path) {
    let img = this.images.get(path);
    if (img) return img;
    const pre = this.decoded && this.decoded.get(path);
    if (pre) { img = new Image2D(pre); this.images.set(path, img); return img; }
    if (path.toLowerCase().endsWith('.pvr')) {
      const t = decodePVR(this.file(path));
      const c = document.createElement('canvas');
      c.width = t.width; c.height = t.height;
      c.getContext('2d').putImageData(new ImageData(t.rgba, t.width, t.height), 0, 0);
      img = new Image2D(c);
      this.images.set(path, img);
      return img;
    }
    throw new Error('Image not preloaded: ' + path);
  }

  // ---- sprite sheets ----
  createSpriteSheet(path) {
    path = luaToJs(path);
    const d = new DataInput(this.file(path));
    const imageFile = d.utf();
    const name = path.replace(/^.*\//, '').replace(/\.dat$/i, '');
    const sheet = new SpriteSheet(name, this.image(this.sibling(path, imageFile)));
    const n = d.ushort();
    for (let i = 0; i < n; i++) {
      const sn = d.utf();
      const x = d.short(), y = d.short(), w = d.short(), h = d.short(), px = d.short(), py = d.short();
      sheet.createSprite(sn, x, y, w, h, px, py);
      if (!this.spriteIndex.has(sn)) this.spriteIndex.set(sn, sheet);
    }
    this.sheets.set(name, sheet);
    return sheet;
  }
  releaseSpriteSheet(name) {
    const s = this.sheets.get(name);
    if (!s) return;
    this.sheets.delete(name);
    for (const [k, v] of this.spriteIndex) if (v === s) this.spriteIndex.delete(k);
  }
  getSpriteSheet(name) { return this.sheets.get(name); }
  findSheet(spriteName) { return this.spriteIndex.get(spriteName); }
  getSprite(sheetName, spriteName) {
    const sheet = sheetName ? this.sheets.get(sheetName) : this.findSheet(spriteName);
    return sheet ? sheet.getSprite(spriteName) : undefined;
  }
  drawSprite(sheetName, spriteName, x, y, v = 4, h = 3) {
    const s = this.getSprite(sheetName, spriteName);
    if (s) s.draw(this.r, x, y, v, h);
  }

  // ---- fonts & text ----
  createBitmapFont(path) {
    path = luaToJs(path);
    const name = path.replace(/^.*\//, '').replace(/\.dat$/i, '');
    this.fonts.set(name, new BitmapFont(this, path));
  }
  useFont(name) {
    // game::Resources::useFont: unknown names leave the current font unchanged
    const f = this.fonts.get(luaToJs(name));
    if (f) this.font = f;
  }
  createTextGroupSet(path) {
    path = luaToJs(path);
    const name = path.replace(/^.*\//, '').replace(/\.dat$/i, '');
    this.textSets.set(name, new TextGroupSet(this.file(path)));
  }
  loadLocale(/* set, lang */) { /* all languages are resident in TextGroupSet */ }
  useLocale(lang) { this.locale = luaToJs(lang); }
  getString(setName, key) {
    const set = this.textSets.get(luaToJs(setName));
    if (!set) return luaToJs(key);
    const g = set.groups.get(this.locale) || set.groups.get(set.langs[0]);
    const k = luaToJs(key);
    return g.has(k) ? g.get(k) : k;
  }
  drawString(setName, key, x, y, v = 4, h = 3) {
    if (!this.font) throw new Error('No font is set while trying to draw string');
    this.font.drawString(this.r, this.getString(setName, key), x, y, v, h);
  }
  getStringWidth(str) { return this.font ? this.font.getStringWidth(luaToJs(str)) : 0; }

  // ---- audio ----
  createAudioOutput() { this.audio.ensure(); }
  createAudio(file, name) {
    file = luaToJs(file); name = luaToJs(name);
    const clip = { name, buffer: null };
    this.clips.set(name, clip);
    const bytes = this.file(file);
    const ctx = this.audio.ensure();
    if (ctx) {
      const copy = bytes.slice().buffer;
      ctx.decodeAudioData(copy).then((b) => { clip.buffer = b; }, () => { /* undecodable */ });
    }
  }
  playAudio(name, vol = 1, loop = false, track = 0) {
    name = luaToJs(name);
    const clip = this.clips.get(name);
    if (!clip) return -1;
    return this.audio.play(clip, name, vol, loop, track);
  }
  stopAudio(name) { this.audio.stopName(luaToJs(name)); }
  stopAllAudio() { this.audio.stopAll(); }
  isAudioPlaying(name) { return this.audio.isPlaying(luaToJs(name)); }
}

export { jsToLua };

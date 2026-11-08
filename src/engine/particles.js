// Port of the native Particles class (Particles::addParticles / update / draw).
// Particle systems are defined by the original particles.lua (particleTable.particles).
import { LuaTable } from '../lua/vm.js';
import { luaToJs } from './datastream.js';

const fr = Math.fround;

export class Particles {
  constructor(vm, game, res) {
    this.vm = vm;
    this.game = game;
    this.res = res;
    this.list = [];
    this.systems = new Map();
    this.rand = Math.random; // math::RandomUtil::random
    const t = new LuaTable();
    t.set('_G', vm.G);
    t.set('this', t);
    t.set('addParticles', (name, count, x, y, w, h /* , angle */) => {
      this.addParticles(luaToJs(String(name ?? '')), num(count), num(x), num(y), num(w), num(h));
      return [];
    });
    vm.G.set('particles', t);
  }

  clearAll() { this.list.length = 0; }

  _system(name) {
    let s = this.systems.get(name);
    if (s) return s;
    const pt = this.game.T.get('particleTable');
    const def = pt instanceof LuaTable ? pt.get('particles') : undefined;
    const d = def instanceof LuaTable ? def.get(name) : undefined;
    if (!(d instanceof LuaTable)) return null;
    const n = (k) => num(d.get(k));
    s = {
      name,
      gravityX: n('gravityX'), gravityY: n('gravityY'),
      minVel: n('minVel'), maxVel: n('maxVel'),
      minAngleVel: n('minAngleVel'), maxAngleVel: n('maxAngleVel'),
      minScaleBegin: n('minScaleBegin'), maxScaleBegin: n('maxScaleBegin'),
      minScaleEnd: n('minScaleEnd'), maxScaleEnd: n('maxScaleEnd'),
      lifeTime: n('lifeTime'),
      sheet: luaToJs(d.get('sheet') ?? ''),
      animated: d.get('animation') === 'lifeTime',
      sprites: [],
    };
    const sp = d.get('sprites');
    if (sp instanceof LuaTable) for (let i = 1; i <= sp.length(); i++) s.sprites.push(luaToJs(sp.get(i)));
    this.systems.set(name, s);
    return s;
  }

  addParticles(name, count, x, y, w, h) {
    const cur = this.list.length;
    if (cur + count > 40) count *= 0.5;
    if (!(cur + count < 125)) count = 125 - cur;
    if (!(count > 0)) return;
    const s = this._system(name);
    if (!s) return;
    const rnd = this.rand;
    const sheet = this.res.getSpriteSheet(s.sheet);
    for (let i = 0; i < count; i++) {
      const p = {
        x: fr(x + (rnd() - 0.5) * w),
        y: fr(y + (rnd() - 0.5) * h),
        vx: s.minVel + (s.maxVel - s.minVel) * rnd(),
        vy: s.minVel + (s.maxVel - s.minVel) * rnd(),
        angle: 0,
        angVel: 0, scaleBegin: 0, scaleEnd: 0, scale: 0, sprite: null,
        time: 0, lifeTime: s.lifeTime, frame: 0, sys: s, animated: s.animated,
      };
      const ra = rnd(); p.angle = ra * Math.PI + ra * Math.PI;
      p.angVel = s.minAngleVel + (s.maxAngleVel - s.minAngleVel) * rnd();
      p.scaleBegin = s.minScaleBegin + (s.maxScaleBegin - s.minScaleBegin) * rnd();
      p.scaleEnd = s.minScaleEnd + (s.maxScaleEnd - s.minScaleEnd) * rnd();
      p.scale = p.scaleBegin;
      const spriteName = s.animated ? s.sprites[0] : s.sprites[(rnd() * s.sprites.length) | 0];
      p.sprite = sheet ? sheet.getSprite(spriteName) : null;
      this.list.push(p);
    }
  }

  update(dt) {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.time += dt;
      if (!(p.time < p.lifeTime)) { L.splice(i, 1); i--; continue; }
      const s = p.sys;
      p.vy += dt * s.gravityY;
      p.vx += dt * s.gravityX;
      const t = p.time / p.lifeTime;
      p.x += dt * p.vx;
      p.y += dt * p.vy;
      p.angle += dt * p.angVel;
      p.scale = p.scaleBegin + (p.scaleEnd - p.scaleBegin) * t;
      if (!p.animated) continue;
      const n = s.sprites.length;
      let f = Math.ceil(n * t);
      if (f < 1) f = 1;
      if (f > n) f = n;
      if (f !== p.frame) {
        const sheet = this.res.getSpriteSheet(s.sheet);
        p.sprite = sheet ? sheet.getSprite(s.sprites[f - 1]) : null;
        p.frame = f;
      }
    }
  }

  draw(r) {
    const rs = r.getRenderState2D();
    const g = this.game;
    for (const p of this.list) {
      if (!p.sprite) continue;
      rs.tx = -g.topLeftX / p.scale;
      rs.ty = -g.topLeftY / p.scale;
      rs.sx = rs.sy = g.worldScale * p.scale;
      rs.c = Math.cos(p.angle); rs.s = Math.sin(p.angle);
      rs.px = p.sprite.px; rs.py = p.sprite.py;
      p.sprite.draw(r, p.x / p.scale, p.y / p.scale, 4, 3);
    }
  }
}

function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  return 0;
}

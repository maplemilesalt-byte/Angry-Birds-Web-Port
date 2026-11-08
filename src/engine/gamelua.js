// Port of the native GameLua class of Angry Birds 1.0 (iOS).
// Every function here reproduces the behaviour recovered from the shipped ARM binary
// (Ghidra pseudocode + assembly, see docs/REVERSE_ENGINEERING.md). The game logic itself
// is NOT reimplemented: it runs from the original gamelogic.lua bytecode in the Lua VM.
import * as planck from '../../vendor/planck.mjs';
import { LuaTable, LuaFunction, numberToString, truthy } from '../lua/vm.js';
import { luaToJs, jsToLua } from './datastream.js';
import { Particles } from './particles.js';
import { parseAnchor } from './resources.js';

const fr = Math.fround;
const STEP = fr(1 / 30);          // b2World::Step(0.033333335f, 10, 10)
const PHYSICS_TO_WORLD = 20;      // hard-coded 20.0f in GameLua::drawGame

// Box2D 2.1 configuration of the shipped build (b2Settings recovered from constants in
// b2ContactSolver / b2Island): linearSlop 0.05 (polygonRadius 0.1), linear sleep tolerance 0.1,
// angular sleep tolerance 2 deg, time to sleep 0.25 s.
planck.Settings.linearSlop = 0.05;
planck.Settings.linearSleepTolerance = 0.1;
planck.Settings.angularSleepTolerance = (2 / 180) * Math.PI;
planck.Settings.timeToSleep = 0.25;
planck.Settings.maxTranslation = 2.0;
planck.Settings.maxRotation = 0.5 * Math.PI;
planck.Settings.baumgarte = 0.2;
planck.Settings.maxLinearCorrection = 0.2;

function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? 0 : fr(n); }
  return 0;
}
function str(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return numberToString(v);
  return '';
}
function bool(v) { return truthy(v); }

export class GameLua {
  constructor(vm, app, res, renderer, storage) {
    this.vm = vm;
    this.app = app;
    this.res = res;
    this.r = renderer;
    this.storage = storage;

    // LuaObject: own table with _G and this (lua::LuaObject::LuaObject)
    const T = new LuaTable();
    T.set('_G', vm.G);
    T.set('this', T);
    this.T = T;

    this.keyPressed = new LuaTable();
    this.keyReleased = new LuaTable();
    this.keyHold = new LuaTable();
    this.cursor = new LuaTable();
    this.clippedText = new LuaTable();
    this.objectsTable = new LuaTable();

    this.bgColor = 0;               // +0x6c
    this.themeColor = [0, 0, 0];    // +0x74
    this.groundColor = [0, 0, 0];   // +0x80
    this.themeImage = '';           // +0x8c
    this.themeSheet = '';           // +0x90 "INGAME_%d" (index + 2)
    this.commonSheet = 'INGAME_2';  // +0x94
    this.layers = [];               // +0x98
    this.rollingClip = { wood: -1, rock: -1, light: -1 };
    this.objects = new Map();       // Hashtable<String, RenderObjectData>
    this.joints = [];               // Array<jointData>
    this.physicsScale = 1;          // +0x168
    this.physicsEnabled = true;     // +0x16c
    this.loading = false;           // +0x16d
    this.editing = false;           // +0x16e
    this.topLeftX = 0; this.topLeftY = 0; // +0x170
    this.accumulator = 0;           // +0x178
    this.worldScale = 1;            // +0x17c
    this.trajectories = [[], [], [], [], [], []]; // +0x180 (6 arrays)
    this.trajIndex = 0;             // +0x1c8
    this.levelLeft = 0; this.levelRight = 0; // +0x1d0 / +0x1d4
    this.pendingDestroy = [];

    const reg = (name, fn) => T.set(name, (...a) => { fn.apply(this, a); return []; });
    reg('requestExit', () => this.app.quit());
    reg('print', (s) => console.log('[lua]', luaToJs(str(s))));
    reg('compile', () => this.compile());
    reg('setBGColor', (r, g, b) => this.setBGColor(num(r), num(g), num(b)));
    reg('createBox', (n, s, x, y, w, h, d, f, re, c, ctl) => this.createBoxLua(str(n), str(s), num(x), num(y), num(w), num(h), num(d), num(f), num(re), bool(c), bool(ctl)));
    // createCircleLua(String name, String sprite, float x, y, radius, density, friction, restitution, bool controllable)
    reg('createCircle', (n, s, x, y, rad, d, f, re, ctl) => this.createCircleLua(str(n), str(s), num(x), num(y), num(rad), num(d), num(f), num(re), true, bool(ctl)));
    reg('createJoint', (n, a, b, t) => this.createJointLua(str(n), str(a), str(b), num(t)));
    reg('destroyJoint', (n) => this.destroyJointLua(str(n)));
    reg('applyImpulse', (n, ix, iy, px, py) => this.applyImpulse(str(n), num(ix), num(iy), num(px), num(py)));
    reg('applyForce', (n, ix, iy, px, py) => this.applyForce(str(n), num(ix), num(iy), num(px), num(py)));
    reg('setPosition', (n, x, y) => this.setPosition(str(n), num(x), num(y)));
    reg('setRotation', (n, a) => this.setRotation(str(n), num(a)));
    reg('setVelocity', (n, x, y) => this.setVelocity(str(n), num(x), num(y)));
    reg('setAngularVelocity', (n, w) => this.setAngularVelocity(str(n), num(w)));
    reg('setPhysicsSimulationScale', (s) => { this.physicsScale = num(s); });
    reg('setPhysicsEnabled', (b) => { this.physicsEnabled = bool(b); });
    reg('setTopLeft', (x, y) => { this.topLeftX = num(x); this.topLeftY = num(y); });
    reg('removeObject', (n) => this.removeObject(str(n)));
    reg('setEditing', (b) => { this.editing = bool(b); });
    reg('setWorldScale', (s) => { this.worldScale = num(s); this.app.zoom = this.worldScale; this.app.zoomRef = this.worldScale; });
    reg('drawRect', (r, g, b, a, x1, y1, x2, y2, keep) => this.drawRect(num(r), num(g), num(b), num(a), num(x1), num(y1), num(x2), num(y2), bool(keep)));
    reg('drawTexturedRect', (s, x1, y1, x2, y2) => this.drawTexturedRect(str(s), num(x1), num(y1), num(x2), num(y2)));
    T.set('setRenderState', (...a) => { this.setRenderState(a); return []; });
    reg('loadLevel', (n) => this.loadLevel(str(n)));
    reg('saveLevel', () => { /* level editor output: not part of the shipped game flow */ });
    reg('saveLuaFile', (p, t, appData) => this.saveLuaFile(str(p), str(t), bool(appData)));
    reg('createDirectory', () => {});
    reg('drawGameNative', () => this.drawGame());
    reg('drawBackgroundNative', () => this.drawBackground());
    reg('drawParticlesNative', () => this.particles.draw(this.r));
    reg('setSprite', (n, s) => this.setSprite(str(n), str(s)));
    reg('setMaterial', (n, m) => this.setMaterial(str(n), str(m)));
    reg('setTexture', (n, t) => this.setTexture(str(n), str(t)));
    reg('setTheme', (t) => this.setTheme(str(t)));
    reg('setSleeping', (n, b) => this.setSleeping(str(n), bool(b)));
    reg('drawLine2D', (x1, y1, x2, y2, w, r, g, b, a) => this.drawLine(num(x1), num(y1), num(x2), num(y2), num(w), num(r), num(g), num(b), num(a)));
    reg('drawForegroundNative', () => this.drawForeground());
    reg('setObjectParameter', (n, p, v) => this.setObjectParameter(str(n), num(p), num(v)));
    reg('clipText', (set, key, w) => this.clipText(str(set), str(key), num(w)));
    reg('startNewTrajectory', () => this.startNewTrajectory());
    reg('addToTrajectory', (i, x, y) => this.addToTrajectory(num(i), num(x), num(y)));
    reg('setLevelLimits', (l, t, r) => { this.levelLeft = num(l) | 0; this.levelRight = num(r) | 0; });
    reg('goToTaskSwitcherLua', () => {});

    T.set('screenWidth', renderer.width);
    T.set('screenHeight', renderer.height);
    T.set('keyPressed', this.keyPressed);
    T.set('keyReleased', this.keyReleased);
    T.set('keyHold', this.keyHold);
    T.set('cursor', this.cursor);
    T.set('clippedText', this.clippedText);
    T.set('objects', this.objectsTable);

    this.world = new planck.World({ gravity: planck.Vec2(0, 20) });
    this.world.on('begin-contact', (c) => this.beginContact(c));

    T.set('highscores', this.readAppData('highscores.lua'));
    T.set('settings', this.readAppData('settings.lua'));
    this.loadLuaFile('starLimits.lua', 'starTable');

    this.particles = new Particles(vm, this, res);
  }

  // ---------------- Lua plumbing ----------------
  call(name, ...args) {
    const f = this.T.get(name);
    if (f === undefined) return [];
    return this.vm.call(f, args);
  }
  runChunk(path, env) {
    const bytes = this.res.file(path);
    const fn = this.vm.load(bytes, path.replace(/^.*\//, ''));
    fn.env = env;
    this.vm.call(fn, []);
  }
  loadLuaFile(path, key) {
    const t = new LuaTable();
    this.runChunk(path, t);
    this.T.set(key, t);
  }
  compile() {
    this.runChunk('gamelogic.lua', this.T);
    this.call('updateValues');
  }
  createAssets() {
    this.call('createStartUpAssets');
    const a = this.res.audio;
    a.clipCountLimit.set(1, 4);
    a.clipCountLimit.set(2, 6);
    a.clipCountLimit.set(3, 3);
  }
  readAppData(path) {
    // AppDataInputStream + LuaTable::read; persisted in browser storage.
    const json = this.storage.get(path);
    return json ? jsonToLua(JSON.parse(json)) : new LuaTable();
  }
  saveLuaFile(path, tableName, _appData) {
    const t = this.T.get(tableName);
    if (t instanceof LuaTable) this.storage.set(path, JSON.stringify(luaToJson(t)));
  }

  setBGColor(r, g, b) {
    const c = (v, sh) => (v < 0 ? 0 : v <= 255 ? (v | 0) << sh : 255 << sh);
    this.bgColor = c(r, 16) | c(g, 8) | c(b, 0);
  }

  // ---------------- physics objects ----------------
  _objTable() {
    let w = this.objectsTable.get('world');
    if (!(w instanceof LuaTable)) { w = new LuaTable(); this.objectsTable.set('world', w); }
    return w;
  }
  _bodyDef(x, y, density) {
    return {
      type: density !== 0 ? 'dynamic' : 'static',
      position: planck.Vec2(x, y), angle: 0,
      linearDamping: 0, angularDamping: 1.0, allowSleep: true, awake: true,
      fixedRotation: false, bullet: false,
    };
  }
  createBox(name, x, y, hw, hh, density, friction, restitution, collision) {
    const body = this.world.createBody(this._bodyDef(x, y, density));
    body.createFixture(planck.Box(hw, hh), {
      density, friction, restitution,
      filterCategoryBits: 1, filterMaskBits: collision ? 0xffff : 0, filterGroupIndex: 0,
    });
    return body;
  }
  createCircle(name, x, y, radius, density, friction, restitution, collision) {
    const body = this.world.createBody(this._bodyDef(x, y, density));
    body.createFixture(planck.Circle(radius), {
      density, friction, restitution,
      filterCategoryBits: 1, filterMaskBits: collision ? 0xffff : 0, filterGroupIndex: 0,
    });
    return body;
  }
  _register(name, sprite, body, x, y, table, controllable, rolling, radius) {
    if (this.objects.has(name)) this._destroyBody(this.objects.get(name).body);
    const o = {
      name, table, body,
      sprite: sprite ? this.res.getSprite(null, sprite) : undefined,
      texture: null,
      states: [{ x, y, a: 0 }, { x, y, a: 0 }],
      x, y, angle: 0,
      radius, controllable, rolling, flag52: false, material: 0,
      staticAwake: true,
    };
    body.setUserData(o);
    this.objects.set(name, o);
    return o;
  }
  _newObjTable(name, sprite, type, x, y) {
    const t = new LuaTable();
    t.set('name', jsToLuaKeep(name));
    t.set('sprite', jsToLuaKeep(sprite));
    t.set('type', type);
    t.set('x', x); t.set('y', y);
    return t;
  }
  createBoxLua(name, sprite, x, y, w, h, density, friction, restitution, collision, controllable) {
    const body = this.createBox(name, x, y, w, h, density, friction, restitution, collision);
    const t = this._newObjTable(name, sprite, 'box', x, y);
    t.set('width', w); t.set('height', h); t.set('angle', 0);
    t.set('density', density); t.set('friction', friction); t.set('restitution', restitution);
    t.set('mass', fr(body.getMass())); t.set('xVel', 0); t.set('yVel', 0);
    this._objTable().set(name, t);
    this._register(name, sprite, body, x, y, t, controllable, false, 0);
  }
  createCircleLua(name, sprite, x, y, radius, density, friction, restitution, collision, controllable) {
    const body = this.createCircle(name, x, y, radius, density, friction, restitution, collision);
    const t = this._newObjTable(name, sprite, 'circle', x, y);
    t.set('radius', radius); t.set('angle', 0);
    t.set('density', density); t.set('friction', friction); t.set('restitution', restitution);
    t.set('mass', fr(body.getMass())); t.set('xVel', 0); t.set('yVel', 0);
    t.set('sphere', true);
    this._objTable().set(name, t);
    this._register(name, sprite, body, x, y, t, controllable, true, radius);
  }
  _destroyBody(body) {
    if (!body) return;
    body.setUserData(null);
    if (this.world.isLocked()) this.pendingDestroy.push(body);
    else this.world.destroyBody(body);
  }
  removeObject(name) {
    const o = this.objects.get(name);
    if (o) {
      this._destroyBody(o.body);
      this.objects.delete(name);
    }
    for (let i = this.joints.length - 1; i >= 0; i--) {
      const j = this.joints[i];
      if (j.end1 === name || j.end2 === name) {
        const jt = this.objectsTable.get('joints');
        if (jt instanceof LuaTable) jt.set(j.name, undefined);
        if (j.joint && !o) this.world.destroyJoint(j.joint);
        this.joints.splice(i, 1);
      }
    }
  }
  createJointLua(name, end1, end2, type) {
    const t = new LuaTable();
    t.set('name', name); t.set('end1', end1); t.set('end2', end2); t.set('type', type);
    const a = this.objects.get(end1), b = this.objects.get(end2);
    let joint = null;
    if (type === 1 && a && b) {
      const pa = a.body.getPosition(), pb = b.body.getPosition();
      joint = this.world.createJoint(planck.DistanceJoint({ frequencyHz: 4, dampingRatio: 0.5 }, a.body, b.body, pa, pb));
      t.set('x1', pa.x); t.set('x2', pb.x); t.set('y1', pa.y); t.set('y2', pb.y);
    }
    let jt = this.objectsTable.get('joints');
    if (!(jt instanceof LuaTable)) { jt = new LuaTable(); this.objectsTable.set('joints', jt); }
    jt.set(name, t);
    this.joints.push({ name, end1, end2, joint, table: t });
  }
  destroyJointLua(name) {
    const i = this.joints.findIndex((j) => j.name === name);
    if (i < 0) return;
    const j = this.joints[i];
    if (j.joint) this.world.destroyJoint(j.joint);
    this.joints.splice(i, 1);
    const jt = this.objectsTable.get('joints');
    if (jt instanceof LuaTable) jt.set(name, undefined);
  }
  applyImpulse(name, ix, iy, px, py) {
    const o = this.objects.get(name);
    if (!o || !o.body.isDynamic()) return;
    o.body.applyLinearImpulse(planck.Vec2(ix, iy), planck.Vec2(px, py), true);
  }
  applyForce(name, fx, fy, px, py) {
    const o = this.objects.get(name);
    if (!o || !o.body.isDynamic()) return;
    o.body.applyForce(planck.Vec2(fx, fy), planck.Vec2(px, py), true);
  }
  setPosition(name, x, y) {
    const o = this.objects.get(name);
    if (!o) return;
    o.body.setTransform(planck.Vec2(x, y), o.body.getAngle());
    const t = this._objTable().get(name);
    if (t instanceof LuaTable) { t.set('x', x); t.set('y', y); }
    o.x = x; o.y = y;
    o.states[0].x = o.states[1].x = x;
    o.states[0].y = o.states[1].y = y;
  }
  setRotation(name, a) {
    const o = this.objects.get(name);
    if (!o) return;
    o.body.setTransform(o.body.getPosition(), a);
    const t = this._objTable().get(name);
    if (t instanceof LuaTable) t.set('angle', a);
    o.angle = a; o.states[0].a = o.states[1].a = a;
  }
  setVelocity(name, vx, vy) {
    const o = this.objects.get(name);
    if (o) o.body.setLinearVelocity(planck.Vec2(vx, vy));
  }
  setAngularVelocity(name, w) {
    const o = this.objects.get(name);
    if (o) o.body.setAngularVelocity(w);
  }
  setSleeping(name, sleep) {
    const o = this.objects.get(name);
    if (!o) return;
    const b = o.body;
    if (sleep) {
      if (b.isDynamic()) { b.setLinearVelocity(planck.Vec2(0, 0)); b.setAngularVelocity(0); b.setAwake(false); }
      o.staticAwake = false;
    } else {
      b.setAwake(true); o.staticAwake = true;
    }
  }
  setSprite(name, sprite) {
    const o = this.objects.get(name);
    if (o) o.sprite = this.res.getSprite(null, sprite);
  }
  setTexture(name, tex) {
    const o = this.objects.get(name);
    const sheet = this.res.getSpriteSheet(tex);
    if (o) o.texture = sheet ? sheet.image : null;
  }
  setMaterial(name, m) {
    const o = this.objects.get(name);
    if (!o) return;
    if (m === 'wood') o.material = 1;
    if (m === 'rock') o.material = 2;
    if (m === 'light') o.material = 3;
  }
  setObjectParameter(name, p, v) {
    const o = this.objects.get(name);
    if (!o) return;
    if ((p | 0) === 1) o.flag52 = (v | 0) === 1;
    else if ((p | 0) === 2) { o.body.setType(v === 0 ? 'static' : 'dynamic'); if (v !== 0) o.body.setAwake(true); }
  }
  _isAwake(o) { return o.body.isStatic() ? o.staticAwake : o.body.isAwake(); }

  // ---------------- level loading ----------------
  loadLevel(name) {
    this.rollingClip = { wood: -1, rock: -1, light: -1 };
    this.accumulator = 0;
    this.loading = true;
    this.loadLuaFile('blocks.lua', 'blockTable');
    this.loadLuaFile('particles.lua', 'particleTable');
    this.particles.systems.clear();
    for (const o of this.objects.values()) this.world.destroyBody(o.body);
    for (let b = this.world.getBodyList(); b; ) { const n = b.getNext(); this.world.destroyBody(b); b = n; }
    this.joints.length = 0;
    this.objects.clear();
    this.particles.clearAll();
    for (const t of this.trajectories) t.length = 0;
    const t = new LuaTable();
    this.runChunk(luaToJs(name) + '.lua', t);
    this.T.set('loadedObjects', t);
    this.loading = false;
  }

  setTheme(theme) {
    const bt = this.T.get('blockTable');
    const themes = bt instanceof LuaTable ? bt.get('themes') : undefined;
    const th = themes instanceof LuaTable ? themes.get(theme) : undefined;
    if (!(th instanceof LuaTable)) return;
    const c = th.get('color'), g = th.get('groundColor');
    this.themeColor = [num(c.get('r')), num(c.get('g')), num(c.get('b'))];
    this.groundColor = [num(g.get('r')), num(g.get('g')), num(g.get('b'))];
    this.themeImage = luaToJs(str(th.get('image')));
    const index = num(th.get('index')) | 0;
    this.themeSheet = 'INGAME_' + (index + 2);
    this.commonSheet = 'INGAME_2';
    this.layers = [1, 2, 3, 4].map((i) => `${this.themeImage}_LAYER_${i}`);
    this.layers.push(`${this.themeImage}_LAYER_GRASS`);
  }

  // ---------------- contacts (GameLua::BeginContact) ----------------
  beginContact(contact) {
    if (this.loading || this.editing) return;
    const fa = contact.getFixtureA(), fb = contact.getFixtureB();
    const ba = fa.getBody(), bb = fb.getBody();
    const oa = ba.getUserData(), ob = bb.getUserData();
    const nameA = oa ? oa.name : '', nameB = ob ? ob.name : '';
    const world = this._objTable();
    const ta = world.get(nameA), tb = world.get(nameB);
    if (!(ta instanceof LuaTable) || !(tb instanceof LuaTable)) return;
    const va = ba.getLinearVelocity(), vb = bb.getLinearVelocity();
    const ma = fr(ba.getMass()), mb = fr(bb.getMass());
    const ctlA = oa.controllable, ctlB = ob.controllable;
    if (!ctlA && !ctlB) {
      // block <-> block
      const dx = ma * va.y - mb * vb.y, dy = ma * va.x - mb * vb.x;
      const impulse = fr(Math.sqrt(dx * dx + dy * dy) / 10);
      const scoreT = this.T.get('scoreTable');
      const blocks = scoreT instanceof LuaTable ? scoreT.get('blocks') : undefined;
      let score = blocks instanceof LuaTable ? num(blocks.get('score')) : 0;
      let total = 0, dmgA = false, dmgB = false;
      const damage = (t) => {
        if (typeof t.get('strength') !== 'number') return [true, 0];
        const def = typeof t.get('defence') === 'number' ? t.get('defence') : 0;
        if (impulse < def) return [false, 0];
        const s = t.get('strength');
        const d = fr(impulse - def);
        const ns = fr(s - d);
        t.set('strength', ns);
        return [true, ns < 0 ? s : d];
      };
      let r = damage(ta); dmgA = r[0]; total += r[1];
      r = damage(tb); dmgB = r[0]; total += r[1];
      this.call('blockCollision', jsToLuaKeep(nameA), jsToLuaKeep(nameB), impulse, dmgA || dmgB);
      if (total > 0) {
        score = fr(score + Math.floor(total) * 10);
        if (blocks instanceof LuaTable) blocks.set('score', score);
      }
    } else if (ctlA && ctlB) {
      // bird <-> bird
      const sa = Math.sqrt(va.x * va.x + va.y * va.y), sb = Math.sqrt(vb.x * vb.x + vb.y * vb.y);
      const impulse = sb < sa ? fr((sa * ma) / 10) : fr((sb * mb) / 10);
      this.call('birdCollision', jsToLuaKeep(nameA), jsToLuaKeep(nameB), impulse, 0);
    } else {
      // bird <-> block
      const birdIsA = ctlA;
      const birdName = birdIsA ? nameA : nameB, blockName = birdIsA ? nameB : nameA;
      const birdT = birdIsA ? ta : tb, blockT = birdIsA ? tb : ta;
      const birdBody = birdIsA ? ba : bb;
      const v = birdBody.getLinearVelocity();
      const m = fr(birdBody.getMass());
      let impulse = fr((m * Math.sqrt(v.y * v.y + v.x * v.x)) / 10);
      const colorF = num(this.T.get('colorDamageFactor'));
      const yellowF = num(this.T.get('yellowBirdFactor'));
      const blueF = num(this.T.get('blueBirdFactor'));
      const m1 = blockT.get('material'), m2 = birdT.get('material');
      if (m1 === 'wood' && m2 === 'wood') impulse = fr(impulse * colorF * yellowF);
      if (m1 === 'rock' && m2 === 'rock') impulse = fr(impulse * colorF);
      if (m1 === 'light' && m2 === 'light') impulse = fr(impulse * colorF * blueF);
      let dmg = 0;
      if (typeof blockT.get('strength') === 'number') {
        const def = typeof blockT.get('defence') === 'number' ? blockT.get('defence') : 0;
        dmg = fr(impulse - def);
        if (dmg > 0) {
          const s = blockT.get('strength');
          const ns = fr(s - dmg);
          blockT.set('strength', ns);
          if (ns < 0) {
            // the bird punches through the destroyed block keeping part of its velocity
            let k = ((-ns / m) / impulse) * 10 * 1.75;
            if (k > 1) k = 1;
            birdBody.setLinearVelocity(planck.Vec2(k * v.x, k * v.y));
            contact.setEnabled(false);
            dmg = s;
          }
        }
      }
      this.call('birdCollision', jsToLuaKeep(birdName), jsToLuaKeep(blockName), impulse, Math.floor(dmg));
    }
  }

  // ---------------- per-frame update (GameLua::update) ----------------
  update(dt) {
    const T = this.T;
    T.set('screenWidth', this.r.width);
    T.set('screenHeight', this.r.height);
    if (this.app.zoom !== this.app.zoomRef) {
      T.set('zoomLevel', fr(num(T.get('zoomLevel')) + (this.app.zoom - this.app.zoomRef) * 0.5));
    }
    T.set('touches', this.app.touchCount);

    if (this.physicsEnabled) {
      this.accumulator = fr(this.accumulator + dt);
      while (!(this.accumulator < STEP)) {
        this.world.step(STEP, 10, 10);
        for (const b of this.pendingDestroy.splice(0)) this.world.destroyBody(b);
        this.accumulator = fr(this.accumulator - STEP);
        for (const o of this.objects.values()) {
          if (!this._isAwake(o)) continue;
          const p = o.body.getPosition();
          o.states[0] = o.states[1];
          o.states[1] = { x: p.x, y: p.y, a: o.body.getAngle() };
          if (o.controllable && o.body.getMass() !== 0) o.body.setBullet(true);
        }
      }
      const f = this.accumulator / STEP;
      const pi = fr(Math.PI);
      for (const o of this.objects.values()) {
        if (!this._isAwake(o)) continue;
        const [s0, s1] = o.states;
        const g = 1 - f;
        o.x = g * s0.x + f * s1.x;
        o.y = g * s0.y + f * s1.y;
        if (Math.abs(s1.a - s0.a) < pi) o.angle = g * s0.a + f * s1.a;
        else if (s1.a < s0.a) o.angle = g * (s0.a - 2 * pi) + f * s1.a;
        else o.angle = g * (s0.a + 2 * pi) + f * s1.a;
      }
    }

    let moving = false, awake = false, movingZero = false;
    const roll = [0, 0, 0, 0];
    for (const o of this.objects.values()) {
      if (!this._isAwake(o)) continue;
      const t = o.table;
      const b = o.body;
      t.set('x', fr(o.x));
      t.set('y', fr(o.y));
      const mass = b.getMass();
      if (mass > 0) {
        if (o.y > 20) t.set('frozen', true);
        if (o.x < this.levelLeft) t.set('frozen', true);
        if (o.x > this.levelRight) t.set('frozen', true);
      }
      const v = b.getLinearVelocity();
      const speed = Math.sqrt(v.y * v.y + v.x * v.x);
      if (speed > 0 && !o.controllable) movingZero = true;
      const w = b.getAngularVelocity();
      if (speed > 3) moving = true;
      if (w > 0.1) moving = true;
      if (o.controllable) {
        t.set('xVel', fr(v.x));
        t.set('yVel', fr(v.y));
        t.set('angle', fr(o.angle));
        t.set('sleeping', !b.isAwake());
        awake = true;
        continue;
      }
      if (o.rolling) {
        let vol = ((Math.abs(w) * o.radius) / 400) * mass;
        if (vol > 1) vol = 1;
        if (o.material >= 1 && o.material <= 3 && roll[o.material] < vol) roll[o.material] = vol;
      }
      awake = true;
    }
    T.set('hasMovingObjects', moving);
    T.set('hasAwakeObjects', awake);
    T.set('hasMovingObjectsZeroTolerance', movingZero);

    for (const j of this.joints) {
      if (!j.joint) continue;
      const a = j.joint.getAnchorA(), b = j.joint.getAnchorB();
      j.table.set('x1', a.x); j.table.set('y1', a.y); j.table.set('x2', b.x); j.table.set('y2', b.y);
    }

    this._rolling('wood', roll[1]);
    this._rolling('rock', roll[2]);
    this._rolling('light', roll[3]);

    this.call('update', dt, dt);
    this.particles.update(dt);
  }
  _rolling(mat, vol) {
    const clip = mat + '_rolling';
    if (vol <= 0) { this.res.stopAudio(clip); return; }
    if (!this.res.isAudioPlaying(clip)) this.rollingClip[mat] = this.res.playAudio(clip, vol, true, 2);
    else this.res.audio.setClipVolume(this.rollingClip[mat], vol);
  }

  // ---------------- rendering ----------------
  setRenderState(a) {
    const rs = this.r.getRenderState2D();
    const n = a.length;
    if (n > 1) {
      rs.tx = num(a[0]); rs.ty = num(a[1]);
      if (n > 3) {
        rs.sx = num(a[2]); rs.sy = num(a[3]);
        if (n !== 4) {
          const ang = num(a[4]);
          rs.c = Math.cos(ang); rs.s = Math.sin(ang);
          if (n > 6) { rs.px = num(a[5]); rs.py = num(a[6]); }
        }
      }
    }
  }
  drawRect(r, g, b, a, x1, y1, x2, y2, keepState) {
    if (!keepState) this.r.getRenderState2D().reset();
    const argb = (((a * 255) | 0) << 24) | (((r * 255) | 0) << 16) | (((g * 255) | 0) << 8) | ((b * 255) | 0);
    this.r.fillRect(argb >>> 0, x1 | 0, y1 | 0, ((x2 - x1) | 0), ((y2 - y1) | 0));
  }
  drawTexturedRect(spriteName, x1, y1, x2, y2) {
    this.r.getRenderState2D().reset();
    const sheet = this.res.findSheet(spriteName);
    const s = sheet && sheet.getSprite(spriteName);
    if (!s) return;
    this.r.texturizeRect(sheet.image, s.x, s.y, s.w, s.h, this.topLeftX - s.x, this.topLeftY - s.y, x1 | 0, y1 | 0, (x2 - x1) | 0, (y2 - y1) | 0);
  }
  drawLine(x1, y1, x2, y2, w, r, g, b, a) {
    const argb = (((a | 0) & 255) << 24) | (((r | 0) & 255) << 16) | (((g | 0) & 255) << 8) | ((b | 0) & 255);
    const ctx = this.r.ctx;
    const rs = this.r.rs;
    this.r._apply(ctx, 0, 0);
    ctx.strokeStyle = `rgba(${(argb >> 16) & 255},${(argb >> 8) & 255},${argb & 255},${((argb >>> 24) & 255) / 255})`;
    ctx.lineWidth = w | 0;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo((x1 | 0) - rs.px, (y1 | 0) - rs.py);
    ctx.lineTo((x2 | 0) - rs.px, (y2 | 0) - rs.py);
    ctx.stroke();
  }

  _spriteSize(sheet, name) {
    const s = this.res.getSprite(sheet, name);
    return s || { w: 0, h: 0, px: 0, py: 0 };
  }

  drawBackground() {
    const ws = this.worldScale;
    const W = this.r.width, H = this.r.height;
    const l1 = this._spriteSize(this.commonSheet, this.layers[0]);
    const rs = this.r.getRenderState2D();
    rs.tx = -this.topLeftX; rs.ty = -this.topLeftY;
    rs.sx = rs.sy = ws; rs.c = 1; rs.s = 0;
    const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
    this.bgColor = (cl(this.themeColor[0]) << 16) | (cl(this.themeColor[1]) << 8) | cl(this.themeColor[2]);
    // ground fill below the foreground layer
    this.drawRect(this.groundColor[0] / 255, this.groundColor[1] / 255, this.groundColor[2] / 255, 1,
      0, -((this.topLeftY - (l1.h - l1.py) * 1.5) * ws), W, H + 1, false);
    rs.sx = rs.sy = ws + ws;
    const half = (W * 0.5) / ws;
    // layers: LAYER_4 at 1/8 parallax, then LAYER_2 at 1/2 (the shipped loop skips LAYER_3)
    for (const [n, factor] of [[4, 0.125], [2, 0.5]]) {
      const sheet = (n - 2) >>> 0 <= 1 ? this.themeSheet : this.commonSheet;
      const name = this.layers[n - 1];
      const sp = this._spriteSize(sheet, name);
      const limit = fr(sp.px + half);
      const w2 = sp.w + sp.w;
      const m = (factor * this.topLeftX) % w2;
      const start = (w2 + m) * -0.5;
      let x = Math.trunc(start);
      rs.ty = this.topLeftY * -0.5;
      rs.tx = start - x;
      while (limit > x) {
        this.res.drawSprite(sheet, name, x, 0, 4, 3);
        x += sp.w;
      }
    }
  }

  drawForeground() {
    const k = 1.5;
    const rs = this.r.getRenderState2D();
    const s = this.worldScale * k;
    rs.sx = rs.sy = s; rs.c = 1; rs.s = 0;
    const l1 = this._spriteSize(this.commonSheet, this.layers[0]);
    const w = l1.w;
    const limit = this.r.width / s + l1.px;
    const m = this.topLeftX % (w * k);
    const start = -(w * k + m) / k;
    rs.ty = -this.topLeftY / k;
    let x0 = Math.trunc(start);
    rs.tx = start - x0;
    if (!(limit > x0)) return;
    let x = x0;
    do { this.res.drawSprite(this.commonSheet, this.layers[0], x, 0, 4, 3); x += w; } while (limit > x);
    x = x0;
    do { this.res.drawSprite(this.themeSheet, this.layers[4], x, 0, 4, 3); x += w; } while (limit > x);
  }

  drawGame() {
    const r = this.r;
    const rs = r.getRenderState2D();
    rs.tx = -this.topLeftX; rs.ty = -this.topLeftY;
    rs.sx = rs.sy = this.worldScale;
    const setRot = (o) => {
      rs.c = Math.cos(o.angle); rs.s = Math.sin(o.angle);
      rs.px = o.sprite.px; rs.py = o.sprite.py;
    };
    // pass 1: static objects (textured ones go through MaskedImage)
    r.maskBegin();
    for (const o of this.objects.values()) {
      if (!o.sprite || o.body.getMass() !== 0) continue;
      setRot(o);
      if (!o.texture) o.sprite.draw(r, o.x * PHYSICS_TO_WORLD, o.y * PHYSICS_TO_WORLD);
      else r.maskAdd(o.texture, o.sprite.sheet.image, o.sprite, o.x * PHYSICS_TO_WORLD, o.y * PHYSICS_TO_WORLD);
    }
    r.maskRender();
    // pass 2: dynamic, non-controllable objects
    for (const o of this.objects.values()) {
      if (!o.sprite || o.controllable || o.body.getMass() === 0 || o.flag52) continue;
      setRot(o);
      o.sprite.draw(r, o.x * PHYSICS_TO_WORLD, o.y * PHYSICS_TO_WORLD);
    }
    // pass 3: trajectory puffs
    rs.c = 1; rs.s = 0;
    const puff = ['SMOKE_TRAIL_1', 'SMOKE_TRAIL_2', 'SMOKE_TRAIL_3'];
    for (let t = 0; t < 6; t++) {
      const pts = this.trajectories[t];
      for (let i = 0; i < pts.length; i++) this.res.drawSprite('INGAME', puff[i % 3], pts[i][0], pts[i][1]);
    }
    // pass 4: birds and flagged objects on top
    for (const o of this.objects.values()) {
      if (!o.sprite || !(o.controllable || o.flag52)) continue;
      setRot(o);
      o.sprite.draw(r, o.x * PHYSICS_TO_WORLD, o.y * PHYSICS_TO_WORLD);
    }
    this.particles.draw(r);
  }

  startNewTrajectory() {
    this.trajIndex += 3;
    if (this.trajIndex > 3) this.trajIndex = 0;
    for (let i = 0; i < 3; i++) this.trajectories[this.trajIndex + i].length = 0;
  }
  addToTrajectory(idx, x, y) {
    const t = this.trajectories[this.trajIndex - 1 + (idx | 0)];
    if (t) t.push([x, y]);
  }

  // GameLua::clipText: word-wrap a (localized) string to a pixel width using the current font
  clipText(setName, key, width) {
    const text = this.res.getString(setName, key);
    const font = this.res.font;
    const lines = new LuaTable();
    let widest = 0;
    const measure = (s) => (font ? font.getStringWidth(s) : s.length * 8);
    const paragraphs = text.split('\n');
    let n = 0;
    for (const para of paragraphs) {
      const words = para.split(/(?<=[ -])/);
      let line = '';
      for (const wd of words) {
        const cand = line + wd;
        if (line !== '' && measure(cand.replace(/ $/, '')) > width) {
          const l = line.replace(/ $/, '');
          lines.set(++n, jsToLua(l)); widest = Math.max(widest, measure(l));
          line = wd;
        } else line = cand;
      }
      const l = line.replace(/ $/, '');
      lines.set(++n, jsToLua(l)); widest = Math.max(widest, measure(l));
    }
    this.clippedText.set('widestLine', widest);
    this.clippedText.set('lines', lines);
  }
}

function jsToLuaKeep(s) { return s; }

export function luaToJson(t, depth = 0) {
  if (!(t instanceof LuaTable) || depth > 20) return null;
  const out = { a: [], h: [] };
  let r = t.next(undefined);
  while (r) {
    const [k, v] = r;
    let jv;
    if (v instanceof LuaTable) jv = { t: luaToJson(v, depth + 1) };
    else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') jv = v;
    else { r = t.next(k); continue; }
    out.h.push([k, jv]);
    r = t.next(k);
  }
  return out;
}
export function jsonToLua(o) {
  const t = new LuaTable();
  if (!o || !o.h) return t;
  for (const [k, v] of o.h) t.set(k, v && typeof v === 'object' ? jsonToLua(v.t) : v);
  return t;
}

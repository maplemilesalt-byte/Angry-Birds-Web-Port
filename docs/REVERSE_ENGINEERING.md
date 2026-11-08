# Angry Birds 1.0 (iOS) — reverse-engineering notes for the browser port

Target: `Angry Birds 1.0.ipa` → `Payload/AngryBirds.app/AngryBirds`
(Mach-O ARM, SHA-256 `e1dadaf6e07c02307d8c1ee9345b9c0e80b954b903dd3150f19d43eae66ec6e8`).
Analysis: REA (Ghidra 12.1.4 provider) — all 2,497 native functions decompiled, plus a custom Lua 5.1
bytecode disassembler (`tools/disasm.mjs`).

## Architecture of the original

| Layer | Original | Port |
|---|---|---|
| Game logic, menus, levels flow, scoring, birds' powers, camera | `gamelogic.lua` (compiled Lua 5.1 bytecode) | **runs unchanged** in `src/lua/vm.js` |
| Level data, materials, themes, particles, star limits | `LevelN.lua`, `blocks.lua`, `particles.lua`, `starLimits.lua` (bytecode) | **run unchanged** |
| Sprites / fonts / texts / audio | `*.dat` + `*.png` / `*.pvr`, `SFX/*.wav`, `Music/*.mp3` | **loaded unchanged** from the IPA at runtime |
| Lua ↔ engine bridge, physics, damage, world renderer, particles, trajectories | C++ `GameLua`, `Particles`, `MaskedImage`, Box2D 2.1 | reimplemented from decompilation (`src/engine/*.js`) |
| Resources, bitmap fonts, text groups, audio output | C++ `game::Resources`, `game::LuaResources` | reimplemented (`src/engine/resources.js`, `src/app.js`) |
| GL ES renderer, touch, app loop | `gr::EGL_Context`, `MyEAGLView`, `GameApp` | Canvas 2D / Pointer Events / rAF (`src/engine/renderer.js`, `src/app.js`) |

## Lua runtime configuration (from chunk headers and binary)

* Chunk header `1B 4C 75 61 51 00 01 04 04 04 04 00`: Lua 5.1, little endian, **4-byte float `lua_Number`**.
  The VM rounds every arithmetic result with `Math.fround`.
* `LUAI_NUMFMT` is `"%.6g"` (string in the Lua core of the binary) — used for number→string.
* `GameLua` is a `lua::LuaObject`: a private table holding `_G` (real globals) and `this`;
  `gamelogic.lua` is compiled with that table as its environment (`LuaState::compile` → `lua_setfenv`).
* Data files are read with `LuaTable::read` = compile + `setfenv(newTable)` + call.
  `blocks.lua` → `blockTable`, `particles.lua` → `particleTable`, `starLimits.lua` → `starTable`,
  `LevelN.lua` → `loadedObjects`.
* Engine entry points into Lua: `updateValues` (after compile), `createStartUpAssets`
  (GameLua::createAssets), `update(dt, dt)` every frame, `blockCollision(a, b, impulse, damaged)`,
  `birdCollision(bird, other, impulse, damage)` from the contact listener.

## Frame (GameApp::update → GameLua::update)

1. Pinch: zoom = dist/initialDist·initialScale; wheel: ±0.05 (≥1) / ±0.025 steps, clamp [0.01, 100].
2. `keyPressed/keyReleased/keyHold.LBUTTON` from touch begin/end flags; cursor from the primary touch.
3. Clear with background colour (`+0x6c`), then GameLua::update:
   * `screenWidth/screenHeight`, `zoomLevel += (zoom − zoomRef)·0.5`, `touches` (= active touches).
   * Physics: fixed step **1/30 s**, `Step(…, 10, 10)`, accumulator, render interpolation between the
     last two states (angle unwrapping by ±2π); controllable dynamic bodies become bullets.
   * Per awake object: `x, y` (interpolated); `frozen` if mass>0 and (y>20 or x<left or x>right);
     controllable objects also get `xVel, yVel, angle, sleeping`.
   * `hasMovingObjects` (speed>3 or angVel>0.1), `hasAwakeObjects`, `hasMovingObjectsZeroTolerance`.
   * Rolling sounds `wood/rock/light_rolling` (track 2, loop) with volume `|ω|·r/400·m` (≤1).
   * Lua `update(dt, dt)`, then `Particles::update(dt)`.

## Box2D configuration (b2Settings constants found in b2ContactSolver / b2Island)

Gravity (0, 20); linearSlop **0.05** (polygon radius 0.1); linear sleep tolerance **0.1**;
angular sleep tolerance 2°; time to sleep **0.25 s**; baumgarte 0.2; max correction 0.2;
body defs: angularDamping **1.0**, linearDamping 0; boxes use `SetAsBox(width, height)` (Lua values are
half-extents — verified: `mass = 4·w·h·density` in the level data); circles `radius`.
Non-colliding boxes (`collision == false`) get fixture user data that `ShouldCollide` rejects.

## Damage model (GameLua::BeginContact)

* Block↔block: `impulse = |m₁v₁ − m₂v₂| / 10`; for each side with `strength`:
  if `impulse ≥ defence` → `strength −= impulse − defence`; destroyed blocks contribute their old strength.
  `blockCollision(a, b, impulse, damaged)`; `scoreTable.blocks.score += floor(total)·10`.
* Bird↔block: `impulse = m·|v| / 10`, ×`colorDamageFactor`·`yellowBirdFactor` (wood/wood),
  ×`colorDamageFactor` (rock/rock), ×`colorDamageFactor`·`blueBirdFactor` (light/light).
  If the block breaks, the bird keeps `min(1, ((−strength/m)/impulse)·17.5)` of its velocity and the
  contact is disabled (punch-through). `birdCollision(bird, block, impulse, floor(damage))`.
* Bird↔bird: impulse of the faster bird.

## Rendering

* Render state = rotation, translation, scale, pivot. Vertex = S·(T + pos + pivot + R·(local − pivot)).
* `drawGame`: static objects (textured statics via MaskedImage: sprite alpha masks a world-aligned
  repeating `INGAME_6/7/8` texture), dynamic non-controllable objects, trajectory puffs
  (`SMOKE_TRAIL_1..3`, two rings of 3 for split birds), birds/flagged objects, particles. Positions ×20.
* `drawBackground`: clear colour = theme colour; ground fill below `LAYER_1`; parallax layers drawn at
  2× scale: `LAYER_4` at 1/8 speed (sheet `INGAME_2`) and `LAYER_2` at 1/2 (theme sheet `INGAME_<i+2>`);
  the shipped loop skips `LAYER_3` (constant `2` reloaded when n == 3).
* `drawForegroundNative`: `LAYER_1` + `LAYER_GRASS` at 1.5× scale, 1:1 parallax.
* Sprite anchors (`Anchor::fromString`): TOP/VCENTER/BOTTOM/BASELINE/VPIVOT, LEFT/HCENTER/RIGHT/HPIVOT;
  default VPIVOT|HPIVOT.

## File formats (big-endian, Java DataInput style)

* Sprite sheet `.dat`: UTF image, u16 n, n×{UTF name, s16 x, y, w, h, pivotX, pivotY}.
* Bitmap font `.dat`: UTF image, s16 leading, s16 tracking, s16 n, n×{u16 char, s16 x, y, w, h, pivotY}.
* Texts `.dat`: u8, s32, u8 nLang, UTF codes, u16 nKeys, UTF keys, s32 offsets[nLang], UTF strings.
* `.pvr` (PVR v2): `INGAME`, `_1`, `_3.._5` RGBA4444 linear; `INGAME_2`, `_6.._8` PVRTC 4bpp twiddled.

## Particles (Particles::addParticles/update/draw)

Spawn count halved if total would exceed 40, capped at 125 live particles; position jittered by
(rand−0.5)·w/h, independent vx, vy ∈ [minVel, maxVel], angle 2π·rand, spin/scales from ranges;
gravity, lifetime-driven frame animation (`animation = "lifeTime"`), scale lerp.

## Known platform substitutions

* Box2D 2.1 (C++) → planck.js 1.4 (Box2D port) configured with the recovered constants.
* OpenGL ES → Canvas 2D; OpenAL/AudioQueue → Web Audio; `highscores.lua`/`settings.lua`
  app-data files → `localStorage` (same Lua tables, serialized as JSON).
* Lua hash-part iteration order follows insertion order (the C implementation's node order is not
  reproduced); this only affects ordering inside identical draw passes.

## Verification performed

* Headless (Node, software canvas, `tools/headless.mjs`): boot → title → menu → level select →
  intro cutscene → Level 1 tutorial → slingshot drag/launch → collisions, damage, particles, score →
  level cleared; highscores/settings persisted and Level 2 unlocked.
* All 63 shipped levels loaded through the original `loadLevelInternal` and simulated for 10 s with no
  script errors and **no pig dying without a shot** (structures settle stably with the recovered Box2D
  settings).
* Chromium (Playwright, `tools/browser-test.mjs`, `tools/browser-level.mjs`): same flow with real
  pointer input, no console errors, all 148 audio clips decoded, textured terrain (MaskedImage) rendered,
  60 fps at ~4.8 ms/frame on the heaviest level (Level81, 142 bodies).

# Angry Birds 1.0 — browser port

A port (not a remake) of the original **Angry Birds 1.0 for iPhone (December 2009)** to the browser.

* The game's own compiled Lua 5.1 bytecode (`gamelogic.lua`, all `LevelN.lua`, `blocks.lua`,
  `particles.lua`, `starLimits.lua`) is executed **unchanged** by a Lua 5.1 VM written in JavaScript
  (`src/lua/`), configured like the original build (32-bit float numbers, `%.6g` number format).
* All graphics, fonts, texts, sounds and music are read **directly from your original IPA** at runtime
  (PVR RGBA4444 / PVRTC4 textures are decoded in the browser). Nothing from the game is redistributed
  in this repository.
* Only the native C++ engine layer was reimplemented, from REA/Ghidra decompilation of the original
  ARM executable: the Lua bridge (`GameLua`), Box2D physics setup, the damage/scoring contact listener,
  world/background/foreground renderers, particles, trajectories, bitmap fonts, text groups and audio.
  See [`docs/REVERSE_ENGINEERING.md`](docs/REVERSE_ENGINEERING.md).

## Run

```sh
npm install          # planck.js (Box2D port); vendor/planck.mjs is already included
npm start            # http://localhost:8080/
```

Place `Angry Birds 1.0.ipa` in the project root (it is fetched automatically), or pick the IPA with
the file chooser shown on the page. Controls: touch / mouse (tap, drag the bird, drag to pan),
pinch or mouse wheel to zoom — exactly the original touch scheme at the original 480×320 resolution
(scaled to the window).

## Layout

| Path | Purpose |
|---|---|
| `src/lua/undump.js` | Lua 5.1 binary chunk loader + disassembler |
| `src/lua/vm.js`, `src/lua/stdlib.js` | Lua 5.1 VM (float32 numbers) and the stdlib subset the game uses |
| `src/platform/zip.js`, `src/platform/pvr.js` | IPA reader, PVR texture decoder |
| `src/engine/gamelua.js` | port of `GameLua` (physics bridge, contacts/damage, renderers) |
| `src/engine/particles.js` | port of `Particles` |
| `src/engine/resources.js`, `src/app.js` | ports of `game::Resources` / `LuaResources` / `GameApp` |
| `src/engine/renderer.js` | Canvas 2D equivalent of the GL ES 2D render state |
| `tools/` | disassembler, headless runner (software canvas), Playwright browser test, dev server |

# Angry Birds Web

**Preserving Angry Birds 1.0 for the modern web.**

A browser-based port of the original Angry Birds iOS 1.0, developed through reverse engineering with REA (Reverse Engineer Anything).

The goal is to bring the original game to modern web browsers while preserving its original identity, mechanics, physics, assets, levels, and gameplay behavior.

## About

Angry Birds Web is a reverse engineering and game preservation project focused on the original 2010 Angry Birds iOS release.

Instead of creating a remake or an inspired clone, this project aims to understand the original application's internal structure and port its actual functionality to the browser.

The original IPA serves as the primary reference for the port.

## Goals

- [x] Reverse engineer the original iOS application.
- [x] Preserve original graphics and animations.
- [x] Preserve original sound effects and music.
- [x] Reproduce the original physics and gameplay.
- [x] Recover original level data.
- [x] Reproduce the original menus and interface.
- [x] Support mouse and touchscreen controls.
- [x] Run directly in modern web browsers.
- [x] Avoid unnecessary external game engines.

## Technology

- JavaScript
- HTML5
- Canvas / WebGL
- Web Audio API
- Node.js
- REA (Reverse Engineer Anything)

## Running locally

Requirements:

- Node.js
- npm

Clone the repository:

```bash
git clone https://github.com/maplemilesalt-byte/angry-birds-web.git
cd angry-birds-web
```

Install dependencies if required:

```bash
npm install
```

Start the development server:

```bash
npm start
```

By default, the server uses port 8080.

If that port is already occupied, run:

```bash
node tools/serve.mjs 8087
```

Then open:

```text
http://localhost:8087
```

## Reverse Engineering

The project uses REA (Reverse Engineer Anything) to investigate the original Angry Birds IPA.

Areas of investigation include:

- Executable analysis.
- Application architecture.
- Original resources and assets.
- Game logic.
- Physics behavior.
- Level structures.
- Audio resources.
- Rendering and animations.

## Project Philosophy

**Port, don't recreate.**

The intention is to preserve the original experience rather than produce a new game that merely looks similar.

When original behavior can be recovered, it should be preserved. When platform-specific functionality must be reimplemented, it should match the original behavior as closely as possible.

## Legal Notice

Angry Birds and its associated intellectual property belong to their respective owners.

This is an independent fan-made preservation and reverse engineering project. It is not affiliated with, endorsed by, or sponsored by Rovio Entertainment.

Original proprietary game assets and IPA files are not included in this repository unless their redistribution is explicitly authorized.

## License

The licensing of original game resources and third-party components must be respected separately from the project's own source code.

See the repository's license file for applicable terms.

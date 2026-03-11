# CLAUDE.md — Agent Context for bt-printer-js

This file provides context for AI agents (Claude, Windsurf Cascade, Cursor, etc.) working on this codebase.

## Project Overview

**bt-printer-js** is a framework-agnostic npm library for connecting to Bluetooth thermal printers from the browser using the Web Bluetooth API and ESC/POS commands. It targets Angular and React frontend projects.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Bundler:** Rollup (dual output: CJS + ESM)
- **Output:** `dist/index.cjs.js`, `dist/index.esm.js`, plus `.d.ts` type declarations
- **No runtime dependencies** — everything is self-contained
- **Dev dependencies:** rollup, @rollup/plugin-typescript, tslib, typescript

## Project Structure

```
bt-printer-js/
├── src/
│   ├── index.ts              # Barrel exports — all public API surfaces
│   ├── types.ts              # All TypeScript interfaces, enums, and type aliases
│   ├── connection.ts         # BluetoothConnection — Web Bluetooth GATT connection manager
│   ├── escpos.ts             # EscPosEncoder — binary ESC/POS command builder
│   ├── preview.ts            # PrintPreview — renders PrintBlocks to canvas/PNG
│   ├── printer.ts            # BtPrinter — main facade class tying everything together
│   ├── settings.ts           # Printer settings derivation and char-width calculations
│   └── web-bluetooth.d.ts    # Web Bluetooth API type declarations (not in standard DOM lib)
├── dist/                     # Built output (git-ignored in practice)
├── test.html                 # Interactive test bench (served via npx serve)
├── package.json              # type: "module", dual CJS/ESM output
├── tsconfig.json             # ES2020 target, strict, DOM lib
├── rollup.config.js          # Rollup config with TypeScript plugin
├── README.md                 # Full API documentation with Angular/React examples
└── CLAUDE.md                 # This file
```

## Architecture & Design Patterns

### Layered Architecture

1. **Types layer** (`types.ts`) — shared interfaces and enums used everywhere
2. **Low-level layer** (`escpos.ts`, `connection.ts`) — raw ESC/POS encoding and BLE I/O
3. **Mid-level layer** (`settings.ts`, `preview.ts`) — derived capabilities and visual rendering
4. **Facade layer** (`printer.ts`) — `BtPrinter` class that composes all layers into a clean API

### Key Patterns

- **`BtPrinter`** is the main entry point users interact with. It delegates to internal classes.
- **`EscPosEncoder`** uses a fluent/chainable API (`enc.bold(true).text('hi').newline()`).
- **`PrintBlock`** is the universal content unit — an array of `PrintBlock[]` drives both preview rendering and ESC/POS encoding.
- **Preview rendering** uses an off-screen `<canvas>` to generate PNG output. No external dependencies.
- **BLE connection** chunks writes into 512-byte segments for BLE compatibility.
- **Event system** on `BtPrinter` uses a simple listener map (`on`/`off`/`emit` pattern).

### ESC/POS Command Reference

Commands are built in `src/escpos.ts`. Common ones:
- `ESC @` (0x1B 0x40) — Initialize printer
- `ESC E n` (0x1B 0x45) — Bold on/off
- `ESC - n` (0x1B 0x2D) — Underline on/off
- `GS B n` (0x1D 0x42) — Inverted (reverse black/white) on/off
- `GS ! n` (0x1D 0x21) — Character size (width/height multiplier)
- `ESC a n` (0x1B 0x61) — Alignment (0=left, 1=center, 2=right)
- `GS v 0` (0x1D 0x76 0x30) — Raster bit-image
- `GS k` (0x1D 0x6B) — Barcode
- `GS ( k` (0x1D 0x28 0x6B) — QR code
- `GS V` (0x1D 0x56) — Paper cut

### BLE UUIDs

Default service/characteristic UUIDs (overridable via `ConnectOptions`):
- Service: `000018f0-0000-1000-8000-00805f9b34fb`
- Write characteristic: `00002af1-0000-1000-8000-00805f9b34fb`

## Build & Test

```bash
npm install
npm run build          # Rollup compiles src/ → dist/
npx serve -p 8080 .   # Serve test.html at http://localhost:8080/test
```

## How to Add a New Feature

See `.windsurf/workflows/add-feature.md` for the full step-by-step checklist. Summary:

1. Add type/field to `src/types.ts`
2. Add ESC/POS command to `src/escpos.ts`
3. Wire into `src/printer.ts` `encodeBlock()` (apply + reset)
4. Add visual rendering in `src/preview.ts` `renderBlock()`
5. Add UI controls in `test.html` (`addBlock` defaults + `renderBlocks` HTML)
6. `npm run build` and test in browser
7. Update `README.md` docs
8. Export new public symbols from `src/index.ts` if needed

## Conventions

- **No runtime dependencies.** Keep the library self-contained.
- **Formatting resets after every block.** In `printer.ts`, `encodeBlock()` always resets all formatting flags at the end so blocks don't leak styles.
- **Preview must match print output.** When adding a formatting feature, implement it in both `escpos.ts` (for the actual printer) and `preview.ts` (for the canvas rendering).
- **Web Bluetooth types** are declared in `src/web-bluetooth.d.ts` since they're not in the standard TypeScript DOM lib.
- **test.html** uses inline `onclick` handlers that reference `window.*` globals. Functions must be assigned to `window` after their declaration (not before — ES module hoisting caveat).
- **Fluent API** — `EscPosEncoder` methods return `this` for chaining.

## Session History

This library was built from scratch in a single session. Key decisions made:

1. **Chose Rollup** over webpack/vite for simplicity — library output only, no dev server needed.
2. **Dual CJS/ESM output** for maximum compatibility with Angular (often CJS) and React (ESM).
3. **No canvas/image dependencies** — preview uses native browser `<canvas>` API only.
4. **PrintBlock as the universal unit** — same data structure drives both preview and print, ensuring WYSIWYG behavior.
5. **Paper width presets** (58mm → 384px/32 chars, 80mm → 576px/48 chars) based on standard 203 DPI thermal printers.
6. **GS B command** chosen for inverted text — this is the standard ESC/POS reverse print mode supported by most thermal printers.
7. **Base64 image support** — images can be provided as `base64` data URL strings or as DOM elements (`HTMLImageElement`, `HTMLCanvasElement`, `ImageData`). The `widthPercent` field (1–100) controls how much of the paper width the image occupies. In `printer.ts`, base64 strings are synchronously decoded to a canvas via `base64ToImage()`. In `preview.ts`, the test bench pre-loads the image into an `_imgEl` property on the block so dimensions are available for canvas rendering.

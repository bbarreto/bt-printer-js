---
description: How to add a new feature to the bt-printer-js library (e.g. a new text formatting option or print block type)
---

## Adding a New Feature

Follow this checklist when adding a new capability to the library. The inverted text feature was built using exactly this flow.

### 1. Update the type definitions

- Open `src/types.ts`
- If adding a new formatting option (like `inverted`, `bold`, `underline`), add an optional field to the `PrintBlock` interface with a JSDoc comment.
- If adding a new block type (like `'separator'`), extend the `type` union in `PrintBlock` and add any associated fields.

### 2. Add the ESC/POS command to the encoder

- Open `src/escpos.ts`
- Add a new method to `EscPosEncoder` that emits the correct ESC/POS byte sequence.
- Use the existing methods as reference (e.g. `bold()`, `underline()`, `inverted()`).
- ESC/POS command references:
  - Text formatting: `ESC E` (bold), `ESC -` (underline), `GS B` (inverted/reverse)
  - Size: `GS !`
  - Alignment: `ESC a`
  - Images: `GS v 0`
  - Barcodes: `GS k`
  - QR codes: `GS ( k`

### 3. Wire it into the printer encoder

- Open `src/printer.ts`
- In the `encodeBlock()` method, apply the new command when the field is set on the block.
- **Important:** Reset the formatting at the end of `encodeBlock()` — see the reset line that chains `.bold(false).underline(false).inverted(false).size(1, 1).align(Alignment.Left)`.

### 4. Add preview rendering

- Open `src/preview.ts`
- In `renderBlock()`, under the relevant `case` (usually `'text'`), add the visual representation.
- For text formatting options, modify how the canvas draws text (colors, backgrounds, decorations).
- Keep the preview visually accurate to what the printer will produce.

### 5. Update the test bench

- Open `test.html`
- In `addBlock()`, set a default value for the new field on the appropriate block type.
- In `renderBlocks()`, add UI controls (checkbox, select, input) that call `updateBlockField()`.

### 6. Build and test

```bash
npm run build
```

- Reload `test.html` in the browser (served via `npx serve -p 8080 .`, then visit `/test`)
- Add a block with the new feature, toggle it, click **Update Preview** to verify rendering.
- If connected to a printer, click **Print** to verify the ESC/POS output.

### 7. Update documentation

- Update `README.md`:
  - Add to the Features list if it's a major capability
  - Add `inverted`-style field to the PrintBlock Types table
  - Add a dedicated subsection with code examples if warranted
- Update `CLAUDE.md` if architectural patterns changed.

### 8. Export (if needed)

- If you added a new class, enum, or public type, export it from `src/index.ts`.

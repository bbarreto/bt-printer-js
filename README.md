# bt-printer-js

A framework-agnostic npm library for connecting to Bluetooth thermal printers from the browser using **Web Bluetooth** and **ESC/POS** commands. Works with Angular, React, or any frontend framework.

## Features

- **Web Bluetooth connection** — pair and connect to BLE thermal printers via the browser picker
- **Printer status** — query real-time status (paper, cover, errors, readiness)
- **Printer settings** — retrieve derived capabilities (codepages, chars per line, cut support)
- **Print preview** — generate a PNG image of what will be printed (canvas / data URL / Blob)
- **Character width control** — configure paper width (58mm / 80mm), font, and size multiplier
- **Inverted text** — white-on-black reversed text for headers and highlights
- **ESC/POS encoding** — full command builder for text, images, barcodes, QR codes, feed, and cut

## Installation

```bash
npm install bt-printer-js
```

## Quick Start

```ts
import { BtPrinter, Alignment } from 'bt-printer-js';

const printer = new BtPrinter({ paperWidth: 58 });

// Must be called from a user gesture (click/tap)
document.getElementById('connectBtn')!.addEventListener('click', async () => {
  await printer.connect();
  console.log('Connected!', printer.connected);
});
```

## API Reference

### `new BtPrinter(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `paperWidth` | `58 \| 80` | `58` | Paper width in mm |
| `serviceUuid` | `string` | standard UUID | BLE service UUID override |
| `characteristicUuid` | `string` | standard UUID | BLE characteristic UUID override |
| `paperWidthPx` | `number` | `384` (58mm) | Preview canvas width in pixels |
| `backgroundColor` | `string` | `#ffffff` | Preview background color |
| `textColor` | `string` | `#000000` | Preview text color |
| `fontFamily` | `string` | `monospace` | Preview font family |
| `baseFontSize` | `number` | `20` | Preview base font size |

### Connection

```ts
await printer.connect();       // Opens browser BLE picker
printer.disconnect();          // Disconnect
printer.connected;             // boolean — connection state
```

### Status

```ts
const status = await printer.getStatus();
// status.connected    — boolean
// status.ready        — boolean (printer online)
// status.paperPresent — boolean
// status.coverClosed  — boolean
// status.errorState   — boolean
// status.rawByte      — raw status byte from printer
```

### Settings & Capabilities

```ts
const settings = printer.getSettings();
// settings.modelName            — string
// settings.supportedCodepages   — Codepage[]
// settings.maxCharsPerLineA     — number (Font A)
// settings.maxCharsPerLineB     — number (Font B)
// settings.paperWidth           — 58 | 80
// settings.supportsCut          — boolean
// settings.supportsCashDrawer   — boolean
```

### Character Width Configuration

```ts
printer.setPaperWidth(80);   // Switch to 80mm paper
printer.setFont('A');        // Font A (12×24) or 'B' (9×17)

const config = printer.getCharWidthConfig(2); // with 2× width multiplier
// config.charsPerLine — number of characters that fit on one line
// config.paperWidth   — current paper width
// config.font         — current font
```

### Preview (PNG Generation)

```ts
import { PrintBlock, Alignment } from 'bt-printer-js';

const blocks: PrintBlock[] = [
  { type: 'text', text: 'RECEIPT', bold: true, inverted: true, align: Alignment.Center, heightMultiplier: 2 },
  { type: 'text', text: '------------------------' },
  { type: 'text', text: 'Item 1          $10.00' },
  { type: 'text', text: 'Item 2          $25.00' },
  { type: 'text', text: '------------------------' },
  { type: 'text', text: 'TOTAL           $35.00', bold: true },
  { type: 'feed', lines: 3 },
  { type: 'cut' },
];

// Data URL (for <img> src)
const dataUrl = printer.preview(blocks);

// Blob (for download or further processing)
const blob = await printer.previewBlob(blocks);

// Canvas element (for direct DOM insertion)
const canvas = printer.previewCanvas(blocks);
document.body.appendChild(canvas);
```

### Printing

```ts
// Print structured blocks
await printer.print(blocks);

// Print raw ESC/POS bytes
import { EscPosEncoder } from 'bt-printer-js';
const enc = new EscPosEncoder();
const raw = enc.initialize().inverted(true).text('Hello').inverted(false).newline().cut().encode();
await printer.printRaw(raw);

// Encode without sending (for inspection)
const buffer = printer.encode(blocks);
```

### PrintBlock Types

| Type | Key Fields | Description |
|---|---|---|
| `text` | `text`, `bold`, `underline`, `inverted`, `align`, `widthMultiplier`, `heightMultiplier` | Print text |
| `image` | `image`, `base64`, `widthPercent`, `align` | Print raster image (element, canvas, ImageData, or base64 string) |
| `barcode` | `data` | Print Code128 barcode |
| `qr` | `data` | Print QR code |
| `feed` | `lines` | Feed paper |
| `cut` | — | Cut paper |

### Base64 Images

Print images from base64 data URLs. Control width as a percentage of the paper and align left, center, or right.

```ts
// Using a base64 data URL
const logoBlock: PrintBlock = {
  type: 'image',
  base64: 'data:image/png;base64,iVBORw0KGgo…',  // your base64 string
  widthPercent: 50,          // use 50% of the paper width
  align: Alignment.Center,   // center the image
};

// Using an HTMLImageElement (also supports widthPercent)
const img = document.getElementById('myImg') as HTMLImageElement;
const imgBlock: PrintBlock = {
  type: 'image',
  image: img,
  widthPercent: 100,         // full paper width (default)
  align: Alignment.Left,
};

// Preview and print
const blocks: PrintBlock[] = [logoBlock, { type: 'feed', lines: 2 }, { type: 'cut' }];
const preview = printer.preview(blocks);   // PNG data URL
await printer.print(blocks);               // send to printer
```

| Field | Type | Default | Description |
|---|---|---|---|
| `image` | `HTMLImageElement \| HTMLCanvasElement \| ImageData` | — | Image element source |
| `base64` | `string` | — | Base64 data URL (`data:image/png;base64,…`) |
| `widthPercent` | `number` (1–100) | `100` | Image width as % of paper width |
| `align` | `Alignment` | `Left` | Left, Center, or Right |

### Inverted Text

Inverted text prints white text on a black background — useful for headers, highlights, or section labels.

```ts
// Using PrintBlock
const block: PrintBlock = {
  type: 'text',
  text: ' TOTAL: $35.00 ',
  inverted: true,
  bold: true,
  align: Alignment.Center,
};

// Using EscPosEncoder directly
const enc = new EscPosEncoder();
enc.initialize()
   .inverted(true)
   .text('INVERTED HEADER')
   .newline()
   .inverted(false)   // always turn off after use
   .text('Normal text')
   .newline()
   .encode();
```

### Events

```ts
printer.on('connected', () => console.log('Connected'));
printer.on('disconnected', () => console.log('Disconnected'));
printer.on('statusChange', (status) => console.log('Status:', status));
printer.on('error', (err) => console.error(err));
```

## Angular Example

```ts
@Component({ ... })
export class PrintComponent {
  private printer = new BtPrinter({ paperWidth: 58 });

  async onConnect() {
    await this.printer.connect();
  }

  async onPrint() {
    const blocks: PrintBlock[] = [
      { type: 'text', text: 'Hello from Angular!', align: Alignment.Center },
      { type: 'feed', lines: 3 },
      { type: 'cut' },
    ];
    await this.printer.print(blocks);
  }
}
```

## React Example

```tsx
function PrintComponent() {
  const printerRef = useRef(new BtPrinter({ paperWidth: 58 }));

  const handleConnect = async () => {
    await printerRef.current.connect();
  };

  const handlePrint = async () => {
    const blocks: PrintBlock[] = [
      { type: 'text', text: 'Hello from React!', align: Alignment.Center },
      { type: 'feed', lines: 3 },
      { type: 'cut' },
    ];
    await printerRef.current.print(blocks);
  };

  return (
    <div>
      <button onClick={handleConnect}>Connect Printer</button>
      <button onClick={handlePrint}>Print</button>
    </div>
  );
}
```

## Browser Compatibility

Web Bluetooth requires:
- **Chrome 56+** (desktop & Android)
- **Edge 79+**
- **Opera 43+**
- **Samsung Internet 6.2+**

> **Not supported** in Firefox, Safari, or iOS browsers.

## License

MIT

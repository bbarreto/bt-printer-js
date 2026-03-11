import { Alignment, Codepage, SizeMultiplier } from './types';

/**
 * ESC/POS command builder.
 * Accumulates binary commands and returns a final Uint8Array buffer.
 */
export class EscPosEncoder {
  private buffer: number[] = [];

  /** Append raw bytes */
  raw(bytes: number[] | Uint8Array): this {
    for (const b of bytes) {
      this.buffer.push(b);
    }
    return this;
  }

  /** Initialize printer (ESC @) */
  initialize(): this {
    return this.raw([0x1b, 0x40]);
  }

  /** Set text alignment (ESC a n) */
  align(alignment: Alignment): this {
    return this.raw([0x1b, 0x61, alignment]);
  }

  /** Set bold on/off (ESC E n) */
  bold(on: boolean): this {
    return this.raw([0x1b, 0x45, on ? 1 : 0]);
  }

  /** Set underline on/off (ESC - n) */
  underline(on: boolean): this {
    return this.raw([0x1b, 0x2d, on ? 1 : 0]);
  }

  /** Set inverted (white/black reverse) on/off (GS B n) */
  inverted(on: boolean): this {
    return this.raw([0x1d, 0x42, on ? 1 : 0]);
  }

  /** Set character size (GS ! n) — width and height multipliers 1-8 */
  size(width: SizeMultiplier = 1, height: SizeMultiplier = 1): this {
    const n = ((width - 1) << 4) | (height - 1);
    return this.raw([0x1d, 0x21, n]);
  }

  /** Select font (ESC M n): 0 = Font A, 1 = Font B */
  font(f: 'A' | 'B'): this {
    return this.raw([0x1b, 0x4d, f === 'A' ? 0 : 1]);
  }

  /** Set codepage (ESC t n) */
  codepage(cp: Codepage): this {
    return this.raw([0x1b, 0x74, cp]);
  }

  /** Encode and append a text string (latin-1) */
  text(str: string): this {
    for (let i = 0; i < str.length; i++) {
      this.buffer.push(str.charCodeAt(i) & 0xff);
    }
    return this;
  }

  /** Line feed (LF) */
  newline(): this {
    return this.raw([0x0a]);
  }

  /** Feed n lines (ESC d n) */
  feed(lines: number): this {
    return this.raw([0x1b, 0x64, Math.min(lines, 255)]);
  }

  /** Full cut (GS V 0) */
  cut(): this {
    return this.raw([0x1d, 0x56, 0x00]);
  }

  /** Partial cut (GS V 1) */
  partialCut(): this {
    return this.raw([0x1d, 0x56, 0x01]);
  }

  /**
   * Set line spacing to n dots (ESC 3 n). Used before image rows.
   */
  lineSpacing(n: number): this {
    return this.raw([0x1b, 0x33, n & 0xff]);
  }

  /**
   * Reset line spacing to default (ESC 2).
   */
  defaultLineSpacing(): this {
    return this.raw([0x1b, 0x32]);
  }

  /**
   * Print a bit-image line by line using ESC * (select bit-image mode).
   * This is far more compatible with cheap thermal printers (e.g. POS-5802DD)
   * than the GS v 0 raster command, because it sends one scanline at a time
   * instead of dumping the entire image into the printer's small buffer.
   *
   * Uses mode 0 (8-dot single-density) for maximum compatibility.
   * Each row sends: ESC * m nL nH d1 d2 ... dk LF
   *
   * @param imageData - RGBA ImageData (e.g. from a canvas)
   * @param maxWidth  - Maximum width in pixels (will be rounded down to multiple of 8)
   */
  rasterImage(imageData: ImageData, maxWidth: number): this {
    const srcW = imageData.width;
    const srcH = imageData.height;
    const w = Math.min(srcW, maxWidth);
    // Round width down to multiple of 8
    const printW = w - (w % 8);
    const bytesPerRow = printW / 8;

    if (bytesPerRow <= 0 || srcH <= 0) return this;

    const { data } = imageData;

    // Set line spacing to 24 dots (no gap between image rows)
    this.lineSpacing(24);

    // Process image in bands of 24 rows (ESC * mode 33 = 24-dot double-density)
    for (let bandTop = 0; bandTop < srcH; bandTop += 24) {
      // ESC * m nL nH — select bit image mode
      // m=33 (24-dot double density), nL/nH = number of dot-columns
      this.raw([
        0x1b, 0x2a, 33,
        bytesPerRow * 8 & 0xff, (bytesPerRow * 8 >> 8) & 0xff,
      ]);

      // For each horizontal pixel column, pack 24 vertical bits (3 bytes)
      for (let col = 0; col < printW; col++) {
        for (let byteIdx = 0; byteIdx < 3; byteIdx++) {
          let byte = 0;
          for (let bit = 0; bit < 8; bit++) {
            const row = bandTop + byteIdx * 8 + bit;
            if (row < srcH) {
              const idx = (row * srcW + col) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              const a = data[idx + 3];
              const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
              if (a > 128 && luminance < 128) {
                byte |= 0x80 >> bit;
              }
            }
          }
          this.buffer.push(byte);
        }
      }

      // Line feed after each band
      this.newline();
    }

    // Restore default line spacing
    this.defaultLineSpacing();

    return this;
  }

  /**
   * Print barcode (GS k m d1…dk NUL)
   * @param data    - barcode data string
   * @param system  - barcode system (default 73 = Code128)
   */
  barcode(data: string, system: number = 73): this {
    const bytes: number[] = [0x1d, 0x6b, system, data.length];
    for (let i = 0; i < data.length; i++) {
      bytes.push(data.charCodeAt(i));
    }
    return this.raw(bytes);
  }

  /**
   * Print QR code using GS ( k commands
   * @param data      - QR data string
   * @param moduleSize - module (dot) size 1-16 (default 6)
   * @param errorLevel - error correction: 48=L 49=M 50=Q 51=H (default 49)
   */
  qrCode(data: string, moduleSize: number = 6, errorLevel: number = 49): this {
    const len = data.length + 3;
    // Set model (Model 2)
    this.raw([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    // Set module size
    this.raw([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize]);
    // Set error correction
    this.raw([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, errorLevel]);
    // Store data
    this.raw([0x1d, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30]);
    this.text(data);
    // Print
    this.raw([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
    return this;
  }

  /** Request real-time printer status (DLE EOT n) */
  statusRequest(n: 1 | 2 | 3 | 4 = 1): this {
    return this.raw([0x10, 0x04, n]);
  }

  /** Get the encoded buffer */
  encode(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  /** Reset the internal buffer */
  reset(): this {
    this.buffer = [];
    return this;
  }
}

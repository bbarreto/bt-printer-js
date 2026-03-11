import { BluetoothConnection } from './connection';
import { EscPosEncoder } from './escpos';
import { PrintPreview, PreviewOptions } from './preview';
import { buildPrinterSettings, charsPerLine, PAPER_WIDTH_PX } from './settings';
import {
  Alignment,
  BtPrinterEvents,
  CharWidthConfig,
  Codepage,
  ConnectOptions,
  PrintBlock,
  PrinterSettings,
  PrinterStatus,
  SizeMultiplier,
} from './types';

/**
 * Main library class — facade for connecting, configuring, previewing, and
 * printing on a Bluetooth thermal printer using ESC/POS commands.
 *
 * Usage:
 * ```ts
 * const printer = new BtPrinter();
 * await printer.connect();                     // user gesture required
 * const status = await printer.getStatus();    // check readiness
 * const settings = printer.getSettings();      // paper size, codepages, etc.
 *
 * const blocks: PrintBlock[] = [
 *   { type: 'text', text: 'Hello World', bold: true, align: Alignment.Center },
 *   { type: 'feed', lines: 3 },
 *   { type: 'cut' },
 * ];
 *
 * const previewUrl = printer.preview(blocks);  // PNG data URL
 * await printer.print(blocks);                 // send to printer
 * ```
 */
export class BtPrinter {
  private connection: BluetoothConnection;
  private encoder: EscPosEncoder;
  private previewEngine: PrintPreview;
  private paperWidth: 58 | 80;
  private font: 'A' | 'B' = 'A';
  private codepage: Codepage = Codepage.PC437;
  private listeners: Partial<{ [K in keyof BtPrinterEvents]: BtPrinterEvents[K][] }> = {};

  constructor(options?: ConnectOptions & PreviewOptions) {
    this.paperWidth = options?.paperWidth ?? 58;
    this.connection = new BluetoothConnection(options);
    this.encoder = new EscPosEncoder();
    this.previewEngine = new PrintPreview({
      paperWidthPx: options?.paperWidthPx ?? PAPER_WIDTH_PX[this.paperWidth],
      backgroundColor: options?.backgroundColor,
      textColor: options?.textColor,
      fontFamily: options?.fontFamily,
      baseFontSize: options?.baseFontSize,
    });

    // Wire internal events
    this.connection.onDisconnect(() => this.emit('disconnected'));
    this.connection.onStatusChange((s) => this.emit('statusChange', s));
  }

  // ---------------------------------------------------------------------------
  // Event emitter
  // ---------------------------------------------------------------------------

  on<K extends keyof BtPrinterEvents>(event: K, listener: BtPrinterEvents[K]): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    (this.listeners[event] as BtPrinterEvents[K][]).push(listener);
  }

  off<K extends keyof BtPrinterEvents>(event: K, listener: BtPrinterEvents[K]): void {
    const list = this.listeners[event] as BtPrinterEvents[K][] | undefined;
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  }

  private emit<K extends keyof BtPrinterEvents>(event: K, ...args: Parameters<BtPrinterEvents[K]>): void {
    const list = this.listeners[event] as ((...a: any[]) => void)[] | undefined;
    if (!list) return;
    for (const fn of list) {
      try { fn(...args); } catch { /* swallow listener errors */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /** Whether the printer is currently connected */
  get connected(): boolean {
    return this.connection.connected;
  }

  /**
   * Open the browser Bluetooth picker and connect to a printer.
   * **Must be called from a user gesture** (click / tap handler).
   */
  async connect(options?: ConnectOptions): Promise<void> {
    if (options) {
      this.connection = new BluetoothConnection(options);
      this.connection.onDisconnect(() => this.emit('disconnected'));
      this.connection.onStatusChange((s) => this.emit('statusChange', s));
      if (options.paperWidth) this.paperWidth = options.paperWidth;
    }
    await this.connection.connect();
    this.emit('connected');
  }

  /** Disconnect from the printer */
  disconnect(): void {
    this.connection.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  /**
   * Query the printer's real-time status (paper, cover, errors).
   * Returns a `PrinterStatus` object.
   */
  async getStatus(): Promise<PrinterStatus> {
    return this.connection.requestStatus();
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  /**
   * Retrieve the printer's derived settings/capabilities.
   * Based on the paper width and the BLE device name heuristics.
   */
  getSettings(): PrinterSettings {
    return buildPrinterSettings(this.connection, this.paperWidth);
  }

  /**
   * Get the current character-width configuration.
   * Use this to know how many characters fit on one line.
   */
  getCharWidthConfig(widthMultiplier: SizeMultiplier = 1): CharWidthConfig {
    return {
      charsPerLine: charsPerLine(this.paperWidth, this.font, widthMultiplier),
      paperWidth: this.paperWidth,
      font: this.font,
    };
  }

  /** Change the active paper width */
  setPaperWidth(width: 58 | 80): void {
    this.paperWidth = width;
    this.previewEngine = new PrintPreview({
      paperWidthPx: PAPER_WIDTH_PX[width],
    });
  }

  /** Change the active font */
  setFont(font: 'A' | 'B'): void {
    this.font = font;
  }

  /** Change the active codepage */
  setCodepage(codepage: Codepage): void {
    this.codepage = codepage;
  }

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------

  /**
   * Generate a PNG preview of the print content.
   * @returns a data URL string (`data:image/png;base64,…`)
   */
  preview(blocks: PrintBlock[]): string {
    return this.previewEngine.toDataURL(blocks);
  }

  /**
   * Generate a PNG Blob preview of the print content.
   */
  previewBlob(blocks: PrintBlock[]): Promise<Blob> {
    return this.previewEngine.toBlob(blocks);
  }

  /**
   * Render the preview to a canvas element (useful for embedding directly).
   */
  previewCanvas(blocks: PrintBlock[]): HTMLCanvasElement {
    return this.previewEngine.render(blocks);
  }

  // ---------------------------------------------------------------------------
  // Printing
  // ---------------------------------------------------------------------------

  /**
   * Encode an array of `PrintBlock` items into ESC/POS binary and send
   * them to the printer over Bluetooth.
   */
  async print(blocks: PrintBlock[]): Promise<void> {
    const data = this.encode(blocks);
    await this.connection.write(data);
  }

  /**
   * Send raw ESC/POS bytes to the printer.
   */
  async printRaw(data: Uint8Array): Promise<void> {
    await this.connection.write(data);
  }

  /**
   * Encode PrintBlocks into an ESC/POS Uint8Array without sending.
   * Useful for inspection or saving to a file.
   */
  encode(blocks: PrintBlock[]): Uint8Array {
    const enc = this.encoder;
    enc.reset().initialize().codepage(this.codepage).font(this.font);

    for (const block of blocks) {
      this.encodeBlock(enc, block);
    }

    return enc.encode();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private encodeBlock(enc: EscPosEncoder, block: PrintBlock): void {
    // Apply common formatting
    if (block.align !== undefined) enc.align(block.align);
    if (block.bold !== undefined) enc.bold(block.bold);
    if (block.underline !== undefined) enc.underline(block.underline);
    if (block.inverted !== undefined) enc.inverted(block.inverted);
    enc.size(block.widthMultiplier ?? 1, block.heightMultiplier ?? 1);

    switch (block.type) {
      case 'text':
        if (block.text) {
          const lines = block.text.split('\n');
          for (const line of lines) {
            enc.text(line).newline();
          }
        }
        break;

      case 'image': {
        const imgSource = block.image ?? (block.base64 ? this.base64ToImage(block.base64) : null);
        if (imgSource) {
          const widthPct = Math.max(1, Math.min(100, block.widthPercent ?? 100));
          const targetWidth = Math.floor(PAPER_WIDTH_PX[this.paperWidth] * (widthPct / 100));
          const imageData = this.toImageData(imgSource, targetWidth);
          if (imageData) {
            enc.rasterImage(imageData, targetWidth);
          }
        }
        break;
      }

      case 'barcode':
        if (block.data) {
          enc.barcode(block.data);
          enc.newline();
        }
        break;

      case 'qr':
        if (block.data) {
          enc.qrCode(block.data);
          enc.newline();
        }
        break;

      case 'feed':
        enc.feed(block.lines ?? 1);
        break;

      case 'cut':
        enc.cut();
        break;
    }

    // Reset formatting after each block
    enc.bold(false).underline(false).inverted(false).size(1, 1).align(Alignment.Left);
  }

  /**
   * Convert an image source to ImageData for raster printing.
   * @param source   - image element, canvas, or ImageData
   * @param maxWidth - maximum pixel width (defaults to full paper width)
   */
  private toImageData(
    source: HTMLImageElement | HTMLCanvasElement | ImageData,
    maxWidth?: number,
  ): ImageData | null {
    if (source instanceof ImageData) return source;

    const canvas = document.createElement('canvas');
    let w: number;
    let h: number;

    if (source instanceof HTMLCanvasElement) {
      w = source.width;
      h = source.height;
    } else {
      w = source.naturalWidth || source.width;
      h = source.naturalHeight || source.height;
    }

    if (w === 0 || h === 0) return null;

    const maxW = maxWidth ?? PAPER_WIDTH_PX[this.paperWidth];
    const scale = w > maxW ? maxW / w : (maxWidth ? maxW / w : 1);
    canvas.width = Math.floor(w * scale);
    canvas.height = Math.floor(h * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  /**
   * Synchronously create an HTMLImageElement from a base64 data URL.
   * The image must be loaded before it can be drawn to a canvas.
   * For synchronous ESC/POS encoding, we draw onto a temporary canvas.
   */
  private base64ToImage(base64: string): HTMLCanvasElement | null {
    const img = new Image();
    img.src = base64;
    // Image from data URI is available synchronously in most browsers
    if (img.width === 0 || img.height === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas;
  }
}

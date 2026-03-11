/** Supported character codepages for ESC/POS printers */
export enum Codepage {
  PC437 = 0,
  PC850 = 2,
  PC860 = 3,
  PC863 = 4,
  PC865 = 5,
  PC858 = 19,
  UTF8 = 255,
}

/** Text alignment */
export enum Alignment {
  Left = 0,
  Center = 1,
  Right = 2,
}

/** Text size multiplier (1x–8x) */
export type SizeMultiplier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Character width configuration */
export interface CharWidthConfig {
  /** Characters per line at the current paper width */
  charsPerLine: number;
  /** Paper width in mm (common: 58, 80) */
  paperWidth: 58 | 80;
  /** Font (A = 12x24, B = 9x17 on most printers) */
  font: 'A' | 'B';
}

/** Current printer status flags */
export interface PrinterStatus {
  connected: boolean;
  ready: boolean;
  paperPresent: boolean;
  coverClosed: boolean;
  errorState: boolean;
  rawByte?: number;
}

/** Printer capability / settings retrieved from the device */
export interface PrinterSettings {
  /** Printer model name (if available from device info) */
  modelName: string;
  /** Supported codepages the printer reports */
  supportedCodepages: Codepage[];
  /** Max characters per line for font A */
  maxCharsPerLineA: number;
  /** Max characters per line for font B */
  maxCharsPerLineB: number;
  /** Paper width in mm */
  paperWidth: 58 | 80;
  /** Whether the printer supports cut commands */
  supportsCut: boolean;
  /** Whether the printer supports cash drawer kick */
  supportsCashDrawer: boolean;
}

/** A single content block to be printed */
export interface PrintBlock {
  type: 'text' | 'image' | 'barcode' | 'qr' | 'feed' | 'cut';
  /** Text content (for type=text) */
  text?: string;
  /** Image as HTMLImageElement, HTMLCanvasElement, or ImageData (for type=image) */
  image?: HTMLImageElement | HTMLCanvasElement | ImageData;
  /** Base64-encoded image string, e.g. 'data:image/png;base64,…' (for type=image) */
  base64?: string;
  /** Image width as a percentage of the paper width, 1–100 (for type=image, default: 100) */
  widthPercent?: number;
  /** Barcode / QR data string */
  data?: string;
  /** Text alignment */
  align?: Alignment;
  /** Bold */
  bold?: boolean;
  /** Underline */
  underline?: boolean;
  /** Inverted (white text on black background) */
  inverted?: boolean;
  /** Width multiplier (1-8) */
  widthMultiplier?: SizeMultiplier;
  /** Height multiplier (1-8) */
  heightMultiplier?: SizeMultiplier;
  /** Number of lines to feed (for type=feed) */
  lines?: number;
}

/** Options passed when connecting */
export interface ConnectOptions {
  /** Optional BLE service UUID override */
  serviceUuid?: string;
  /** Optional BLE characteristic UUID override */
  characteristicUuid?: string;
  /** Paper width (default: 58) */
  paperWidth?: 58 | 80;
  /** BLE write chunk size in bytes (default: 100). Lower values are safer for cheap printers. */
  chunkSize?: number;
  /** Delay in ms between BLE write chunks (default: 20). Prevents printer buffer overflow. */
  chunkDelayMs?: number;
}

/** Events emitted by the printer */
export interface BtPrinterEvents {
  connected: () => void;
  disconnected: () => void;
  statusChange: (status: PrinterStatus) => void;
  error: (error: Error) => void;
}

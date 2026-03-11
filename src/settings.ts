import { Codepage, PrinterSettings } from './types';
import { BluetoothConnection } from './connection';

/**
 * Paper-width presets: characters per line for Font A and Font B.
 * These are standard values for most ESC/POS thermal printers.
 */
const PAPER_PRESETS: Record<58 | 80, { charsA: number; charsB: number }> = {
  58: { charsA: 32, charsB: 42 },
  80: { charsA: 48, charsB: 64 },
};

/**
 * Pixel widths per paper size (dots at 203 dpi).
 */
export const PAPER_WIDTH_PX: Record<58 | 80, number> = {
  58: 384,
  80: 576,
};

/**
 * Builds a PrinterSettings object from connection info and paper width.
 *
 * Because most BLE thermal printers do not expose a standardized GATT
 * characteristic to query their full capabilities, we derive settings
 * from the paper width and the device name. If you know the exact
 * capabilities of your printer, you can override these.
 */
export function buildPrinterSettings(
  connection: BluetoothConnection,
  paperWidth: 58 | 80,
): PrinterSettings {
  const device = connection.bluetoothDevice;
  const modelName = device?.name ?? 'Unknown';
  const preset = PAPER_PRESETS[paperWidth];

  // Default supported codepages — most cheap thermal printers support at least these
  const supportedCodepages: Codepage[] = [
    Codepage.PC437,
    Codepage.PC850,
    Codepage.PC858,
  ];

  // Heuristic: if model name contains certain keywords, extend capabilities
  const nameLower = modelName.toLowerCase();
  const supportsCut = !nameLower.includes('mini') && !nameLower.includes('pocket');
  const supportsCashDrawer = nameLower.includes('pos') || paperWidth === 80;

  return {
    modelName,
    supportedCodepages,
    maxCharsPerLineA: preset.charsA,
    maxCharsPerLineB: preset.charsB,
    paperWidth,
    supportsCut,
    supportsCashDrawer,
  };
}

/**
 * Calculate how many characters fit per line given a paper width and
 * a width multiplier.
 */
export function charsPerLine(
  paperWidth: 58 | 80,
  font: 'A' | 'B',
  widthMultiplier: number = 1,
): number {
  const preset = PAPER_PRESETS[paperWidth];
  const base = font === 'A' ? preset.charsA : preset.charsB;
  return Math.floor(base / widthMultiplier);
}

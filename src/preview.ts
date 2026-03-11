import { Alignment, PrintBlock } from './types';

/** Default rendering constants */
const FONT_A_CHAR_WIDTH = 12;
const FONT_A_CHAR_HEIGHT = 24;
const LINE_SPACING = 4;
const PADDING = 8;

export interface PreviewOptions {
  /** Paper width in pixels (default: 384 for 58mm, 576 for 80mm) */
  paperWidthPx?: number;
  /** Background color (default: white) */
  backgroundColor?: string;
  /** Text color (default: black) */
  textColor?: string;
  /** Font family (default: monospace) */
  fontFamily?: string;
  /** Base font size in px (default: 20) */
  baseFontSize?: number;
}

/**
 * Generates a PNG preview of print content by rendering to an off-screen canvas.
 */
export class PrintPreview {
  private paperWidthPx: number;
  private bgColor: string;
  private textColor: string;
  private fontFamily: string;
  private baseFontSize: number;

  constructor(options?: PreviewOptions) {
    this.paperWidthPx = options?.paperWidthPx ?? 384;
    this.bgColor = options?.backgroundColor ?? '#ffffff';
    this.textColor = options?.textColor ?? '#000000';
    this.fontFamily = options?.fontFamily ?? 'monospace';
    this.baseFontSize = options?.baseFontSize ?? 20;
  }

  /**
   * Render an array of PrintBlocks to a canvas and return it.
   * The canvas can be used to extract a PNG data URL or Blob.
   */
  render(blocks: PrintBlock[]): HTMLCanvasElement {
    // First pass: calculate total height
    const totalHeight = this.calculateHeight(blocks);

    const canvas = document.createElement('canvas');
    canvas.width = this.paperWidthPx;
    canvas.height = totalHeight + PADDING * 2;

    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let y = PADDING;

    for (const block of blocks) {
      y = this.renderBlock(ctx, block, y);
    }

    return canvas;
  }

  /**
   * Render blocks and return a PNG data URL string.
   */
  toDataURL(blocks: PrintBlock[]): string {
    const canvas = this.render(blocks);
    return canvas.toDataURL('image/png');
  }

  /**
   * Render blocks and return a PNG Blob via a Promise.
   */
  toBlob(blocks: PrintBlock[]): Promise<Blob> {
    const canvas = this.render(blocks);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create PNG blob.'));
      }, 'image/png');
    });
  }

  /** Calculate total height needed for all blocks */
  private calculateHeight(blocks: PrintBlock[]): number {
    let h = 0;
    for (const block of blocks) {
      h += this.blockHeight(block);
    }
    return h;
  }

  private blockHeight(block: PrintBlock): number {
    const hMul = block.heightMultiplier ?? 1;
    const wMul = block.widthMultiplier ?? 1;
    const fontSize = this.baseFontSize * hMul;
    const charW = FONT_A_CHAR_WIDTH * wMul * (this.baseFontSize / FONT_A_CHAR_HEIGHT);
    const lineH = fontSize + LINE_SPACING;

    switch (block.type) {
      case 'text': {
        if (!block.text) return 0;
        const maxChars = Math.floor((this.paperWidthPx - PADDING * 2) / charW);
        const lines = this.wrapText(block.text, maxChars);
        return lines.length * lineH;
      }
      case 'feed':
        return (block.lines ?? 1) * (this.baseFontSize + LINE_SPACING);
      case 'cut':
        return this.baseFontSize + LINE_SPACING;
      case 'image': {
        const imgSize = this.getImageSize(block);
        if (!imgSize) return 0;
        const availW = (this.paperWidthPx - PADDING * 2) * ((block.widthPercent ?? 100) / 100);
        const scale = Math.min(1, availW / imgSize.w);
        return imgSize.h * scale + LINE_SPACING;
      }
      case 'barcode':
        return 80 + LINE_SPACING;
      case 'qr':
        return 150 + LINE_SPACING;
      default:
        return 0;
    }
  }

  private renderBlock(ctx: CanvasRenderingContext2D, block: PrintBlock, y: number): number {
    const hMul = block.heightMultiplier ?? 1;
    const wMul = block.widthMultiplier ?? 1;
    const fontSize = this.baseFontSize * hMul;
    const charW = FONT_A_CHAR_WIDTH * wMul * (this.baseFontSize / FONT_A_CHAR_HEIGHT);
    const lineH = fontSize + LINE_SPACING;

    switch (block.type) {
      case 'text': {
        if (!block.text) return y;
        const weight = block.bold ? 'bold' : 'normal';
        ctx.font = `${weight} ${fontSize}px ${this.fontFamily}`;

        const isInverted = block.inverted ?? false;
        const maxChars = Math.floor((this.paperWidthPx - PADDING * 2) / charW);
        const lines = this.wrapText(block.text, maxChars);

        for (const line of lines) {
          const x = this.alignX(ctx, line, block.align ?? Alignment.Left);
          y += fontSize;

          if (isInverted) {
            const textW = ctx.measureText(line).width;
            const pad = 4;
            ctx.fillStyle = this.textColor;
            ctx.fillRect(x - pad, y - fontSize + 2, textW + pad * 2, fontSize + 2);
            ctx.fillStyle = this.bgColor;
          } else {
            ctx.fillStyle = this.textColor;
          }

          ctx.fillText(line, x, y);

          if (block.underline) {
            const textW = ctx.measureText(line).width;
            ctx.beginPath();
            ctx.moveTo(x, y + 2);
            ctx.lineTo(x + textW, y + 2);
            ctx.strokeStyle = isInverted ? this.bgColor : this.textColor;
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          y += LINE_SPACING;
        }
        return y;
      }

      case 'feed':
        return y + (block.lines ?? 1) * (this.baseFontSize + LINE_SPACING);

      case 'cut': {
        const cutY = y + fontSize / 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, cutY);
        ctx.lineTo(this.paperWidthPx, cutY);
        ctx.stroke();
        ctx.setLineDash([]);
        return y + lineH;
      }

      case 'image': {
        const drawable = this.getDrawableImage(block);
        if (!drawable) return y;
        const { source, w: srcW, h: srcH } = drawable;
        const availW = (this.paperWidthPx - PADDING * 2) * ((block.widthPercent ?? 100) / 100);
        const scale = Math.min(1, availW / srcW);
        const dw = srcW * scale;
        const dh = srcH * scale;
        let dx = PADDING;
        if (block.align === Alignment.Center) dx = (this.paperWidthPx - dw) / 2;
        else if (block.align === Alignment.Right) dx = this.paperWidthPx - PADDING - dw;

        ctx.drawImage(source, dx, y, dw, dh);
        return y + dh + LINE_SPACING;
      }

      case 'barcode': {
        // Simplified barcode preview: draw placeholder bars
        const text = block.data ?? '';
        ctx.fillStyle = this.textColor;
        const barcodeW = this.paperWidthPx - PADDING * 2;
        let bx = PADDING;
        if (block.align === Alignment.Center) bx = PADDING;
        const barH = 60;
        const barW = barcodeW / (text.length * 11 || 1);

        for (let i = 0; i < text.length; i++) {
          const code = text.charCodeAt(i);
          for (let bit = 0; bit < 8; bit++) {
            if ((code >> (7 - bit)) & 1) {
              ctx.fillRect(bx, y, Math.max(barW, 1), barH);
            }
            bx += barW;
          }
          bx += barW * 3; // inter-char gap
        }

        // Label
        ctx.font = `12px ${this.fontFamily}`;
        const labelX = this.alignX(ctx, text, block.align ?? Alignment.Center);
        ctx.fillText(text, labelX, y + barH + 14);

        return y + 80 + LINE_SPACING;
      }

      case 'qr': {
        // Simplified QR preview: draw a placeholder box with "QR" label
        const qrSize = 120;
        let qx = PADDING;
        if (block.align === Alignment.Center) qx = (this.paperWidthPx - qrSize) / 2;
        else if (block.align === Alignment.Right) qx = this.paperWidthPx - PADDING - qrSize;

        ctx.strokeStyle = this.textColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(qx, y, qrSize, qrSize);

        ctx.fillStyle = this.textColor;
        ctx.font = `bold 16px ${this.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.fillText('QR', qx + qrSize / 2, y + qrSize / 2 + 6);
        ctx.textAlign = 'start';

        const data = block.data ?? '';
        if (data) {
          ctx.font = `10px ${this.fontFamily}`;
          const labelX = this.alignX(ctx, data, block.align ?? Alignment.Center);
          ctx.fillText(data.substring(0, 40), labelX, y + qrSize + 14);
        }

        return y + 150 + LINE_SPACING;
      }

      default:
        return y;
    }
  }

  /** Calculate x position based on alignment */
  private alignX(ctx: CanvasRenderingContext2D, text: string, align: Alignment): number {
    const textW = ctx.measureText(text).width;
    switch (align) {
      case Alignment.Center:
        return (this.paperWidthPx - textW) / 2;
      case Alignment.Right:
        return this.paperWidthPx - PADDING - textW;
      default:
        return PADDING;
    }
  }

  /** Get image natural size from a PrintBlock (supports image, base64) */
  private getImageSize(block: PrintBlock): { w: number; h: number } | null {
    if (block.image) {
      const img = block.image;
      if (img instanceof HTMLImageElement) {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        return w > 0 && h > 0 ? { w, h } : null;
      }
      if (img instanceof HTMLCanvasElement || img instanceof ImageData) {
        return img.width > 0 && img.height > 0 ? { w: img.width, h: img.height } : null;
      }
    }
    if (block.base64 && (block as any)._imgEl) {
      const el = (block as any)._imgEl as HTMLImageElement;
      if (el.width > 0 && el.height > 0) return { w: el.width, h: el.height };
    }
    return null;
  }

  /**
   * Get a drawable CanvasImageSource from a PrintBlock.
   * Supports HTMLImageElement, HTMLCanvasElement, ImageData, and base64 strings.
   */
  private getDrawableImage(block: PrintBlock): { source: CanvasImageSource; w: number; h: number } | null {
    if (block.image) {
      const img = block.image;
      if (img instanceof HTMLImageElement) {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w === 0 || h === 0) return null;
        return { source: img, w, h };
      }
      if (img instanceof HTMLCanvasElement) {
        if (img.width === 0 || img.height === 0) return null;
        return { source: img, w: img.width, h: img.height };
      }
      if (img instanceof ImageData) {
        const tmp = document.createElement('canvas');
        tmp.width = img.width;
        tmp.height = img.height;
        tmp.getContext('2d')!.putImageData(img, 0, 0);
        return { source: tmp, w: img.width, h: img.height };
      }
    }
    if (block.base64 && (block as any)._imgEl) {
      const el = (block as any)._imgEl as HTMLImageElement;
      if (el.width > 0 && el.height > 0) {
        return { source: el, w: el.width, h: el.height };
      }
    }
    return null;
  }

  /** Word-wrap text to fit within maxChars characters per line */
  private wrapText(text: string, maxChars: number): string[] {
    if (maxChars <= 0) return [text];
    const result: string[] = [];
    const rawLines = text.split('\n');

    for (const raw of rawLines) {
      if (raw.length <= maxChars) {
        result.push(raw);
        continue;
      }
      let remaining = raw;
      while (remaining.length > maxChars) {
        let breakAt = remaining.lastIndexOf(' ', maxChars);
        if (breakAt <= 0) breakAt = maxChars;
        result.push(remaining.substring(0, breakAt));
        remaining = remaining.substring(breakAt).trimStart();
      }
      if (remaining.length > 0) result.push(remaining);
    }

    return result;
  }
}

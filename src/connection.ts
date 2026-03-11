import { ConnectOptions, PrinterStatus } from './types';

/** Well-known BLE service/characteristic UUIDs for common thermal printers */
const DEFAULT_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const DEFAULT_CHAR_WRITE_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

/**
 * Maximum bytes to send in a single BLE write.
 * Cheap thermal printers (e.g. POS-5802DD) have small buffers and
 * will crash/hang if chunks are too large. 100 bytes is safe for most.
 */
const DEFAULT_BLE_CHUNK_SIZE = 100;

/** Default delay (ms) between BLE write chunks to let the printer process */
const DEFAULT_CHUNK_DELAY_MS = 20;

/**
 * Manages the Web Bluetooth connection to a thermal printer.
 */
export class BluetoothConnection {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private serviceUuid: string;
  private characteristicUuid: string;
  private _onDisconnect: (() => void) | null = null;
  private _onStatusChange: ((status: PrinterStatus) => void) | null = null;
  private chunkSize: number;
  private chunkDelay: number;

  constructor(options?: ConnectOptions) {
    this.serviceUuid = options?.serviceUuid ?? DEFAULT_SERVICE_UUID;
    this.characteristicUuid = options?.characteristicUuid ?? DEFAULT_CHAR_WRITE_UUID;
    this.chunkSize = options?.chunkSize ?? DEFAULT_BLE_CHUNK_SIZE;
    this.chunkDelay = options?.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
  }

  /** Whether a device is currently connected */
  get connected(): boolean {
    return !!this.server?.connected;
  }

  /** The connected BluetoothDevice (if any) */
  get bluetoothDevice(): BluetoothDevice | null {
    return this.device;
  }

  /** Register a disconnect callback */
  onDisconnect(cb: () => void): void {
    this._onDisconnect = cb;
  }

  /** Register a status-change callback */
  onStatusChange(cb: (status: PrinterStatus) => void): void {
    this._onStatusChange = cb;
  }

  /**
   * Request a Bluetooth printer via the browser picker and connect.
   * Must be called in response to a user gesture (click / tap).
   */
  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth API is not available in this browser.');
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [this.serviceUuid] }],
      optionalServices: [this.serviceUuid],
    });

    this.device.addEventListener('gattserverdisconnected', () => {
      this._onDisconnect?.();
    });

    this.server = await this.device.gatt!.connect();

    const service = await this.server.getPrimaryService(this.serviceUuid);
    const chars = await service.getCharacteristics();

    // Pick the writable characteristic (prefer the configured UUID, fall back to any writable one)
    for (const c of chars) {
      if (c.uuid === this.characteristicUuid) {
        this.writeCharacteristic = c;
      }
      if (c.properties.notify) {
        this.notifyCharacteristic = c;
      }
    }

    // Fallback: pick first writable characteristic
    if (!this.writeCharacteristic) {
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) {
          this.writeCharacteristic = c;
          break;
        }
      }
    }

    if (!this.writeCharacteristic) {
      throw new Error('No writable BLE characteristic found on the printer service.');
    }

    // Start listening for notifications (status bytes)
    if (this.notifyCharacteristic) {
      await this.notifyCharacteristic.startNotifications();
      this.notifyCharacteristic.addEventListener(
        'characteristicvaluechanged',
        (event: Event) => {
          const char = event.target as BluetoothRemoteGATTCharacteristic;
          if (char.value) {
            const status = this.parseStatus(char.value.getUint8(0));
            this._onStatusChange?.(status);
          }
        },
      );
    }
  }

  /**
   * Disconnect from the printer.
   */
  disconnect(): void {
    if (this.server?.connected) {
      this.server.disconnect();
    }
    this.device = null;
    this.server = null;
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;
  }

  /**
   * Send raw bytes to the printer, splitting into BLE-friendly chunks.
   */
  async write(data: Uint8Array): Promise<void> {
    if (!this.writeCharacteristic) {
      throw new Error('Not connected to a printer.');
    }

    for (let offset = 0; offset < data.length; offset += this.chunkSize) {
      const chunk = data.slice(offset, offset + this.chunkSize);
      if (this.writeCharacteristic.properties.writeWithoutResponse) {
        await this.writeCharacteristic.writeValueWithoutResponse(chunk);
      } else {
        await this.writeCharacteristic.writeValueWithResponse(chunk);
      }
      // Delay between chunks to prevent printer buffer overflow
      if (this.chunkDelay > 0 && offset + this.chunkSize < data.length) {
        await new Promise(resolve => setTimeout(resolve, this.chunkDelay));
      }
    }
  }

  /**
   * Request real-time status from the printer.
   * Sends DLE EOT 1 and waits for the notification response.
   */
  async requestStatus(): Promise<PrinterStatus> {
    if (!this.writeCharacteristic) {
      throw new Error('Not connected to a printer.');
    }

    return new Promise<PrinterStatus>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Status request timed out.'));
      }, 3000);

      if (this.notifyCharacteristic) {
        const handler = (event: Event) => {
          clearTimeout(timeout);
          this.notifyCharacteristic!.removeEventListener('characteristicvaluechanged', handler);
          const char = event.target as BluetoothRemoteGATTCharacteristic;
          if (char.value) {
            resolve(this.parseStatus(char.value.getUint8(0)));
          }
        };
        this.notifyCharacteristic.addEventListener('characteristicvaluechanged', handler);
      }

      // DLE EOT 1 — request printer status
      const cmd = new Uint8Array([0x10, 0x04, 0x01]);
      this.write(cmd).catch((e) => {
        clearTimeout(timeout);
        reject(e);
      });

      // If no notify characteristic, resolve with basic connected status
      if (!this.notifyCharacteristic) {
        clearTimeout(timeout);
        resolve({
          connected: true,
          ready: true,
          paperPresent: true,
          coverClosed: true,
          errorState: false,
        });
      }
    });
  }

  /**
   * Parse a single ESC/POS status byte into a PrinterStatus object.
   * Bit layout (DLE EOT 1 response):
   *   bit 3: online=0/offline=1
   *   bit 5: cover open=1
   *   bit 6: paper fed by button=1
   */
  private parseStatus(byte: number): PrinterStatus {
    return {
      connected: true,
      ready: (byte & 0x08) === 0,
      coverClosed: (byte & 0x20) === 0,
      paperPresent: (byte & 0x40) === 0,
      errorState: (byte & 0x08) !== 0,
      rawByte: byte,
    };
  }
}

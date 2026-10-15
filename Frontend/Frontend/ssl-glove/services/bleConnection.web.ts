import {
  BLE_SERVICE_UUID,
  BLE_CHAR_UUID,
  BLE_DEVICE_NAME,
  parseBinaryPayload,
  parseTextDataLine,
  type SensorData,
  type GloveDevice,
  type ConnectionState,
  type IGloveConnection,
} from './bleTypes';

declare global {
  interface Navigator {
    bluetooth?: {
      requestDevice(options: any): Promise<BluetoothDevice>;
    };
    serial?: {
      requestPort(options?: any): Promise<any>;
    };
  }
  interface BluetoothDevice {
    id: string;
    name?: string;
    gatt?: {
      connect(): Promise<BluetoothRemoteGATTServer>;
      connected: boolean;
      disconnect(): void;
    };
    addEventListener(type: string, listener: () => void): void;
  }
  interface BluetoothRemoteGATTServer {
    getPrimaryService(service: string | number): Promise<BluetoothGATTService>;
  }
  interface BluetoothGATTService {
    getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
  }
  interface BluetoothRemoteGATTCharacteristic {
    value?: DataView;
    startNotifications(): Promise<any>;
    stopNotifications(): Promise<any>;
    addEventListener(type: string, listener: (e: any) => void): void;
    removeEventListener(type: string, listener: (e: any) => void): void;
  }
}

export class WebBleConnection implements IGloveConnection {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private serialPort: any = null;
  private serialReader: any = null;
  private serialBuffer: string = '';
  private state: ConnectionState = 'disconnected';
  private dataCallbacks: Set<(data: SensorData) => void> = new Set();
  private stateCallbacks: Set<(state: ConnectionState) => void> = new Set();

  getConnectionType(): ConnectionType | null {
    if (this.state !== 'connected') return null;
    return this.serialPort ? 'serial' : (this.device ? 'bluetooth' : null);
  }

  async scan(preferredMode?: ConnectionType): Promise<GloveDevice[]> {
    const hasSerial = typeof navigator !== 'undefined' && 'serial' in navigator;
    const hasBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

    if (!hasSerial && !hasBluetooth) {
      throw new Error('Web Serial and Web Bluetooth not supported in this browser. Please use Chrome or Edge.');
    }

    let useSerial = false;
    if (preferredMode === 'serial') {
      if (!hasSerial) throw new Error('Web Serial not supported in this browser. Please use Chrome or Edge.');
      useSerial = true;
    } else if (preferredMode === 'bluetooth') {
      if (!hasBluetooth) throw new Error('Web Bluetooth not supported in this browser.');
      useSerial = false;
    } else {
      useSerial = hasSerial;
      if (hasSerial && hasBluetooth && typeof window !== 'undefined') {
        useSerial = window.confirm(
          'Connect to ESP32 HandGlow:\n\n• Click [OK] for USB Cable (Serial Port)\n• Click [Cancel] for Bluetooth (Wireless BLE)'
        );
      }
    }

    this.setState('scanning');

    try {
      if (useSerial) {
        const port = await (navigator as any).serial.requestPort();
        this.serialPort = port;
        this.device = null;
        return [{ id: 'serial-port', name: 'ESP32 (USB Serial)' }];
      } else {
        const device = await (navigator as any).bluetooth.requestDevice({
          filters: [{ services: [BLE_SERVICE_UUID] }],
        });
        this.device = device;
        this.serialPort = null;
        return [{ id: device.id, name: device.name || BLE_DEVICE_NAME }];
      }
    } catch (err: any) {
      this.setState('disconnected');
      if (err.name === 'NotFoundError') {
        return [];
      }
      throw err;
    }
  }

  async connect(deviceId?: string): Promise<void> {
    if (!this.serialPort && !this.device) {
      throw new Error('No device selected. Please click Connect first.');
    }

    this.setState('connecting');

    try {
      if (this.serialPort) {
        await this.serialPort.open({ baudRate: 115200 });

        const textDecoder = new (window as any).TextDecoderStream();
        this.serialPort.readable.pipeTo(textDecoder.writable).catch(() => {});
        this.serialReader = textDecoder.readable.getReader();
        this.serialBuffer = '';
        this.setState('connected');

        this.startSerialReadLoop();
        return;
      }

      if (this.device) {
        const server = await this.device.gatt!.connect();
        const service = await server.getPrimaryService(BLE_SERVICE_UUID);
        this.characteristic = await service.getCharacteristic(BLE_CHAR_UUID);

        await this.characteristic.startNotifications();
        this.characteristic.addEventListener(
          'characteristicvaluechanged',
          this.handleNotification
        );
        this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);

        this.setState('connected');
      }
    } catch (err) {
      this.setState('disconnected');
      throw err;
    }
  }

  private async startSerialReadLoop(): Promise<void> {
    try {
      while (this.serialReader) {
        const { value, done } = await this.serialReader.read();
        if (done) break;
        if (!value) continue;

        this.serialBuffer += value;
        const lines = this.serialBuffer.split(/\r?\n/);
        this.serialBuffer = lines.pop() || '';

        for (const line of lines) {
          const sensorData = parseTextDataLine(line);
          if (sensorData) {
            this.dataCallbacks.forEach(cb => cb(sensorData));
          }
        }
      }
    } catch (_) {
    } finally {
      this.setState('disconnected');
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.serialReader) {
        try {
          await this.serialReader.cancel();
          this.serialReader.releaseLock();
        } catch (_) {}
        this.serialReader = null;
      }

      if (this.serialPort) {
        try {
          await this.serialPort.close();
        } catch (_) {}
        this.serialPort = null;
      }

      if (this.characteristic) {
        this.characteristic.removeEventListener(
          'characteristicvaluechanged',
          this.handleNotification
        );
        try {
          await this.characteristic.stopNotifications();
        } catch (_) {}
        this.characteristic = null;
      }

      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect();
      }
    } catch (_) {
    } finally {
      this.device = null;
      this.serialPort = null;
      this.setState('disconnected');
    }
  }

  onData(callback: (data: SensorData) => void): void {
    this.dataCallbacks.add(callback);
  }

  offData(callback: (data: SensorData) => void): void {
    this.dataCallbacks.delete(callback);
  }

  getState(): ConnectionState {
    return this.state;
  }

  onStateChange(callback: (state: ConnectionState) => void): void {
    this.stateCallbacks.add(callback);
  }

  private setState(newState: ConnectionState): void {
    this.state = newState;
    this.stateCallbacks.forEach(cb => cb(newState));
  }

  private handleNotification = (event: Event): void => {
    const target = event.target as any;
    const value = target?.value;
    if (!value) return;

    const sensorData = parseBinaryPayload(value.buffer as ArrayBuffer);
    if (sensorData) {
      this.dataCallbacks.forEach(cb => cb(sensorData));
    }
  };

  private handleDisconnect = (): void => {
    this.characteristic = null;
    this.setState('disconnected');
  };
}

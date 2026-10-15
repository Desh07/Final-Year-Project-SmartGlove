// ─── React Native BLE Implementation (Android/iOS) ───
// Uses react-native-ble-plx for native BLE access
// Requires expo-dev-client (custom development build)

import {
  BLE_SERVICE_UUID,
  BLE_CHAR_UUID,
  BLE_DEVICE_NAME,
  parseBinaryPayload,
  type SensorData,
  type GloveDevice,
  type ConnectionState,
  type IGloveConnection,
} from './bleTypes';

// Conditionally import react-native-ble-plx (it won't exist on web)
let BleManager: any;
try {
  BleManager = require('react-native-ble-plx').BleManager;
} catch {
  // Silently fail on web — the NativeBleConnection class won't be used there
}

// Helper: decode base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];

  // Remove padding
  const cleaned = base64.replace(/[^A-Za-z0-9+/]/g, '');
  for (let i = 0; i < cleaned.length; i += 4) {
    const a = chars.indexOf(cleaned[i]);
    const b = chars.indexOf(cleaned[i + 1]);
    const c = chars.indexOf(cleaned[i + 2]);
    const d = chars.indexOf(cleaned[i + 3]);
    bytes.push((a << 2) | (b >> 4));
    if (c !== -1) bytes.push(((b & 15) << 4) | (c >> 2));
    if (d !== -1) bytes.push(((c & 3) << 6) | d);
  }

  const buffer = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(buffer);
  view.set(bytes);
  return buffer;
}

export class NativeBleConnection implements IGloveConnection {
  private manager: any = null;
  private connectedDevice: any = null;
  private state: ConnectionState = 'disconnected';
  private dataCallbacks: Set<(data: SensorData) => void> = new Set();
  private stateCallbacks: Set<(state: ConnectionState) => void> = new Set();
  private subscription: any = null;
  private scanSubscription: any = null;

  constructor() {
    if (BleManager) {
      this.manager = new BleManager();
    }
  }

  async scan(): Promise<GloveDevice[]> {
    if (!this.manager) {
      throw new Error('BLE not available on this platform');
    }

    this.setState('scanning');
    const devices: GloveDevice[] = [];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.manager.stopDeviceScan();
        this.setState('disconnected');
        resolve(devices);
      }, 10000); // 10 second scan timeout

      this.manager.startDeviceScan(
        [BLE_SERVICE_UUID],
        { allowDuplicates: false },
        (error: any, device: any) => {
          if (error) {
            clearTimeout(timeout);
            this.manager.stopDeviceScan();
            this.setState('disconnected');
            reject(error);
            return;
          }

          if (device && device.name?.startsWith(BLE_DEVICE_NAME)) {
            // Avoid duplicates
            if (!devices.some(d => d.id === device.id)) {
              devices.push({ id: device.id, name: device.name || BLE_DEVICE_NAME });
            }
          }
        }
      );
    });
  }

  async connect(deviceId: string): Promise<void> {
    if (!this.manager) {
      throw new Error('BLE not available');
    }

    this.setState('connecting');

    try {
      // Stop any ongoing scan
      this.manager.stopDeviceScan();

      // Connect to the device
      const device = await this.manager.connectToDevice(deviceId, {
        requestMTU: 185, // Request larger MTU for 88-byte payload
      });

      // Discover all services and characteristics
      await device.discoverAllServicesAndCharacteristics();

      this.connectedDevice = device;

      // Subscribe to the sensor data characteristic
      this.subscription = device.monitorCharacteristicForService(
        BLE_SERVICE_UUID,
        BLE_CHAR_UUID,
        (error: any, characteristic: any) => {
          if (error) {
            // Device disconnected
            if (error.message?.includes('disconnected')) {
              this.handleDisconnect();
            }
            return;
          }

          if (characteristic?.value) {
            const buffer = base64ToArrayBuffer(characteristic.value);
            const sensorData = parseBinaryPayload(buffer);
            if (sensorData) {
              this.dataCallbacks.forEach(cb => cb(sensorData));
            }
          }
        }
      );

      // Monitor device disconnection
      device.onDisconnected(() => {
        this.handleDisconnect();
      });

      this.setState('connected');
    } catch (err) {
      this.setState('disconnected');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.subscription) {
        this.subscription.remove();
        this.subscription = null;
      }

      if (this.connectedDevice) {
        await this.manager?.cancelDeviceConnection(this.connectedDevice.id);
        this.connectedDevice = null;
      }
    } catch (_) {
      // Best-effort cleanup
    } finally {
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

  // Clean up the BLE manager (call when app is closing)
  destroy(): void {
    this.manager?.destroy();
  }

  // ─── Private ───

  private setState(newState: ConnectionState): void {
    this.state = newState;
    this.stateCallbacks.forEach(cb => cb(newState));
  }

  private handleDisconnect = (): void => {
    this.subscription?.remove();
    this.subscription = null;
    this.connectedDevice = null;
    this.setState('disconnected');
  };
}

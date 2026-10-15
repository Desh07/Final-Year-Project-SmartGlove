// ─── Shared types for BLE connection ───

export type SensorData = {
  flex: number[];    // 10 values: RT, RI, RM, RR, RP, LT, LI, LM, LR, LP
  imu: number[];     // 12 values: aX1, aY1, aZ1, gX1, gY1, gZ1, aX2, aY2, aZ2, gX2, gY2, gZ2
  timestamp: number;
};

export type GloveDevice = {
  id: string;
  name: string;
};

export type ConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected';

export interface IGloveConnection {
  scan(): Promise<GloveDevice[]>;
  connect(deviceId: string): Promise<void>;
  disconnect(): Promise<void>;
  onData(callback: (data: SensorData) => void): void;
  offData(callback: (data: SensorData) => void): void;
  getState(): ConnectionState;
  onStateChange(callback: (state: ConnectionState) => void): void;
}

// ─── BLE GATT UUIDs (must match firmware) ───
export const BLE_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const BLE_CHAR_UUID    = '0000ffe1-0000-1000-8000-00805f9b34fb';
export const BLE_DEVICE_NAME  = 'HandGlow';

// ─── Finger & IMU channel names ───
export const FINGER_NAMES = ['RT', 'RI', 'RM', 'RR', 'RP', 'LT', 'LI', 'LM', 'LR', 'LP'] as const;
export const IMU_CHANNELS = ['aX1', 'aY1', 'aZ1', 'gX1', 'gY1', 'gZ1', 'aX2', 'aY2', 'aZ2', 'gX2', 'gY2', 'gZ2'] as const;

// ─── Parse the 88-byte binary payload from BLE ───
export function parseBinaryPayload(buffer: ArrayBuffer): SensorData | null {
  if (buffer.byteLength < 88) return null; // 22 floats × 4 bytes

  const view = new DataView(buffer);
  const flex: number[] = [];
  const imu: number[] = [];

  // First 10 floats = flex sensors
  for (let i = 0; i < 10; i++) {
    flex.push(view.getFloat32(i * 4, true)); // little-endian
  }

  // Next 12 floats = IMU data
  for (let i = 10; i < 22; i++) {
    imu.push(view.getFloat32(i * 4, true));
  }

  return { flex, imu, timestamp: Date.now() };
}

// ─── Parse the legacy text DATA line (for Serial/debug fallback) ───
export function parseTextDataLine(line: string): SensorData | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('DATA')) return null;

  const parts = trimmed.split(',');
  if (parts.length < 2) return null;

  const tokens = parts.slice(1);
  const flex: number[] = new Array(10).fill(0);
  const imu: number[] = new Array(12).fill(0);

  let imuStart = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].includes(':')) { imuStart = i; break; }
  }

  // Parse flex sensors (key:value pairs)
  const flexTokens = imuStart === -1 ? tokens : tokens.slice(0, imuStart);
  flexTokens.forEach(t => {
    const colonIdx = t.indexOf(':');
    if (colonIdx === -1) return;
    const label = t.slice(0, colonIdx).trim();
    const value = Number(t.slice(colonIdx + 1).trim());
    const idx = FINGER_NAMES.indexOf(label as any);
    if (idx !== -1 && Number.isFinite(value)) {
      flex[idx] = value;
    }
  });

  // Parse IMU values (positional)
  if (imuStart !== -1) {
    tokens.slice(imuStart).forEach((t, i) => {
      if (i < 12) {
        const v = Number(t.trim());
        imu[i] = Number.isFinite(v) ? v : 0;
      }
    });
  }

  return { flex, imu, timestamp: Date.now() };
}

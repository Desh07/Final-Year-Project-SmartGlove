// ─── React Hook for Glove BLE Data ───
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { SensorData, ConnectionState, GloveDevice, IGloveConnection, ConnectionType } from '../services/bleTypes';

// Factory: pick the right BLE implementation based on platform
function createConnection(): IGloveConnection {
  if (Platform.OS === 'web') {
    // Web Bluetooth / Web Serial
    const { WebBleConnection } = require('../services/bleConnection.web');
    return new WebBleConnection();
  } else {
    // react-native-ble-plx (Android/iOS)
    const { NativeBleConnection } = require('../services/bleConnection.native');
    return new NativeBleConnection();
  }
}

export function useGloveData() {
  const connectionRef = useRef<IGloveConnection | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [connectionType, setConnectionType] = useState<ConnectionType | null>(null);
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const [devices, setDevices] = useState<GloveDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sps, setSps] = useState(0);
  const spsCounterRef = useRef(0);

  // Initialize connection once
  useEffect(() => {
    const conn = createConnection();
    connectionRef.current = conn;

    conn.onStateChange((state) => {
      setConnectionState(state);
      if (state === 'disconnected') {
        setSensorData(null);
        setSps(0);
        spsCounterRef.current = 0;
        setConnectionType(null);
      } else if (state === 'connected' && conn.getConnectionType) {
        setConnectionType(conn.getConnectionType());
      }
    });

    // SPS (samples per second) counter
    const spsInterval = setInterval(() => {
      setSps(spsCounterRef.current);
      spsCounterRef.current = 0;
    }, 1000);

    return () => {
      clearInterval(spsInterval);
      conn.disconnect().catch(() => {});
      if ('destroy' in conn) {
        (conn as any).destroy();
      }
    };
  }, []);

  // Data handler (stable ref)
  const handleData = useCallback((data: SensorData) => {
    setSensorData(data);
    spsCounterRef.current++;
  }, []);

  // Subscribe to data when connected
  useEffect(() => {
    const conn = connectionRef.current;
    if (!conn) return;

    conn.onData(handleData);
    return () => {
      conn.offData(handleData);
    };
  }, [handleData]);

  const scan = useCallback(async (mode?: ConnectionType) => {
    const conn = connectionRef.current;
    if (!conn) return;

    setError(null);
    try {
      const found = await conn.scan(mode);
      setDevices(found);

      // On Web, scan() returns the selected device and we auto-connect
      if (Platform.OS === 'web' && found.length > 0) {
        await conn.connect(found[0].id);
        if (conn.getConnectionType) {
          setConnectionType(conn.getConnectionType());
        }
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed');
    }
  }, []);

  const connect = useCallback(async (deviceId: string) => {
    const conn = connectionRef.current;
    if (!conn) return;

    setError(null);
    try {
      await conn.connect(deviceId);
      if (conn.getConnectionType) {
        setConnectionType(conn.getConnectionType());
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed');
    }
  }, []);

  const disconnect = useCallback(async () => {
    const conn = connectionRef.current;
    if (!conn) return;

    setError(null);
    try {
      await conn.disconnect();
      setConnectionType(null);
    } catch (err: any) {
      setError(err.message || 'Disconnect failed');
    }
  }, []);

  return {
    connectionState,
    connectionType,
    sensorData,
    devices,
    sps,
    error,
    scan,
    connect,
    disconnect,
    isConnected: connectionState === 'connected',
    isScanning: connectionState === 'scanning',
  };
}

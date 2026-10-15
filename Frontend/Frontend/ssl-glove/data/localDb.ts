import AsyncStorage from '@react-native-async-storage/async-storage';

type SettingsMap = Record<string, string>;
type CachedPhrasesMap = Record<string, string[]>;

type GestureEntry = {
  language: string;
  phrase: string;
  createdAt: string;
};

type SensorEntry = {
  payload: string;
  createdAt: string;
};

const SETTINGS_KEY = 'localdb:settings';
const CACHED_PHRASES_KEY = 'localdb:cachedPhrases';
const GESTURE_HISTORY_KEY = 'localdb:gestureHistory';
const SENSOR_DATA_KEY = 'localdb:sensorData';
const MAX_HISTORY = 200;

const readJson = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch (error) {
    return fallback;
  }
};

const writeJson = async (key: string, value: unknown) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Non-blocking fallback write.
  }
};

export const initLocalDb = async () => {
  await writeJson(SETTINGS_KEY, await readJson(SETTINGS_KEY, {}));
  await writeJson(CACHED_PHRASES_KEY, await readJson(CACHED_PHRASES_KEY, {}));
  await writeJson(GESTURE_HISTORY_KEY, await readJson(GESTURE_HISTORY_KEY, []));
  await writeJson(SENSOR_DATA_KEY, await readJson(SENSOR_DATA_KEY, []));
};

export const getSettings = async (): Promise<SettingsMap> => {
  return readJson<SettingsMap>(SETTINGS_KEY, {});
};

export const saveSettings = async (settings: SettingsMap) => {
  await writeJson(SETTINGS_KEY, settings);
};

export const getCachedPhrases = async (): Promise<CachedPhrasesMap> => {
  return readJson<CachedPhrasesMap>(CACHED_PHRASES_KEY, {});
};

export const saveCachedPhrases = async (phrases: CachedPhrasesMap) => {
  await writeJson(CACHED_PHRASES_KEY, phrases);
};

export const insertGestureHistory = async (language: string, phrase: string) => {
  const createdAt = new Date().toISOString();
  const existing = await readJson<GestureEntry[]>(GESTURE_HISTORY_KEY, []);
  const next = [...existing, { language, phrase, createdAt }].slice(-MAX_HISTORY);
  await writeJson(GESTURE_HISTORY_KEY, next);
};

export const insertSensorData = async (payload: string) => {
  const createdAt = new Date().toISOString();
  const existing = await readJson<SensorEntry[]>(SENSOR_DATA_KEY, []);
  const next = [...existing, { payload, createdAt }].slice(-MAX_HISTORY);
  await writeJson(SENSOR_DATA_KEY, next);
};

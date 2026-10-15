// ─── Calibration Service ───
// Captures baseline sensor values and computes normalization ranges

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CalibrationData } from './inference';

const CALIBRATION_STORAGE_KEY = 'handglow:calibration';

export type CalibrationStep =
  | 'idle'
  | 'open_hand'      // Step 1: Open hand (rest baseline)
  | 'full_fist'      // Step 2: Full fist (bent baseline)
  | 'individual'     // Step 3: Individual fingers (10 sub-steps)
  | 'orientations'   // Step 4: Hand orientations
  | 'complete';

export type CalibrationProgress = {
  step: CalibrationStep;
  subStep: number;          // For individual fingers (0-9) or orientations (0-3)
  totalSubSteps: number;
  countdown: number;        // Seconds remaining for current step
  fingerLabel: string;      // Current finger being calibrated (e.g., "RT")
  message: string;          // Instruction text
};

const FINGER_LABELS = ['RT', 'RI', 'RM', 'RR', 'RP', 'LT', 'LI', 'LM', 'LR', 'LP'];
const FINGER_NAMES = [
  'Right Thumb', 'Right Index', 'Right Middle', 'Right Ring', 'Right Pinky',
  'Left Thumb', 'Left Index', 'Left Middle', 'Left Ring', 'Left Pinky',
];

const STEP_DURATION_MS = 5000; // 5 seconds per step

export class CalibrationEngine {
  private samples: { flex: number[][]; imu: number[][] } = { flex: [], imu: [] };
  private restValues: number[] = new Array(10).fill(0);
  private bentValues: number[] = new Array(10).fill(0);
  private fingerRest: number[][] = [];
  private fingerBent: number[][] = [];
  private gyroSamples: number[][] = [];

  // ─── Collect Samples ───

  /** Add a sensor reading during calibration */
  addSample(flex: number[], imu: number[]): void {
    this.samples.flex.push([...flex]);
    this.samples.imu.push([...imu]);
  }

  /** Clear collected samples (call between steps) */
  clearSamples(): void {
    this.samples = { flex: [], imu: [] };
  }

  // ─── Step Processing ───

  /** Process Step 1: Open Hand — compute rest baselines */
  processOpenHand(): void {
    if (this.samples.flex.length === 0) return;
    this.restValues = this.averageFlexSamples();
  }

  /** Process Step 2: Full Fist — compute bent baselines */
  processFullFist(): void {
    if (this.samples.flex.length === 0) return;
    this.bentValues = this.averageFlexSamples();
  }

  /** Process Step 3 sub-step: Individual finger */
  processIndividualFinger(fingerIndex: number): void {
    if (this.samples.flex.length === 0) return;
    const avg = this.averageFlexSamples();
    // Store as refinement data
    while (this.fingerRest.length <= fingerIndex) {
      this.fingerRest.push([]);
      this.fingerBent.push([]);
    }
    this.fingerBent[fingerIndex] = avg;
  }

  /** Process Step 4: Orientations — compute gyro offsets */
  processOrientation(): void {
    if (this.samples.imu.length === 0) return;
    // Collect gyro data for offset calculation
    const avgImu = this.averageImuSamples();
    this.gyroSamples.push(avgImu);
  }

  // ─── Finalize ───

  /** Build the final calibration data object */
  buildCalibrationData(): CalibrationData {
    const fingers: CalibrationData['fingers'] = {};

    for (let i = 0; i < 10; i++) {
      const label = FINGER_LABELS[i];
      const rest = this.restValues[i] ?? 0;
      const bent = this.bentValues[i] ?? 0;

      fingers[label] = {
        rest,
        bent,
        restResistance: rest,
        bentResistance: bent,
        range: Math.abs(bent - rest),
      };
    }

    // Compute gyro offsets from orientation samples
    const gyroOffset: Record<string, number> = {};
    if (this.gyroSamples.length > 0) {
      const avgGyro = new Array(12).fill(0);
      this.gyroSamples.forEach(sample => {
        sample.forEach((v, i) => { avgGyro[i] += v; });
      });
      avgGyro.forEach((v, i) => { avgGyro[i] /= this.gyroSamples.length; });

      // Gyro offsets (indices 3-5 for MPU1, 9-11 for MPU2)
      gyroOffset['gX'] = avgGyro[3];
      gyroOffset['gY'] = avgGyro[4];
      gyroOffset['gZ'] = avgGyro[5];
    }

    const calData: CalibrationData = {
      fingers,
      imu: {
        mpu1: { gyroOffset: { gX: gyroOffset['gX'] ?? 0, gY: gyroOffset['gY'] ?? 0, gZ: gyroOffset['gZ'] ?? 0 } },
        mpu2: { gyroOffset: { gX: 0, gY: 0, gZ: 0 } },
      },
    };

    return calData;
  }

  /** Reset all calibration data */
  reset(): void {
    this.samples = { flex: [], imu: [] };
    this.restValues = new Array(10).fill(0);
    this.bentValues = new Array(10).fill(0);
    this.fingerRest = [];
    this.fingerBent = [];
    this.gyroSamples = [];
  }

  // ─── Private Helpers ───

  private averageFlexSamples(): number[] {
    const count = this.samples.flex.length;
    if (count === 0) return new Array(10).fill(0);

    const sums = new Array(10).fill(0);
    this.samples.flex.forEach(sample => {
      sample.forEach((v, i) => { sums[i] += v; });
    });
    return sums.map(s => s / count);
  }

  private averageImuSamples(): number[] {
    const count = this.samples.imu.length;
    if (count === 0) return new Array(12).fill(0);

    const sums = new Array(12).fill(0);
    this.samples.imu.forEach(sample => {
      sample.forEach((v, i) => { sums[i] += v; });
    });
    return sums.map(s => s / count);
  }
}

// ─── Persistence ───

export async function saveCalibration(data: CalibrationData): Promise<void> {
  await AsyncStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(data));
}

export async function loadCalibration(): Promise<CalibrationData | null> {
  try {
    const raw = await AsyncStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CalibrationData;
  } catch {
    return null;
  }
}

export async function clearCalibration(): Promise<void> {
  await AsyncStorage.removeItem(CALIBRATION_STORAGE_KEY);
}

export { FINGER_LABELS, FINGER_NAMES, STEP_DURATION_MS };

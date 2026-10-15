// ─── Pure JS Neural Network Inference Engine ───
// Ported from live_sign_reader.html — no TensorFlow.js dependency
// Loads the handglow_mlp_v1 model format

export type ModelData = {
  format: string;
  labels: string[];
  n_features: number;
  feature_names: string[];
  normalization: {
    mean: number[];
    std: number[];
  };
  layers: LayerData[];
  accuracy?: number;
};

type LayerData = {
  weights: number[][];
  bias: number[];
  activation?: string;
  bn?: {
    gamma: number[];
    beta: number[];
    mean: number[];
    var: number[];
    eps: number;
  };
};

export type PredictionResult = {
  sign: string;
  confidence: number;
  probs: number[];
  top5: { label: string; probability: number }[];
  gyroMag: number;
  isStill: boolean;
};

export type CalibrationData = {
  fingers: Record<string, {
    rest?: number;
    bent?: number;
    restResistance?: number;
    bentResistance?: number;
    range?: number;
  }>;
  imu?: {
    mpu1?: { gyroOffset?: Record<string, number> };
    mpu2?: { gyroOffset?: Record<string, number> };
  };
};

// ─── Feature Name Mapping ───
const FINGER_FEATURE_NAMES = [
  'R.Thumb', 'R.Index', 'R.Middle', 'R.Ring', 'R.Pinky',
  'L.Thumb', 'L.Index', 'L.Middle', 'L.Ring', 'L.Pinky',
];
const FINGER_LABELS = ['RT', 'RI', 'RM', 'RR', 'RP', 'LT', 'LI', 'LM', 'LR', 'LP'];
const IMU_NAMES = ['aX1', 'aY1', 'aZ1', 'gX1', 'gY1', 'gZ1', 'aX2', 'aY2', 'aZ2', 'gX2', 'gY2', 'gZ2'];

// ─── Linear Algebra Primitives ───

function matmul(input: number[], weights: number[][], bias: number[]): Float32Array {
  const nOut = bias.length;
  const result = new Float32Array(nOut);
  for (let j = 0; j < nOut; j++) {
    let sum = bias[j];
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * weights[i][j];
    }
    result[j] = sum;
  }
  return result;
}

function batchNorm(x: Float32Array, bn: LayerData['bn']): Float32Array {
  if (!bn) return x;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    out[i] = bn.gamma[i] * (x[i] - bn.mean[i]) / Math.sqrt(bn.var[i] + bn.eps) + bn.beta[i];
  }
  return out;
}

function relu(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    out[i] = Math.max(0, x[i]);
  }
  return out;
}

function softmax(x: Float32Array): number[] {
  const max = Math.max(...Array.from(x));
  const exp = Array.from(x).map(v => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map(v => v / sum);
}

// ─── Inference Engine Class ───

export class InferenceEngine {
  private model: ModelData | null = null;
  private featureEMA: number[] | null = null;
  private probEMA: number[] | null = null;

  loadModel(modelJson: ModelData): void {
    if (modelJson.format !== 'handglow_mlp_v1') {
      throw new Error(`Unsupported model format: ${modelJson.format}`);
    }
    this.model = modelJson;
    this.featureEMA = null;
    this.probEMA = null;
  }

  isLoaded(): boolean {
    return this.model !== null;
  }

  getLabels(): string[] {
    return this.model?.labels || [];
  }

  getAccuracy(): number {
    return this.model?.accuracy || 0;
  }

  // ─── Normalize a raw flex sensor value using calibration data ───
  normalizeFlex(label: string, raw: number, cal: CalibrationData | null): number {
    if (!cal?.fingers?.[label]) return raw / 4095;

    const f = cal.fingers[label];
    const rest = f.restResistance ?? f.rest ?? 0;
    const bent = f.bentResistance ?? f.bent ?? 0;
    const range = f.range ?? Math.abs(bent - rest);
    if (range === 0) return 0;
    return Math.max(0, Math.min(1, (raw - rest) / (bent - rest)));
  }

  // ─── Correct gyro readings using calibration offsets ───
  correctGyro(channel: string, raw: number, cal: CalibrationData | null): number {
    if (!cal?.imu) return raw;
    const mpu = channel.endsWith('1') ? 'mpu1' : 'mpu2';
    const axis = channel.slice(0, 2);
    const offset = cal.imu?.[mpu as 'mpu1' | 'mpu2']?.gyroOffset?.[axis] ?? 0;
    return raw - offset;
  }

  // ─── Run inference on sensor data ───
  predict(
    flex: number[],   // 10 raw flex values
    imu: number[],    // 12 IMU values
    cal: CalibrationData | null,
    handMode: 'right' | 'left' | 'both' = 'right'
  ): PredictionResult | null {
    if (!this.model) return null;

    // Build feature dictionary
    const dict: Record<string, number> = {};

    // Normalize flex sensors
    FINGER_LABELS.forEach((label, i) => {
      const name = FINGER_FEATURE_NAMES[i];
      dict[name] = this.normalizeFlex(label, flex[i] ?? 0, cal);
    });

    // Accel values (direct)
    ['aX1', 'aY1', 'aZ1', 'aX2', 'aY2', 'aZ2'].forEach((c, i) => {
      dict[c] = imu[IMU_NAMES.indexOf(c)] ?? 0;
    });

    // Gyro values (with calibration correction)
    ['gX1', 'gY1', 'gZ1', 'gX2', 'gY2', 'gZ2'].forEach(c => {
      dict[c] = this.correctGyro(c, imu[IMU_NAMES.indexOf(c)] ?? 0, cal);
    });

    // Extract features in the order the model expects
    let features: number[];
    if (this.model.feature_names) {
      features = this.model.feature_names.map(name => {
        const val = dict[name];
        return (val === undefined || isNaN(val)) ? 0 : val;
      });
    } else {
      features = [
        ...FINGER_FEATURE_NAMES.map(n => dict[n] ?? 0),
        ...IMU_NAMES.map(n => dict[n] ?? 0),
      ];
    }

    // Feature EMA smoothing (combat sensor jitter)
    if (!this.featureEMA || this.featureEMA.length !== features.length) {
      this.featureEMA = [...features];
    } else {
      const F_ALPHA = 0.15;
      this.featureEMA = this.featureEMA.map((f, i) => f * (1 - F_ALPHA) + features[i] * F_ALPHA);
    }
    features = [...this.featureEMA];

    // Apply StandardScaler normalization
    if (this.model.normalization) {
      const { mean, std } = this.model.normalization;
      if (mean && std) {
        features = features.map((v, i) => (v - mean[i]) / (std[i] || 1));
      }
    }

    // Forward pass through the neural network
    const probsRaw = this.forwardPass(features);

    // Probability EMA smoothing
    if (!this.probEMA || this.probEMA.length !== probsRaw.length) {
      this.probEMA = [...probsRaw];
    } else {
      const P_ALPHA = 0.15;
      this.probEMA = this.probEMA.map((p, i) => p * (1 - P_ALPHA) + probsRaw[i] * P_ALPHA);
    }

    const probs = this.probEMA;
    const bestIdx = probs.indexOf(Math.max(...probs));

    // Calculate gyro magnitude for stillness check
    const gX1 = imu[3] ?? 0, gY1 = imu[4] ?? 0, gZ1 = imu[5] ?? 0;
    const gX2 = imu[9] ?? 0, gY2 = imu[10] ?? 0, gZ2 = imu[11] ?? 0;
    const magR = Math.sqrt(gX1 ** 2 + gY1 ** 2 + gZ1 ** 2);
    const magL = Math.sqrt(gX2 ** 2 + gY2 ** 2 + gZ2 ** 2);

    let gyroMag = magR;
    if (handMode === 'left') gyroMag = magL;
    if (handMode === 'both') gyroMag = Math.max(magR, magL);

    // Top 5 predictions
    const top5 = probs
      .map((p, i) => ({ label: this.model!.labels[i], probability: p }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 5);

    return {
      sign: this.model.labels[bestIdx],
      confidence: probs[bestIdx],
      probs,
      top5,
      gyroMag,
      isStill: gyroMag < 10,
    };
  }

  // Reset smoothing state (call when reconnecting)
  reset(): void {
    this.featureEMA = null;
    this.probEMA = null;
  }

  // ─── Private: Forward Pass ───
  private forwardPass(features: number[]): number[] {
    if (!this.model) return [];

    let x: number[] | Float32Array = features;
    for (const layer of this.model.layers) {
      x = matmul(Array.from(x), layer.weights, layer.bias);
      if (layer.bn) x = batchNorm(x as Float32Array, layer.bn);
      if (layer.activation === 'relu') x = relu(x as Float32Array);
      else if (layer.activation === 'softmax') {
        return softmax(x as Float32Array);
      }
    }
    return Array.from(x);
  }
}

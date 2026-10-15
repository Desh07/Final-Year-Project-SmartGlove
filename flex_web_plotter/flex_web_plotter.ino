// ============================================================
// HandGlow Firmware v3.0 — BLE + Multiplexer + Dual MPU6050
// ============================================================
// COMMUNICATION:
//   BLE GATT Server — Service 0xFFE0, Characteristic 0xFFE1 (Notify)
//   Also outputs to Serial for debugging
//
// --- CD74HC4067 16-Channel Multiplexer ---
// S0=GPIO25, S1=GPIO26, S2=GPIO27, S3=GPIO14, SIG=GPIO36 (ADC1!)
// Channels 15-6 → 10 flex sensors (Right: 15-11, Left: 10-6)
//
// --- MPU6050 I2C Addresses ---
// Right Hand MPU: AD0 → 3V3 → address 0x69
// Left  Hand MPU: AD0 → GND → address 0x68
//
// --- BLE Binary Payload (88 bytes) ---
// 10 × float (flex sensors) + 12 × float (IMU) = 22 floats × 4 bytes
// ============================================================

#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ─── BLE Config ───
#define BLE_DEVICE_NAME    "HandGlow"
#define SERVICE_UUID       "0000ffe0-0000-1000-8000-00805f9b34fb"
#define CHAR_UUID          "0000ffe1-0000-1000-8000-00805f9b34fb"

BLEServer*         pServer         = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
bool               bleConnected    = false;
bool               oldConnected    = false;

// BLE connection callbacks
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    bleConnected = true;
    Serial.println("[BLE] Client connected");
  }
  void onDisconnect(BLEServer* pServer) override {
    bleConnected = false;
    Serial.println("[BLE] Client disconnected");
  }
};

// ─── MPU6050 Addresses ───
const uint8_t MPU_RIGHT = 0x69;  // Right hand (AD0 → 3V3)
const uint8_t MPU_LEFT  = 0x68;  // Left hand  (AD0 → GND)

// ─── CD74HC4067 Multiplexer Pins ───
// IMPORTANT: SIG must be on ADC1 (GPIO 32-39) because ADC2 doesn't work with BLE/WiFi
const int MUX_S0  = 25;   // Channel select bit 0
const int MUX_S1  = 26;   // Channel select bit 1
const int MUX_S2  = 27;   // Channel select bit 2
const int MUX_S3  = 14;   // Channel select bit 3
const int MUX_SIG = 36;   // Analog input (VP pin, ADC1_CH0)

// ─── Flex Sensor → Mux Channel Mapping ───
const int numFlexSensors = 10;

// Which mux channel (0-15) maps to which finger
const int fingerChannel[numFlexSensors] = {
  15,  // Right Thumb
  14,  // Right Index
  13,  // Right Middle
  12,  // Right Ring
  11,  // Right Pinky
  10,  // Left Thumb
  9,   // Left Index
  8,   // Left Middle
  7,   // Left Ring
  6    // Left Pinky
};

const char* fingerNames[numFlexSensors] = {
  "RT", "RI", "RM", "RR", "RP",
  "LT", "LI", "LM", "LR", "LP"
};

// ─── Smoothing (EMA Filter) ───
const float alpha = 0.15;
float smoothedValues[numFlexSensors];

// ─── Sampling Rate ───
const unsigned long SAMPLE_INTERVAL_MS = 40;  // 25 Hz
unsigned long lastSampleTime = 0;

// ─── IMU Data Structure ───
struct IMUData {
  float ax, ay, az;  // Accelerometer in g
  float gx, gy, gz;  // Gyroscope in °/s
  bool ok;           // true if read succeeded
};

// ─── MPU6050 Status ───
bool mpuRightOk = false;
bool mpuLeftOk  = false;

// ─── LED for status indication ───
const int LED_PIN = 2;  // Built-in LED on most ESP32 boards

// ============================================================
// Read a specific multiplexer channel
// ============================================================
int readMuxChannel(int channel) {
  // Set the 4-bit address
  digitalWrite(MUX_S0, (channel >> 0) & 1);
  digitalWrite(MUX_S1, (channel >> 1) & 1);
  digitalWrite(MUX_S2, (channel >> 2) & 1);
  digitalWrite(MUX_S3, (channel >> 3) & 1);

  // Let the mux settle (CD74HC4067 switching time is ~70ns, 5µs is very safe)
  delayMicroseconds(5);

  return analogRead(MUX_SIG);
}

// ============================================================
// Initialize a single MPU6050
// ============================================================
bool initMPU(uint8_t addr) {
  // Wake up MPU6050 (clear sleep bit)
  Wire.beginTransmission(addr);
  Wire.write(0x6B);  // PWR_MGMT_1
  Wire.write(0x00);  // Wake up
  if (Wire.endTransmission(true) != 0) return false;

  delay(10);

  // Set accelerometer range to ±4g
  Wire.beginTransmission(addr);
  Wire.write(0x1C);  // ACCEL_CONFIG
  Wire.write(0x08);  // ±4g (AFS_SEL = 1)
  Wire.endTransmission(true);

  // Set gyroscope range to ±250°/s (most sensitive)
  Wire.beginTransmission(addr);
  Wire.write(0x1B);  // GYRO_CONFIG
  Wire.write(0x00);  // ±250°/s (FS_SEL = 0)
  Wire.endTransmission(true);

  // Set Digital Low Pass Filter for smoother readings
  Wire.beginTransmission(addr);
  Wire.write(0x1A);  // CONFIG
  Wire.write(0x03);  // DLPF ~44Hz bandwidth (good for hand gestures)
  Wire.endTransmission(true);

  return true;
}

// ============================================================
// Read full IMU data (accel + gyro) from MPU6050
// ============================================================
IMUData readIMU(uint8_t addr) {
  IMUData d = {0, 0, 0, 0, 0, 0, false};

  Wire.beginTransmission(addr);
  Wire.write(0x3B);  // Start at ACCEL_XOUT_H
  if (Wire.endTransmission(false) != 0) return d;

  Wire.requestFrom(addr, (uint8_t)14, (uint8_t)true);
  if (Wire.available() < 14) return d;

  // Accelerometer raw (±4g range → 8192 LSB/g)
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();

  // Temperature (skip 2 bytes)
  Wire.read(); Wire.read();

  // Gyroscope raw (±250°/s range → 131 LSB/°/s)
  int16_t gx = (Wire.read() << 8) | Wire.read();
  int16_t gy = (Wire.read() << 8) | Wire.read();
  int16_t gz = (Wire.read() << 8) | Wire.read();

  // Convert to physical units
  d.ax = ax / 8192.0f;   // g
  d.ay = ay / 8192.0f;
  d.az = az / 8192.0f;
  d.gx = gx / 131.0f;    // °/s
  d.gy = gy / 131.0f;
  d.gz = gz / 131.0f;
  d.ok = true;
  return d;
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("HandGlow v3.0 — BLE + Mux + Dual MPU6050");
  Serial.println("==========================================");

  // ── LED ──
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // ── Multiplexer control pins ──
  pinMode(MUX_S0, OUTPUT);
  pinMode(MUX_S1, OUTPUT);
  pinMode(MUX_S2, OUTPUT);
  pinMode(MUX_S3, OUTPUT);
  // MUX_SIG is analog input, no pinMode needed

  // Pre-fill smoothing array by reading each mux channel
  for (int i = 0; i < numFlexSensors; i++) {
    smoothedValues[i] = readMuxChannel(fingerChannel[i]);
  }

  // ── I2C ──
  Wire.begin(21, 22);  // SDA=21, SCL=22 (ESP32 default)
  Wire.setClock(400000); // 400kHz fast mode

  delay(100);  // Let MPUs power up

  // ── Initialize MPU6050 sensors ──
  mpuRightOk = initMPU(MPU_RIGHT);
  mpuLeftOk  = initMPU(MPU_LEFT);

  Serial.print("MPU Right (0x69): ");
  Serial.println(mpuRightOk ? "OK" : "FAIL");
  Serial.print("MPU Left  (0x68): ");
  Serial.println(mpuLeftOk ? "OK" : "FAIL");
  Serial.print("Mux SIG pin: GPIO");
  Serial.print(MUX_SIG);
  Serial.println(" (ADC1)");

  // ── Initialize BLE ──
  Serial.println("[BLE] Initializing...");
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEDevice::setMTU(128);  // Ensure MTU fits 88-byte payload

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
    CHAR_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_NOTIFY
  );

  // Add the BLE2902 descriptor for notifications
  pCharacteristic->addDescriptor(new BLE2902());

  pService->start();

  // Start advertising
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);  // Helps with iOS/Web connection
  pAdvertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising as '" BLE_DEVICE_NAME "'");
  Serial.println("[BLE] Dual-mode active: Streaming via USB Serial (115200) + BLE");
  Serial.println("[BLE] Waiting for client...");

  // Print header for serial debug
  Serial.print("DATA");
  for (int i = 0; i < numFlexSensors; i++) {
    Serial.print(",");
    Serial.print(fingerNames[i]);
    Serial.print("(MUX:");
    Serial.print(fingerChannel[i]);
    Serial.print(")");
  }
  Serial.print(",aX1,aY1,aZ1,gX1,gY1,gZ1");
  Serial.print(",aX2,aY2,aZ2,gX2,gY2,gZ2");
  Serial.println();

  lastSampleTime = millis();
}

// ============================================================
// LOOP — runs at 25 Hz (40ms intervals)
// ============================================================
void loop() {
  // ── Process incoming serial commands ──
  while (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd == "PING") {
      Serial.println("PONG");
    } else if (cmd == "STATUS") {
      Serial.print("STATUS,BLE:");
      Serial.print(bleConnected ? "1" : "0");
      Serial.print(",MPU_R:");
      Serial.print(mpuRightOk ? "1" : "0");
      Serial.print(",MPU_L:");
      Serial.println(mpuLeftOk ? "1" : "0");
    }
  }

  unsigned long now = millis();
  if (now - lastSampleTime < SAMPLE_INTERVAL_MS) return;
  lastSampleTime = now;

  // ── LED: solid when BLE connected, heartbeat when on USB Serial only ──
  if (bleConnected) {
    digitalWrite(LED_PIN, HIGH);
  } else {
    digitalWrite(LED_PIN, (now % 1000 < 100) ? HIGH : LOW);
  }

  // ── Binary payload for BLE: 22 floats = 88 bytes ──
  float payload[22];

  // ── Read Flex Sensors via Multiplexer ──
  Serial.print("DATA");
  for (int i = 0; i < numFlexSensors; i++) {
    int rawValue = readMuxChannel(fingerChannel[i]);

    // Apply EMA smoothing
    smoothedValues[i] = (alpha * rawValue) + ((1.0 - alpha) * smoothedValues[i]);

    payload[i] = smoothedValues[i];

    // Serial debug output
    Serial.print(",");
    Serial.print(fingerNames[i]);
    Serial.print(":");
    Serial.print((int)smoothedValues[i]);
  }

  // ── Read Right Hand IMU (MPU1 @ 0x69) ──
  IMUData imu1 = {0, 0, 0, 0, 0, 0, false};
  if (mpuRightOk) {
    imu1 = readIMU(MPU_RIGHT);
  }

  if (imu1.ok) {
    payload[10] = imu1.ax;
    payload[11] = imu1.ay;
    payload[12] = imu1.az;
    payload[13] = imu1.gx;
    payload[14] = imu1.gy;
    payload[15] = imu1.gz;
  } else {
    for (int i = 10; i < 16; i++) payload[i] = 0;
  }

  // Serial debug for right IMU
  Serial.print(",");
  if (imu1.ok) {
    Serial.print(imu1.ax, 3); Serial.print(",");
    Serial.print(imu1.ay, 3); Serial.print(",");
    Serial.print(imu1.az, 3); Serial.print(",");
    Serial.print(imu1.gx, 2); Serial.print(",");
    Serial.print(imu1.gy, 2); Serial.print(",");
    Serial.print(imu1.gz, 2);
  } else {
    Serial.print("nan,nan,nan,nan,nan,nan");
  }

  // ── Read Left Hand IMU (MPU2 @ 0x68) ──
  IMUData imu2 = {0, 0, 0, 0, 0, 0, false};
  if (mpuLeftOk) {
    imu2 = readIMU(MPU_LEFT);
  }

  if (imu2.ok) {
    payload[16] = imu2.ax;
    payload[17] = imu2.ay;
    payload[18] = imu2.az;
    payload[19] = imu2.gx;
    payload[20] = imu2.gy;
    payload[21] = imu2.gz;
  } else {
    for (int i = 16; i < 22; i++) payload[i] = 0;
  }

  // Serial debug for left IMU
  Serial.print(",");
  if (imu2.ok) {
    Serial.print(imu2.ax, 3); Serial.print(",");
    Serial.print(imu2.ay, 3); Serial.print(",");
    Serial.print(imu2.az, 3); Serial.print(",");
    Serial.print(imu2.gx, 2); Serial.print(",");
    Serial.print(imu2.gy, 2); Serial.print(",");
    Serial.print(imu2.gz, 2);
  } else {
    Serial.print("nan,nan,nan,nan,nan,nan");
  }

  Serial.println();

  // ── Send via BLE if connected ──
  if (bleConnected) {
    pCharacteristic->setValue((uint8_t*)payload, sizeof(payload));
    pCharacteristic->notify();
  }

  // ── Handle BLE reconnection ──
  // If client disconnects, restart advertising so a new client can connect
  if (!bleConnected && oldConnected) {
    delay(500);  // Give BLE stack time to settle
    pServer->startAdvertising();
    Serial.println("[BLE] Restarted advertising");
  }
  oldConnected = bleConnected;
}
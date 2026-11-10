#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h> 
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <WiFiManager.h> 
#include <Ticker.h> 

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
Adafruit_SH1106G display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// --- HARDWARE UI PINS ---
const int buttonPin = 25;
const int ledPin = 26;

// --- MQTT BROKER DETAILS ---
const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;
const char* mqtt_topic = "smartmeter/nazrul_final/raw";

WiFiClient espClient;
PubSubClient client(espClient);

// --- SENSOR PINS & CALIBRATION ---
const int acsPin = 34;
const int zmptPin = 35;

long adcOffsetZMPT = 0;
long adcOffsetACS = 0;

// MULTIPLIERS
const float voltageMultiplier = 0.795; 
const float currentMultiplier = 0.01094;

float smoothedVoltage = 0;
float smoothedCurrent = 0;

// --- SYSTEM STATES ---
enum SystemState { CONNECTING, ONLINE, AP_MODE };
SystemState currentState = CONNECTING;

// --- UI STATE ---
int displayPage = 0; // 0 = Live Data, 1 = System Info

// --- TIMERS & BACKGROUND TASKS ---
unsigned long lastMsgTime = 0;
unsigned long lastWiFiReconnectAttempt = 0; 
const long interval = 1000;
Ticker ledTicker; 

// --- BUTTON LOGIC VARIABLES ---
unsigned long buttonPressTime = 0;
bool buttonPressed = false;
bool longPressHandled = false;

void toggleLED() {
  digitalWrite(ledPin, !digitalRead(ledPin)); 
}

void startSetupMode() {
  Serial.println("MANUAL WIFI SETUP TRIGGERED");
  currentState = AP_MODE;

  ledTicker.attach(1.0, toggleLED);

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE); 
  display.setCursor(0, 0);
  display.println("WIFI SETUP MODE");
  display.drawLine(0, 10, 128, 10, SH110X_WHITE); 
  display.setCursor(0, 25);
  display.println("Connect phone to:");
  display.setCursor(0, 40);
  display.println("SmartMeter_Nazrul");
  display.display();

  WiFiManager wifiManager;
  wifiManager.startConfigPortal("SmartMeter_Nazrul");

  display.clearDisplay();
  display.setCursor(0, 25);
  display.println("Saved! Rebooting...");
  display.display();
  delay(1000);
  ESP.restart(); 
}

void handleButton() {
  bool currentReading = (digitalRead(buttonPin) == LOW); 

  if (currentReading && !buttonPressed) {
    buttonPressTime = millis();
    buttonPressed = true;
    longPressHandled = false;
  } 
  else if (currentReading && buttonPressed) {
    unsigned long duration = millis() - buttonPressTime;
    if (duration >= 5000 && !longPressHandled) {
      longPressHandled = true;
      startSetupMode(); 
    }
  } 
  else if (!currentReading && buttonPressed) {
    buttonPressed = false;
    unsigned long duration = millis() - buttonPressTime;
    // SHORT PRESS: Toggle Display Page
    if (duration < 1000 && duration > 50 && !longPressHandled) {
      displayPage = !displayPage; // Flip between 0 and 1
      display.clearDisplay();     // Force a clear so it redraws instantly
      Serial.print("Screen toggled to page: ");
      Serial.println(displayPage);
    }
  }
}

void reconnectMQTT() {
  Serial.print("Attempting MQTT connection...");
  String clientId = "ESP32Client-FYP-";
  clientId += String(random(0xffff), HEX);
  if (client.connect(clientId.c_str())) {
    Serial.println("connected");
  } else {
    Serial.println("failed, will aggressively retry...");
    delay(500); 
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(ledPin, OUTPUT);
  pinMode(buttonPin, INPUT_PULLUP); 

  if(!display.begin(0x3C, true)) {
    Serial.println("OLED allocation failed");
    for(;;);
  }
  
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(10, 25);
  display.println("SYSTEM BOOTING...");
  display.display();
  delay(1000);

  ledTicker.attach(0.15, toggleLED); 

  // --- REVERTED TO CLEAN BOOT SCREEN ---
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("Connecting to WiFi..");
  display.setCursor(0, 25);
  display.println("Hold button 5 secs");
  display.setCursor(0, 35);
  display.println("for Setup Mode");
  display.display();

  WiFi.mode(WIFI_STA);
  WiFi.begin(); 

  while (WiFi.status() != WL_CONNECTED) {
    handleButton(); 
    delay(100);
  }

  client.setServer(mqtt_server, mqtt_port);
  while (!client.connected()) {
    handleButton();
    reconnectMQTT();
  }

  currentState = ONLINE;
  ledTicker.detach(); 
  digitalWrite(ledPin, HIGH); 
  
  display.clearDisplay();
  display.setCursor(0, 20);
  display.println("WiFi Connected");
  display.setCursor(0, 40);
  display.println("Calibrating sensors..");
  display.display();

  Serial.println("Calibrating... DO NOT TOUCH THE SENSORS");
  adcOffsetZMPT = calibrateOffset(zmptPin);
  adcOffsetACS = calibrateOffset(acsPin);
  
  display.clearDisplay();
  // --- PERFECTLY CENTERED CALIBRATION TEXT ---
  display.setCursor(13, 30); 
  display.setTextSize(1);
  display.println("Calibration Done!");
  display.display();
  delay(1000);
}

void loop() {
  handleButton(); 

  if (WiFi.status() != WL_CONNECTED) {
    if (currentState != CONNECTING) {
      currentState = CONNECTING;
      ledTicker.attach(0.15, toggleLED); 
    }
    display.clearDisplay();
    display.setCursor(0, 20);
    display.println("WiFi Disconnected!");
    display.setCursor(0, 35);
    display.println("Reconnecting...");
    display.display();

    unsigned long now = millis();
    if (now - lastWiFiReconnectAttempt > 5000) {
      lastWiFiReconnectAttempt = now;
      WiFi.disconnect(); 
      WiFi.reconnect();  
    }
    delay(100); 
    return; 
  }

  if (!client.connected()) {
    if (currentState != CONNECTING) {
      currentState = CONNECTING;
      ledTicker.attach(0.15, toggleLED); 
    }
    display.clearDisplay();
    display.setCursor(0, 20);
    display.println("MQTT Disconnected!");
    display.setCursor(0, 35);
    display.println("Reconnecting...");
    display.display();

    reconnectMQTT();
    return; 
  }

  if (currentState != ONLINE) {
    currentState = ONLINE;
    ledTicker.detach();
    digitalWrite(ledPin, HIGH); 
  }

  client.loop(); 

  float rawVoltage = getRMS(zmptPin, adcOffsetZMPT) * voltageMultiplier;
  float rawCurrent = getRMS(acsPin, adcOffsetACS) * currentMultiplier;

  // --- UPDATED: EMA SMOOTHING WITH ZERO-SNAP & SURGE-SNAP ---
  if (smoothedVoltage == 0 && rawVoltage > 100) smoothedVoltage = rawVoltage;
  if (smoothedCurrent == 0) smoothedCurrent = rawCurrent;
  
  // Calculate difference to detect sudden power surges
  float currentDifference = abs(rawCurrent - smoothedCurrent);
  
  // 1. Zero-Snap (Appliance turned off or EMI noise)
  if (rawCurrent < 0.25) {
    smoothedCurrent = 0.00;
  } 
  // 2. Surge-Snap (Sudden heavy load detected, bypass EMA)
  else if (currentDifference > 0.50) {
    smoothedCurrent = rawCurrent; 
  } 
  // 3. Steady-State EMA Smoothing (Alpha = 0.05)
  else {
    smoothedCurrent = (rawCurrent * 0.05) + (smoothedCurrent * 0.95);
  }

  float voltageDifference = abs(rawVoltage - smoothedVoltage);
  
  if (rawVoltage < 10.0) {
    smoothedVoltage = 0.00;
  } else if (voltageDifference > 5.0) {
    smoothedVoltage = rawVoltage;
  } else {
    smoothedVoltage = (rawVoltage * 0.05) + (smoothedVoltage * 0.95);
  }

  float displayVoltage = smoothedVoltage;
  float displayCurrent = smoothedCurrent;

  // NEW STRICTER DEADBAND FOR PERFBOARD
  if (displayCurrent < 0.25) displayCurrent = 0.00;
  if (displayVoltage < 10.0) displayVoltage = 0.00;

  float powerWatts = displayVoltage * displayCurrent;

  // --- UI RENDERING LOGIC ---
  display.clearDisplay();

  if (displayPage == 0) {
    // PAGE 1: LIVE DATA
    display.setTextSize(1);
    display.setCursor(15, 0);
    display.println("ENERGY MONITOR");
    display.drawLine(0, 10, 128, 10, SH110X_WHITE);

    display.setCursor(0, 18);
    display.print("Voltage: ");
    display.setTextSize(2);
    display.setCursor(55, 15);
    display.print(displayVoltage, 1);
    display.setTextSize(1);
    display.print("V");

    display.setCursor(0, 36);
    display.print("Current: ");
    display.setTextSize(2);
    display.setCursor(55, 33);
    display.print(displayCurrent, 2);
    display.setTextSize(1);
    display.print("A");

    display.setCursor(0, 54);
    display.print("Power : ");
    display.setTextSize(2);
    display.setCursor(55, 51);
    display.print(powerWatts, 1);
    display.setTextSize(1);
    display.print("W");

  } else {
    // PAGE 2: SYSTEM INFO
    display.setTextSize(1);
    display.setCursor(15, 0);
    display.println("SYSTEM INFO");
    display.drawLine(0, 10, 128, 10, SH110X_WHITE);

    display.setCursor(0, 20);
    display.print("IP: "); 
    display.println(WiFi.localIP());

    display.setCursor(0, 35);
    display.print("WiFi: "); 
    display.print(WiFi.RSSI()); 
    display.println(" dBm");

    display.setCursor(0, 50);
    display.print("Up: "); 
    display.print(millis() / 60000); 
    display.println(" mins");
  }

  display.display();

  // --- MQTT PUBLISH LOGIC ---
  unsigned long now = millis();
  if (now - lastMsgTime > interval) {
    lastMsgTime = now;
    StaticJsonDocument<200> doc;
    doc["voltage"] = serialized(String(displayVoltage, 1)); 
    doc["current"] = serialized(String(displayCurrent, 2)); 
    doc["power"] = serialized(String(powerWatts, 1));

    char jsonBuffer[512];
    serializeJson(doc, jsonBuffer);
    client.publish(mqtt_topic, jsonBuffer);
  }
}

long calibrateOffset(int pin) {
  long total = 0;
  int samples = 1000;
  for (int i = 0; i < samples; i++) {
    total += analogRead(pin);
    delay(2);
  }
  return total / samples;
}

float getRMS(int pin, long offset) {
  unsigned long startTime = millis();
  unsigned long sampleWindow = 40; 
  double sumOfSquares = 0;
  int sampleCount = 0;

  while (millis() - startTime < sampleWindow) {
    int rawValue = analogRead(pin);
    long shiftedValue = rawValue - offset;
    sumOfSquares += ((double)shiftedValue * (double)shiftedValue);
    sampleCount++;
    delayMicroseconds(100);
  }
  float meanSquare = sumOfSquares / sampleCount;
  return sqrt(meanSquare);
}

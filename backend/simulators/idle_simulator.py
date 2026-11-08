import time
import json
import random
import paho.mqtt.client as mqtt

# --- CONFIGURATION ---
BROKER = "broker.hivemq.com"
PORT = 1883
TOPIC = "smartmeter/nazrul_final/raw"

is_connected = False

def on_connect(client, userdata, flags, reason_code, properties=None):
    global is_connected
    if reason_code == 0:
        print("🔌 Connected to HiveMQ Broker. Simulating Idle State...")
        is_connected = True

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, "ESP32_Idle_Simulator")
client.on_connect = on_connect
client.connect(BROKER, PORT, 60)
client.loop_start()

# Wait for connection to prevent missed messages
print("⏳ Waiting for MQTT connection...")
while not is_connected:
    time.sleep(0.1)

try:
    print("\n▶️ STARTING PHASE: System Idle (Infinite Loop)")
    print("Press Ctrl+C to stop taking screenshots.\n")
    
    while True:
        # Inject realistic AC voltage noise, but lock current and power to 0
        v = round(242.0 + random.uniform(-0.8, 0.8), 1)
        i = 0.0
        p = 0.0
        
        payload = {"voltage": v, "current": i, "power": p}
        client.publish(TOPIC, json.dumps(payload))
        print(f"  Published -> V: {v}V | I: {i}A | W: {p}W")
        
        # 2-second interval matching physical ESP32
        time.sleep(2) 

except KeyboardInterrupt:
    print("\n🛑 Simulator Stopped manually.")
finally:
    client.loop_stop()
    client.disconnect()
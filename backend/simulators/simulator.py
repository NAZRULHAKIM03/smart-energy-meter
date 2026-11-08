import time
import json
import random
import paho.mqtt.client as mqtt

# --- CONFIGURATION ---
BROKER = "broker.hivemq.com"
PORT = 1883
TOPIC = "smartmeter/nazrul_final/raw"

# Global states
smoothed_voltage = 0.0
smoothed_current = 0.0
is_connected = False  

def on_connect(client, userdata, flags, reason_code, properties=None):
    global is_connected
    if reason_code == 0:
        print("🔌 Connected to HiveMQ Broker. Digital Twin Active...")
        is_connected = True

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, "ESP32_Digital_Twin")
client.on_connect = on_connect
client.connect(BROKER, PORT, 60)
client.loop_start()

print("⏳ Waiting for MQTT connection...")
while not is_connected:
    time.sleep(0.1) 

def send_telemetry(phase_name, base_v, base_i, base_p, duration_seconds):
    global smoothed_voltage, smoothed_current
    print(f"\n▶️ STARTING PHASE: {phase_name} ({duration_seconds} seconds)")
    
    readings = duration_seconds // 2
    
    for _ in range(readings):
        for _ in range(50):
            # Reduced noise significantly so the strict AI doesn't panic
            raw_v = base_v + random.uniform(-0.2, 0.2) if base_v > 0 else random.uniform(0, 1.0)
            raw_i = base_i + random.uniform(-0.01, 0.01) if base_i > 0 else random.uniform(0, 0.02)
            
            if smoothed_current == 0.0: 
                smoothed_current = raw_i
                
            current_diff = abs(raw_i - smoothed_current)
            
            if raw_i < 0.25:
                smoothed_current = 0.00
            elif current_diff > 0.50:
                smoothed_current = raw_i  
            else:
                smoothed_current = (raw_i * 0.05) + (smoothed_current * 0.95)
                
            if smoothed_voltage == 0.0 and raw_v > 100: 
                smoothed_voltage = raw_v
                
            voltage_diff = abs(raw_v - smoothed_voltage)
            
            if raw_v < 10.0:
                smoothed_voltage = 0.00
            elif voltage_diff > 5.0:
                smoothed_voltage = raw_v  
            else:
                smoothed_voltage = (raw_v * 0.05) + (smoothed_voltage * 0.95)

        display_v = smoothed_voltage if smoothed_voltage >= 10.0 else 0.0
        display_i = smoothed_current if smoothed_current >= 0.25 else 0.0
        power_watts = display_v * display_i

        payload = {
            "voltage": round(display_v, 1),
            "current": round(display_i, 2),
            "power": round(power_watts, 1)
        }
        
        client.publish(TOPIC, json.dumps(payload))
        print(f"  Published -> V: {payload['voltage']}V | I: {payload['current']}A | W: {payload['power']}W")
        
        time.sleep(2) 

try:
    print("\n🚀 Starting Target Simulation for Dashboard Screenshots...\n")
    
    # PHASE 0: Establish the Baseline
    send_telemetry("System Initialization", 242.0, 0.0, 0.0, 10)
    
    # PHASE 1: Stand Fan ON 
    send_telemetry("Stand Fan ON", 241.0, 0.29, 70.0, 30)
    
    # PHASE 2: Electric Kettle ON 
    # Exact physical CSV extraction. Delta P = 1376W, Delta I = 5.76A
    # Combined with Fan: P = 1446.0W, I = 6.05A
    send_telemetry("Electric Kettle ON (Total: 2 Appliances)", 238.7, 6.05, 1446.0, 30)
    
    # PHASE 3: Both OFF / System Idle 
    send_telemetry("All Appliances OFF (System Idle)", 242.0, 0.0, 0.0, 30)

    print("\n✅ Simulation Complete. You should have all the screenshots you need!")

except KeyboardInterrupt:
    print("\n🛑 Simulation Stopped manually.")
finally:
    client.loop_stop()
    client.disconnect()
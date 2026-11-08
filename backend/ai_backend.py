import time
import json
import sqlite3
import paho.mqtt.client as mqtt
import joblib
import numpy as np
import warnings
from datetime import datetime
warnings.filterwarnings("ignore", category=UserWarning)

# --- CONFIGURATION ---
BROKER = "broker.hivemq.com"
PORT = 1883
TOPIC_SUBSCRIBE = "smartmeter/nazrul_final/raw"       
TOPIC_PUBLISH = "smartmeter/nazrul_final/processed"   

active_appliances = [] 
running_loads = {} 
current_appliance_string = "System Standby"
current_confidence = 100.0
baseline_voltage = 242.0 
current_anomaly_status = False

DB_NAME = "energy_logs.db"

def setup_database():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS raw_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
            voltage REAL,
            current REAL,
            power REAL,
            energy_kwh REAL,
            anomaly BOOLEAN,
            appliance_state TEXT
        )
    ''')
    conn.commit()
    conn.close()

def log_to_database(voltage, current, power, anomaly_flag, appliance_state):
    try:
        energy_kwh = (power / 1000.0) / 3600.0 
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        cursor.execute('''
            INSERT INTO raw_metrics (timestamp, voltage, current, power, energy_kwh, anomaly, appliance_state) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (current_time, voltage, current, power, energy_kwh, anomaly_flag, appliance_state))
        
        conn.commit()
        conn.close()
    except Exception as e: 
        print(f"Database Save Error: {e}")

# --- RETROACTIVE BACKFILL FUNCTION ---
def resolve_scanning_state(final_state):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        if final_state is None:
            # If appliance turned off, fold scanning data into Standby
            cursor.execute("UPDATE raw_metrics SET appliance_state = 'System Standby' WHERE appliance_state = 'Scanning...'")
        else:
            # Retroactively give the energy to the correct appliance!
            cursor.execute("UPDATE raw_metrics SET appliance_state = ? WHERE appliance_state = 'Scanning...' AND power > 0", (final_state,))
        conn.commit()
        conn.close()
    except Exception as e: print(e)

def calculate_tnb_cost(kwh):
    if kwh <= 0: return 0.0
    capacity_rate, network_rate = 0.0455, 0.1285
    energy_charge = (kwh * 0.2703) if kwh <= 1500 else (kwh * 0.3703)
    total_cost = energy_charge + (kwh * capacity_rate) + (kwh * network_rate)
    if kwh > 600: total_cost += 10.00
    return total_cost

def get_financial_aggregates(live_power):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute("SELECT SUM(energy_kwh) FROM raw_metrics WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now', 'localtime')")
    monthly_kwh = cursor.fetchone()[0] or 0.0
    cursor.execute("SELECT SUM(energy_kwh) FROM raw_metrics WHERE date(timestamp) = date('now', 'localtime')")
    daily_kwh = cursor.fetchone()[0] or 0.0
    cursor.execute("SELECT SUM(energy_kwh) FROM raw_metrics WHERE timestamp >= date('now', 'localtime', 'weekday 0', '-7 days')")
    weekly_kwh = cursor.fetchone()[0] or 0.0

    cursor.execute("SELECT SUM(energy_kwh) FROM raw_metrics WHERE date(timestamp) = date('now', 'localtime', '-1 day')")
    yesterday_kwh = cursor.fetchone()[0] or 0.0
    daily_trend = ((daily_kwh - yesterday_kwh) / yesterday_kwh * 100) if yesterday_kwh > 0 else 0.0

    cursor.execute("SELECT SUM(energy_kwh) FROM raw_metrics WHERE timestamp >= date('now', 'localtime', 'weekday 0', '-14 days') AND timestamp < date('now', 'localtime', 'weekday 0', '-7 days')")
    last_week_kwh = cursor.fetchone()[0] or 0.0
    weekly_trend = ((weekly_kwh - last_week_kwh) / last_week_kwh * 100) if last_week_kwh > 0 else 0.0
    conn.close()
    
    current_kwh_rate = (0.2703 + 0.0455 + 0.1285) if monthly_kwh <= 1500 else (0.3703 + 0.0455 + 0.1285)
    live_rate = (live_power / 1000.0) * current_kwh_rate
    
    return {
        "liveRate": round(live_rate, 4), "dailyCost": round(calculate_tnb_cost(daily_kwh), 2),
        "weeklyCost": round(calculate_tnb_cost(weekly_kwh), 2), "monthlyCost": round(calculate_tnb_cost(monthly_kwh), 2),
        "totalMonthlyKwh": round(monthly_kwh, 3), "dailyTrend": round(daily_trend, 1), "weeklyTrend": round(weekly_trend, 1)
    }

def get_leaderboard_data():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    # Filter out 'Scanning...' so it doesn't show up in the Pie Chart temporarily
    cursor.execute('''
        SELECT appliance_state, SUM(energy_kwh) FROM raw_metrics 
        WHERE appliance_state != 'Scanning...' AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now', 'localtime')
        GROUP BY appliance_state ORDER BY SUM(energy_kwh) DESC LIMIT 8
    ''')
    rows = cursor.fetchall()
    conn.close()
    
    leaderboard = []
    total_monthly_kwh = sum([row[1] for row in rows])
    if total_monthly_kwh > 0:
        for row in rows:
            name = row[0]
            if "🚨" in name: name = "Unrecognized Load" 
            if name == "System Standby": name = "System Idle / Background"
            leaderboard.append({"name": name, "value": round((row[1] / total_monthly_kwh) * 100, 1), "kwh": round(row[1], 4)})
    return leaderboard

def get_chart_history():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT strftime('%H:00', timestamp), SUM(energy_kwh) FROM raw_metrics
        WHERE timestamp >= datetime('now', 'localtime', '-24 hours')
        GROUP BY strftime('%H', timestamp) ORDER BY timestamp ASC
    ''')
    hourly_data = [{"time": row[0], "kwh": round(row[1], 3)} for row in cursor.fetchall()]
    cursor.execute('''
        SELECT strftime('%m-%d', timestamp), SUM(energy_kwh) FROM raw_metrics 
        WHERE timestamp >= date('now', 'localtime', '-7 days')
        GROUP BY date(timestamp) ORDER BY date(timestamp) ASC
    ''')
    daily_data = [{"time": row[0], "kwh": round(row[1], 2)} for row in cursor.fetchall()]
    conn.close()
    return {"hourly": hourly_data, "daily": daily_data}

def get_appliance_profiles():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT appliance_state, MAX(timestamp), AVG(power) FROM raw_metrics 
        WHERE appliance_state != 'System Standby' AND appliance_state != 'Scanning...' AND appliance_state NOT LIKE '%🚨%' AND appliance_state != 'Unrecognized Load' AND power > 10
        GROUP BY appliance_state
    ''')
    rows = cursor.fetchall()
    conn.close()
    
    profiles = []
    for row in rows:
        name, last_seen = row[0], row[1] or str(datetime.now())
        avg_power = row[2] or 0.0  
        
        last_seen_str = str(last_seen)
        if " " in last_seen_str:
            time_display = last_seen_str.split(" ")[1].split(".")[0] 
        else:
            time_display = last_seen_str[-8:] 

        cost_per_hr = (avg_power / 1000.0) * 0.4443 
        profiles.append({
            "name": name, "avgPower": round(avg_power, 0),
            "lastSeen": time_display, 
            "costPerHour": round(cost_per_hr, 3)
        })
    return profiles

print("🧠 Loading AI Models...")
try:
    ai_package = joblib.load("models/edge_kmeans_model.joblib")
    kmeans_scaler, kmeans_model, cluster_labels = ai_package['scaler'], ai_package['model'], ai_package['labels']
    if_package = joblib.load("models/isolation_forest_model.joblib")
    if_scaler, if_model = if_package['scaler'], if_package['model']
except: if_model = None

previous_stable_power, previous_stable_current, current_power = 0.0, 0.0, 0.0
is_detecting_event, event_start_time = False, 0
STABILITY_DELAY, EDGE_THRESHOLD = 3.0, 30.0  

def process_event(voltage, delta_i, delta_p):
    v_sag = baseline_voltage - voltage
    resistance = voltage / (delta_i + 0.0001)
    kmeans_scaled = kmeans_scaler.transform(np.array([[v_sag, delta_i, delta_p, resistance]]))
    cluster_id = kmeans_model.predict(kmeans_scaled)[0]
    appliance_name = cluster_labels[cluster_id]
    confidence = max(50.0, min(99.9, 100.0 - (kmeans_model.transform(kmeans_scaled)[0][cluster_id] * 10)))
    
    is_anomaly = False
    if if_model is not None:
        is_anomaly = (if_model.predict(if_scaler.transform(np.array([[v_sag, delta_i, delta_p]])))[0] == -1) 
    return appliance_name, round(confidence, 1), is_anomaly

def on_connect(client, userdata, flags, reason_code, properties=None):
    if reason_code == 0: client.subscribe(TOPIC_SUBSCRIBE)
       
def on_message(client, userdata, msg):
    global previous_stable_power, previous_stable_current, current_power, is_detecting_event, event_start_time
    global active_appliances, current_appliance_string, current_confidence, baseline_voltage, current_anomaly_status, running_loads
    
    try:
        payload = json.loads(msg.payload.decode())
        voltage, current, current_power = float(payload.get("voltage", 0)), float(payload.get("current", 0)), float(payload.get("power", 0))
        
        # --- THE SCANNING BUCKET LOGIC ---
        if len(running_loads) > 0:
            total_weight = sum(running_loads.values())
            effective_power = previous_stable_power if is_detecting_event else current_power
            allocated_power = 0
            
            for app_name, app_base_power in running_loads.items():
                is_anom = (app_name == "Unrecognized Load")
                proportion = app_base_power / total_weight if total_weight > 0 else 0
                apportioned_power = effective_power * proportion
                allocated_power += apportioned_power
                log_to_database(voltage, current, apportioned_power, is_anom, app_name)
            
            leftover = current_power - allocated_power
            if leftover > 5.0:
                # Put unknown spike in 'Scanning...' bucket
                log_to_database(voltage, current, leftover, False, "Scanning...")
        else:
            if is_detecting_event:
                log_to_database(voltage, current, current_power, False, "Scanning...")
            else:
                log_to_database(voltage, current, current_power, False, "System Standby")
        
        financials = get_financial_aggregates(current_power)
        leaderboard = get_leaderboard_data()
        chart_history = get_chart_history() 
        profiles = get_appliance_profiles() 
        
        if current_power < 15.0:
            baseline_voltage = voltage
            active_appliances.clear()
            running_loads.clear()
            current_anomaly_status = False
        
        power_diff = current_power - previous_stable_power
        if abs(power_diff) > EDGE_THRESHOLD and not is_detecting_event:
            is_detecting_event, event_start_time = True, time.time()

        if is_detecting_event and (time.time() - event_start_time > STABILITY_DELAY):
            final_delta_p, final_delta_i = current_power - previous_stable_power, current - previous_stable_current
            abs_delta_p = abs(final_delta_p)
            
            target_state = None
            
            if final_delta_p > 0:
                # --- POSITIVE EDGE (TURN ON) ---
                # Safe to pass to AI Model trained on positive turn-on signatures
                predicted_appliance, current_confidence, is_anomaly = process_event(voltage, abs(final_delta_i), abs_delta_p)
                
                if is_anomaly:
                    target_state = "Unrecognized Load"
                    running_loads["Unrecognized Load"] = abs_delta_p
                    current_anomaly_status = True
                else:
                    target_state = predicted_appliance
                    running_loads[predicted_appliance] = abs_delta_p
                    if predicted_appliance not in active_appliances: active_appliances.append(predicted_appliance)
            else:
                # --- NEGATIVE EDGE (TURN OFF) ---
                # AI models fail on negative edges. We must match the drop to our running_loads memory!
                closest_appliance = None
                min_diff = float('inf')
                
                # Iterate through active appliances and find the closest match to the dropped power
                for app_name, app_power in running_loads.items():
                    diff = abs(app_power - abs_delta_p)
                    if diff < min_diff:
                        min_diff = diff
                        closest_appliance = app_name
                
                # If a match is found within a 150W tolerance, cleanly remove it
                if closest_appliance and min_diff < 150.0:
                    running_loads.pop(closest_appliance, None)
                    if closest_appliance == "Unrecognized Load":
                        current_anomaly_status = False
                    elif closest_appliance in active_appliances:
                        active_appliances.remove(closest_appliance)
                
                target_state = None # Folds scanning drop into Standby

            # RETROACTIVE FIX: Give the bucket energy to the target!
            resolve_scanning_state(target_state)

            if current_power < 15.0 or len(active_appliances) == 0:
                current_appliance_string, current_confidence, current_anomaly_status = "System Standby", 100.0, False 
            else:
                current_appliance_string = ", ".join(active_appliances)
            
            previous_stable_power, previous_stable_current, is_detecting_event = current_power, current, False  

        client.publish(TOPIC_PUBLISH, json.dumps({
            "voltage": voltage, "current": current, "power": current_power,
            "appliance": current_appliance_string, "confidence": current_confidence,
            "anomaly": current_anomaly_status, "financials": financials,
            "leaderboard": leaderboard, "chart_history": chart_history, "profiles": profiles
        }))

    except Exception as e: print(e)

setup_database()
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, "Python_AI_Brain")
client.on_connect = on_connect
client.on_message = on_message
print("🚀 Backend Active... Symmetric Edge Detection enabled!")
client.connect(BROKER, PORT, 60)
client.loop_forever()
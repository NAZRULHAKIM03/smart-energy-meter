import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import matplotlib.pyplot as plt
import seaborn as sns
import joblib

PREPARED_FILES = [
    "kettle_prepared.csv",
    "rice_cooker_prepared.csv",
    "air_fryer_prepared.csv", 
    "fan_prepared.csv",
    "fridge_prepared.csv",
    "workstation_prepared.csv"
]

print("Loading Cleaned Baseline Profiles...")

dataframes = []
for file_path in PREPARED_FILES:
    try:
        df = pd.read_csv(file_path)
        baseline_v = df['Voltage (V)'].iloc[0:4].mean()
        
        # Take row 4 to the end
        df_active = df.iloc[4:].copy() 
            
        df_active['Delta_P'] = df_active['Power (W)']
        df_active['Delta_I'] = df_active['Current (A)']
        df_active['Voltage_Sag'] = baseline_v - df_active['Voltage (V)'] 
        df_active['True_Label'] = 1 # NORMAL
        dataframes.append(df_active)
    except Exception as e:
        print(f"Error loading {file_path}: {e}")

normal_df = pd.concat(dataframes, ignore_index=True)

print("Generating Targeted Parasitic Loads (Anomalies)...")
anomaly_p = np.concatenate([
    np.random.uniform(250, 450, 200),  # Dead Zone 1: ~350W
    np.random.uniform(850, 1100, 200), # Dead Zone 2: ~1000W
    np.random.uniform(1800, 2500, 200) # Dead Zone 3: ~2100W
])
anomaly_i = anomaly_p / 240.0 
anomaly_sag = anomaly_i * 0.8 

anomaly_df = pd.DataFrame({
    'Voltage_Sag': anomaly_sag, 'Delta_I': anomaly_i, 
    'Delta_P': anomaly_p, 'True_Label': -1 # ANOMALY
})

master_df = pd.concat([normal_df[['Voltage_Sag', 'Delta_I', 'Delta_P', 'True_Label']], anomaly_df], ignore_index=True)
X = master_df[['Voltage_Sag', 'Delta_I', 'Delta_P']].values
y = master_df['True_Label'].values

print("Splitting data into 80% Training and 20% Testing...")
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.20, random_state=42, stratify=y)

print("Scaling & Training Isolation Forest...")
scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

iso_forest = IsolationForest(n_estimators=200, contamination="auto", random_state=42)
iso_forest.fit(X_train_scaled)

y_pred = iso_forest.predict(X_test_scaled)
target_names = ['Anomaly (Theft)', 'Normal (Baseline)']

print("\n" + "="*40)
print("CHAPTER 4: ANOMALY DETECTION METRICS")
print("="*40)
print(classification_report(y_test, y_pred, target_names=target_names))

plt.figure(figsize=(7, 5))
cm = confusion_matrix(y_test, y_pred)
sns.heatmap(cm, annot=True, fmt='d', cmap='Reds', xticklabels=target_names, yticklabels=target_names)
plt.title('Security Event Detection - Isolation Forest')
plt.ylabel('Actual Event')
plt.xlabel('AI Prediction')
plt.tight_layout()
plt.savefig('Chapter4_Isolation_Forest_Matrix.png', dpi=300)
print("Saved 'Chapter4_Isolation_Forest_Matrix.png'")

joblib.dump({'scaler': scaler, 'model': iso_forest}, 'isolation_forest_model.joblib')
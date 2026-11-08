import pandas as pd
import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.preprocessing import StandardScaler
import matplotlib.pyplot as plt
import seaborn as sns
import joblib

PREPARED_FILES = {
    "Electric Kettle": "kettle_prepared.csv",
    "Rice Cooker": "rice_cooker_prepared.csv",
    "Air Fryer": "air_fryer_prepared.csv",
    "Stand Fan": "fan_prepared.csv",
    "Mini Fridge": "fridge_prepared.csv",
    "Workstation": "workstation_prepared.csv"
}

NUM_CLUSTERS = 6
print("Loading Cleaned Datasets...")
dataframes = []

for appliance_name, file_path in PREPARED_FILES.items():
    try:
        df = pd.read_csv(file_path)
        
        # Calculate baseline from first 4 rows
        baseline_v = df['Voltage (V)'].iloc[0:4].mean()
        
        # Take row 4 to the end!
        df_active = df.iloc[4:].copy() 
        
        # Feature Engineering
        df_active['Delta_P'] = df_active['Power (W)']
        df_active['Delta_I'] = df_active['Current (A)']
        df_active['Voltage_Sag'] = baseline_v - df_active['Voltage (V)'] 
        df_active['Resistance'] = df_active['Voltage (V)'] / (df_active['Current (A)'] + 0.0001)
        
        df_active['True_Appliance'] = appliance_name
        dataframes.append(df_active)
    except Exception as e:
        print(f"Error loading {file_path}: {e}")

master_df = pd.concat(dataframes, ignore_index=True)
X_features = master_df[['Voltage_Sag', 'Delta_I', 'Delta_P', 'Resistance']].values
true_labels = master_df['True_Appliance'].values

print("Scaling Data & Training 4D K-Means...")
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X_features)

kmeans = KMeans(n_clusters=NUM_CLUSTERS, random_state=42, n_init=20)
master_df['Cluster_ID'] = kmeans.fit_predict(X_scaled)

cluster_mapping = {}
for cluster_id in range(NUM_CLUSTERS):
    cluster_data = master_df[master_df['Cluster_ID'] == cluster_id]
    if not cluster_data.empty:
        dominant_appliance = cluster_data['True_Appliance'].mode()[0]
        cluster_mapping[cluster_id] = dominant_appliance

master_df['AI_Prediction'] = master_df['Cluster_ID'].map(cluster_mapping)

joblib.dump({'scaler': scaler, 'model': kmeans, 'labels': cluster_mapping}, 'edge_kmeans_model.joblib')

print("\n" + "="*40)
print("CHAPTER 4: K-MEANS METRICS (PREPARED DATA)")
print("="*40)
print(classification_report(master_df['True_Appliance'], master_df['AI_Prediction']))

plt.figure(figsize=(10, 7))
cm = confusion_matrix(master_df['True_Appliance'], master_df['AI_Prediction'])
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
            xticklabels=np.unique(true_labels), yticklabels=np.unique(true_labels))
plt.title('Unsupervised Load Clustering - Prepared Dataset')
plt.ylabel('Actual Appliance')
plt.xlabel('AI Clustered Appliance')
plt.tight_layout()
plt.savefig('Chapter4_Confusion_Matrix_KMeans.png', dpi=300)
print("Saved 'Chapter4_Confusion_Matrix_KMeans.png'")
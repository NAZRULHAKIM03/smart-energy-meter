import React, { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { jsPDF } from 'jspdf'; 
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  Zap, Activity, Power, Server, AlertTriangle, Info, PieChart as PieIcon, ArrowUpRight, ArrowDownRight, Clock, Download, Radar, Wallet 
} from 'lucide-react';

const PIE_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#06b6d4', '#71717a']; 

const MetricCard = ({ value, max, label, unit, metricType, icon: Icon }) => {
  const numValue = Number(value || 0);
  const percentage = Math.min((numValue / max) * 100, 100);
  
  let activeTextColor = 'text-zinc-100';
  let activeBarColor = 'bg-zinc-500';

  if (metricType === 'voltage') {
    const isHealthy = numValue >= 220 && numValue <= 250;
    activeTextColor = isHealthy ? 'text-blue-500' : 'text-red-500';
    activeBarColor = isHealthy ? 'bg-blue-500' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]';
  } else {
    if (percentage < 60) {
      activeTextColor = 'text-emerald-500';
      activeBarColor = 'bg-emerald-500';
    } else if (percentage < 85) {
      activeTextColor = 'text-amber-500';
      activeBarColor = 'bg-amber-500';
    } else {
      activeTextColor = 'text-red-500';
      activeBarColor = 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]';
    }
  }

  return (
    <div className="flex flex-col justify-between w-full h-full relative">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {Icon && <Icon size={18} className={activeTextColor} />}
            <span className="text-sm font-medium text-zinc-400">{label}</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-4xl font-bold tracking-tight transition-colors duration-500 ${activeTextColor}`}>
              {numValue}
            </span>
            <span className="text-lg font-medium text-zinc-500">{unit}</span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs font-semibold text-zinc-600 bg-zinc-800/50 px-2 py-1 rounded-md">
            Limit: {max}{unit}
          </span>
        </div>
      </div>
      <div className="w-full bg-zinc-800/50 h-2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ease-out ${activeBarColor}`} style={{ width: `${percentage}%` }}></div>
      </div>
    </div>
  );
};

export default function App() {
  const [sensorData, setSensorData] = useState({ voltage: 0, current: 0, power: 0 });
  const [aiData, setAiData] = useState({ appliance: 'System Standby', confidence: 100 });
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('--:--:--');
  
  const [history, setHistory] = useState([]);
  const [chartHistory, setChartHistory] = useState({ hourly: [], daily: [] });
  const [alerts, setAlerts] = useState([]); 
  const [leaderboard, setLeaderboard] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [financials, setFinancials] = useState({ 
    liveRate: 0, daily: 0, weekly: 0, monthly: 0, totalMonthlyKwh: 0, dailyTrend: 0, weeklyTrend: 0 
  });
  
  const [chartView, setChartView] = useState('live'); 
  const [isScanning, setIsScanning] = useState(false);
  const [hasAnomaly, setHasAnomaly] = useState(false); 
  const [isExporting, setIsExporting] = useState(false);

  const scanningTimeoutRef = useRef(null);
  const wasAnomalyActive = useRef(false);
  const prevApplianceRef = useRef('System Standby');

  useEffect(() => {
    const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';
    const client = mqtt.connect(brokerUrl);

    client.on('connect', () => {
      setIsConnected(true);
      client.subscribe('smartmeter/nazrul_final/processed'); 
    });

    client.on('message', (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-GB', { hour12: false });
        
        setLastUpdated(timeString);

        setSensorData(prev => {
          const newPower = Number(payload.power || 0);
          if (Math.abs(newPower - prev.power) > 30) {
            setIsScanning(true);
            if (scanningTimeoutRef.current) clearTimeout(scanningTimeoutRef.current);
            scanningTimeoutRef.current = setTimeout(() => setIsScanning(false), 5500); 
          }
          return { voltage: payload.voltage || 0, current: payload.current || 0, power: newPower };
        });

        if (payload.financials) {
          setFinancials({
            liveRate: Number(payload.financials.liveRate || 0),
            daily: Number(payload.financials.dailyCost || 0),
            weekly: Number(payload.financials.weeklyCost || 0),
            monthly: Number(payload.financials.monthlyCost || 0),
            totalMonthlyKwh: Number(payload.financials.totalMonthlyKwh || 0),
            dailyTrend: Number(payload.financials.dailyTrend || 0),
            weeklyTrend: Number(payload.financials.weeklyTrend || 0)
          });
        }
        
        if (payload.leaderboard) setLeaderboard(payload.leaderboard);
        if (payload.chart_history) setChartHistory({
          hourly: payload.chart_history.hourly || [],
          daily: payload.chart_history.daily || []
        });
        if (payload.profiles) setProfiles(payload.profiles);

        const incomingAppliance = payload.appliance || 'System Standby';
        const incomingAnomaly = payload.anomaly || false;

        setAiData({ appliance: incomingAppliance, confidence: payload.confidence || 0 });
        setHasAnomaly(incomingAnomaly);

        if (incomingAppliance !== prevApplianceRef.current || incomingAnomaly !== wasAnomalyActive.current) {
            setIsScanning(false);
            if (scanningTimeoutRef.current) clearTimeout(scanningTimeoutRef.current);
        }

        if (incomingAnomaly) {
          if (!wasAnomalyActive.current) {
            setAlerts(prev => [{ time: timeString, msg: `🚨 UNAUTHORIZED LOAD: ${payload.power}W flagged!`, type: 'danger' }, ...prev].slice(0, 10));
            wasAnomalyActive.current = true;
          }
        } else {
          if (wasAnomalyActive.current) {
            setAlerts(prev => [{ time: timeString, msg: `✅ Security Alert Cleared.`, type: 'safe' }, ...prev].slice(0, 10));
            wasAnomalyActive.current = false;
          }
          if (incomingAppliance !== prevApplianceRef.current && !isScanning) {
            if (incomingAppliance !== 'System Standby') {
              setAlerts(prev => [{ time: timeString, msg: `⚡ Authorized: ${incomingAppliance}`, type: 'info' }, ...prev].slice(0, 10));
            } else {
              setAlerts(prev => [{ time: timeString, msg: `💤 System Idle.`, type: 'neutral' }, ...prev].slice(0, 10));
            }
            prevApplianceRef.current = incomingAppliance;
          }
        }

        setHistory(prevHistory => {
          const newPoint = { time: timeString, power: payload.power || 0 };
          const updatedHistory = [...prevHistory, newPoint];
          if (updatedHistory.length > 30) updatedHistory.shift(); 
          return updatedHistory;
        });

      } catch (error) { }
    });

    return () => { if (client) client.end(); };
  }, [isScanning]); 

  const handleExportPDF = () => {
    setIsExporting(true);
    try {
      const doc = new jsPDF('p', 'pt', 'a4');

      // --- SECTION 1: TNB INVOICE ---
      doc.setFontSize(22);
      doc.setTextColor(37, 99, 235); // TNB Blue
      doc.text('Anggaran Bil Elektrik - Domestik (Am)', 40, 60);

      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Tarikh Janaan: ${new Date().toLocaleString('en-MY')}`, 40, 80);
      
      const totalKwh = Number(financials?.totalMonthlyKwh || 0);
      doc.text(`Jumlah Penggunaan Semasa: ${totalKwh.toFixed(3)} kWj`, 40, 95);

      const energyRate = totalKwh <= 1500 ? 0.2703 : 0.3703;
      const capacityRate = 0.0455;
      const networkRate = 0.1285;

      const energyCost = totalKwh * energyRate;
      const capacityCost = totalKwh * capacityRate;
      const networkCost = totalKwh * networkRate;
      const retailCost = totalKwh > 600 ? 10.00 : 0.00;
      const totalCost = energyCost + capacityCost + networkCost + retailCost;

      doc.setFillColor(37, 99, 235);
      doc.rect(40, 115, 515, 25, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text("Jenis Caj", 50, 132);
      doc.text("Kadar (RM)", 300, 132, { align: "center" });
      doc.text("Jumlah (RM)", 540, 132, { align: "right" });

      const tableRows = [
        ["Tenaga", `${energyRate.toFixed(4)} / kWj`, energyCost.toFixed(2)],
        ["Kapasiti", `${capacityRate.toFixed(4)} / kWj`, capacityCost.toFixed(2)],
        ["Rangkaian", `${networkRate.toFixed(4)} / kWj`, networkCost.toFixed(2)],
        ["Peruncitan", totalKwh > 600 ? "10.00 / bulan" : "0.00 / bulan", retailCost.toFixed(2)]
      ];

      doc.setFont('helvetica', 'normal');
      let yPosition = 160;

      tableRows.forEach((row, index) => {
        if (index % 2 === 0) {
          doc.setFillColor(248, 250, 252); 
          doc.rect(40, yPosition - 17, 515, 25, 'F');
        }
        
        doc.setTextColor(0, 0, 0);
        doc.text(row[0], 50, yPosition);
        doc.text(row[1], 300, yPosition, { align: "center" });
        doc.text(row[2], 540, yPosition, { align: "right" });
        
        yPosition += 25;
      });

      let currentY = yPosition + 15;
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(`Jumlah Bil (RM): ${totalCost.toFixed(2)}`, 540, currentY, { align: "right" });

      // --- SECTION 2: AI LOAD DISAGGREGATION TABLE ---
      currentY += 45;
      doc.setFontSize(16);
      doc.setTextColor(30, 41, 59); // Professional Slate/Charcoal
      doc.setFont('helvetica', 'bold');
      doc.text('AI Load Disaggregation Analysis', 40, currentY);

      currentY += 20;
      // Draw Disaggregation Table Header
      doc.setFillColor(71, 85, 105); // Slate Gray Background
      doc.rect(40, currentY, 515, 25, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text("Appliance / Load Profile", 50, currentY + 17);
      doc.text("Percentage (%)", 300, currentY + 17, { align: "center" });
      doc.text("Energy (kWh)", 540, currentY + 17, { align: "right" });

      currentY += 25;
      doc.setFont('helvetica', 'normal');

      if (!leaderboard || leaderboard.length === 0) {
        doc.setTextColor(100);
        doc.text('No active appliance signatures detected yet.', 50, currentY + 17);
        currentY += 25;
      } else {
        leaderboard.forEach((item, index) => {
          if (currentY > 750) { doc.addPage(); currentY = 40; } // Auto-page break
          
          if (index % 2 === 0) {
            doc.setFillColor(248, 250, 252); // Subtle zebra striping
            doc.rect(40, currentY, 515, 25, 'F');
          }
          
          // Highlight theft in red inside the table
          if (item.name === "Unrecognized Load") {
            doc.setTextColor(225, 29, 72); 
            doc.setFont('helvetica', 'bold');
          } else {
            doc.setTextColor(0, 0, 0);
            doc.setFont('helvetica', 'normal');
          }
          
          doc.text(item.name, 50, currentY + 17);
          doc.text(`${item.value}%`, 300, currentY + 17, { align: "center" });
          doc.text(Number(item.kwh).toFixed(4), 540, currentY + 17, { align: "right" });
          
          currentY += 25;
        });
      }

      // --- SECTION 3: THEFT DETECTION SMART BOX ---
      currentY += 30;
      if (currentY > 700) { doc.addPage(); currentY = 40; } 

      // Draw a clean separator line
      doc.setDrawColor(203, 213, 225);
      doc.line(40, currentY, 555, currentY);
      currentY += 35;
      
      doc.setFontSize(16);
      doc.setTextColor(30, 41, 59); // Slate Header
      doc.setFont('helvetica', 'bold');
      doc.text('Security & Anomaly Detection', 40, currentY);
      
      currentY += 20;
      doc.setFontSize(11);
      
      const anomalyData = leaderboard?.find(item => item.name === "Unrecognized Load");
      
      if (anomalyData) {
        // High-Visibility Warning Box
        doc.setFillColor(254, 226, 226); // Red tinted background
        doc.setDrawColor(239, 68, 68); // Red border
        doc.rect(40, currentY, 515, 55, 'FD'); // Fill and Draw
        
        doc.setTextColor(220, 38, 38); 
        doc.setFont('helvetica', 'bold');
        doc.text('CRITICAL: Unauthorized Load (Theft) Detected', 55, currentY + 22);
        
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(153, 27, 27); 
        doc.text(`Suspected Stolen Power: ${Number(anomalyData.kwh).toFixed(4)} kWh  |  System Impact: ${anomalyData.value}%`, 55, currentY + 42);
      } else {
        // Clean Verification Box
        doc.setFillColor(209, 250, 229); // Green tinted background
        doc.setDrawColor(16, 185, 129); // Green border
        doc.rect(40, currentY, 515, 35, 'FD');
        
        doc.setTextColor(5, 150, 105);
        doc.setFont('helvetica', 'bold');
        doc.text('SYSTEM SECURE: No anomalies or electrical theft detected.', 55, currentY + 22);
      }

      // Save the file
      const dateStr = new Date().toISOString().split('T')[0];
      doc.save(`Laporan_TNB_SmartMeter_${dateStr}.pdf`);
    } catch (error) {
      console.error("PDF Generation Error: ", error);
      alert("Failed to generate PDF. Check console.");
    } finally {
      setIsExporting(false);
    }
  };

  const CustomPieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const sliceColor = payload[0].payload.fill; 
      return (
        <div className="bg-zinc-900 border border-zinc-700 p-3 rounded-lg shadow-xl">
          <p className="text-zinc-200 font-semibold mb-1">{data.name}</p>
          <p style={{ color: sliceColor }} className="text-sm font-medium">{data.value}% of total</p>
          <p className="text-zinc-400 text-xs mt-1">{data.kwh} kWh consumed</p>
        </div>
      );
    }
    return null;
  };

  const renderTrend = (value) => {
    const val = Number(value || 0);
    if (val > 0) return <span className="text-rose-500 flex items-center"><ArrowUpRight size={14} className="mr-0.5"/> {val.toFixed(1)}%</span>;
    if (val < 0) return <span className="text-emerald-500 flex items-center"><ArrowDownRight size={14} className="mr-0.5"/> {Math.abs(val).toFixed(1)}%</span>;
    return <span className="text-zinc-500 text-xs">--</span>;
  };

  let displayData = history;
  let yDataKey = "power";
  let yUnit = "W";
  if (chartView === '24h') { displayData = chartHistory?.hourly || []; yDataKey = "kwh"; yUnit = "kWh"; } 
  else if (chartView === '7d') { displayData = chartHistory?.daily || []; yDataKey = "kwh"; yUnit = "kWh"; }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-8 font-sans">
      <header className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">SmartMeter Analytics</h1>
          <p className="text-zinc-400 text-sm mt-1">Load Classification & Theft Detection System</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            
            <button 
              onClick={handleExportPDF} 
              disabled={isExporting}
              className="flex items-center gap-2 bg-zinc-800 hover:bg-purple-600 text-zinc-300 hover:text-white px-4 py-2 rounded-full border border-zinc-700 transition-all duration-300 disabled:opacity-50 text-sm font-medium cursor-pointer"
            >
              <Download size={16} className={isExporting ? "animate-bounce" : ""} />
              {isExporting ? 'Generating...' : 'Export Report'}
            </button>
            
            <div className="flex items-center gap-3 bg-zinc-900 py-2 px-4 rounded-full border border-zinc-800">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`}></div>
              <span className="text-sm font-medium text-zinc-300">{isConnected ? 'System Online' : 'Connecting...'}</span>
            </div>
          </div>
          <span className="text-xs text-zinc-500 font-mono mr-2">Last Update: {lastUpdated}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex items-center shadow-lg hover:bg-zinc-800/50 transition-colors duration-300">
          <MetricCard value={Number(sensorData?.voltage || 0).toFixed(1)} max={250} label="Voltage" unit="V" metricType="voltage" icon={Zap} />
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex items-center shadow-lg hover:bg-zinc-800/50 transition-colors duration-300">
          <MetricCard value={Number(sensorData?.current || 0).toFixed(2)} max={13} label="Current Load" unit="A" metricType="load" icon={Activity} />
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex items-center shadow-lg hover:bg-zinc-800/50 transition-colors duration-300">
          <MetricCard value={Number(sensorData?.power || 0).toFixed(0)} max={3120} label="Active Power" unit="W" metricType="load" icon={Power} />
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 md:col-span-2 shadow-lg flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Consumption Pattern</h2>
              <p className="text-sm text-zinc-400">Real-time and historical power monitoring</p>
            </div>
            <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800">
              <button onClick={() => setChartView('live')} className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${chartView === 'live' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'}`}>Live</button>
              <button onClick={() => setChartView('24h')} className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${chartView === '24h' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'}`}>24 Hours</button>
              <button onClick={() => setChartView('7d')} className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${chartView === '7d' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'}`}>7 Days</button>
            </div>
          </div>
          <div className="flex-1 w-full min-h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={displayData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="time" stroke="#a1a1aa" fontSize={12} tickMargin={10} />
                <YAxis stroke="#a1a1aa" fontSize={12} domain={['auto', 'auto']} tickFormatter={(value) => `${value}${yUnit}`} />
                <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }} itemStyle={{ color: '#10b981' }} />
                <Line type="monotone" dataKey={yDataKey} stroke="#10b981" strokeWidth={3} dot={chartView !== 'live'} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 md:col-span-1 shadow-lg flex flex-col h-full">
          <div className="flex items-center gap-2 mb-4">
            <PieIcon size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Monthly Analytics</h2>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 mb-2 text-center">
            <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-1">Total Tracked Loads</p>
            <p className="text-3xl font-bold text-white">{Number(financials?.totalMonthlyKwh || 0).toFixed(3)} <span className="text-sm font-medium text-zinc-500 tracking-normal">kWh</span></p>
          </div>
          <div className="flex-1 flex items-center justify-center min-h-[260px]">
            {!leaderboard || leaderboard.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-zinc-500">
                <Radar size={24} className="mb-2 opacity-50" />
                <span className="text-sm">Accumulating data...</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={leaderboard}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {leaderboard.map((entry, index) => {
                      let sliceColor = PIE_COLORS[index % PIE_COLORS.length];
                      if (entry?.name === "Unrecognized Load") sliceColor = "#f43f5e";
                      if (entry?.name === "System Idle / Background") sliceColor = "#71717a";
                      return <Cell key={`cell-${index}`} fill={sliceColor} />;
                    })}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                  <Legend verticalAlign="bottom" height={40} iconType="circle" wrapperStyle={{ fontSize: '11px', color: '#a1a1aa' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-lg flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Server size={18} className="text-purple-500" />
                <h2 className="text-lg font-semibold text-white">Load Identity</h2>
              </div>
              {!isScanning && aiData.appliance !== 'System Standby' && (
                <span className="text-xs font-medium text-purple-400 bg-purple-500/10 px-2 py-1 rounded-full border border-purple-500/20">
                  {aiData.confidence}% Confidence
                </span>
              )}
            </div>
            {isScanning ? (
              <div className="flex flex-col items-center justify-center py-4 space-y-3">
                <Radar size={32} className="text-purple-500 animate-spin" />
                <p className="text-sm font-medium text-purple-400 animate-pulse">Scanning Signature...</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 mt-2">
                {aiData.appliance !== 'System Standby' && aiData.appliance.split(', ').map((app, index) => (
                  <div key={index} className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 px-3 py-2 rounded-lg shadow-sm">
                    <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.6)]"></div>
                    <span className="text-sm font-semibold text-zinc-200">{app}</span>
                  </div>
                ))}
                {hasAnomaly && (
                  <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-800 px-3 py-2 rounded-lg shadow-sm">
                    <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)] animate-pulse"></div>
                    <span className="text-sm font-semibold text-rose-400">Unrecognized Load</span>
                  </div>
                )}
                {aiData.appliance === 'System Standby' && !hasAnomaly && (
                  <p className="text-2xl font-bold text-zinc-500 tracking-tight">System Standby</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-lg flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Wallet size={18} className="text-blue-400" />
              <h2 className="text-lg font-semibold text-white">Cost Analysis</h2>
            </div>
            <div className="mb-4">
              <p className="text-sm font-medium text-zinc-400">Live Burn Rate</p>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-white tracking-tight">RM {Number(financials?.liveRate || 0).toFixed(4)}</span>
                <span className="text-sm font-medium text-zinc-500">/ hr</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2 pt-4 border-t border-zinc-800/50 divide-x divide-zinc-800/50">
            <div className="pr-2">
              <p className="text-[11px] text-zinc-500 mb-1 flex items-center justify-between">Today <span className="font-medium text-[10px]">{renderTrend(financials?.dailyTrend)}</span></p>
              <p className="text-sm font-semibold text-zinc-200">RM {Number(financials?.daily || 0).toFixed(2)}</p>
            </div>
            <div className="px-3">
              <p className="text-[11px] text-zinc-500 mb-1 flex items-center justify-between">Week <span className="font-medium text-[10px]">{renderTrend(financials?.weeklyTrend)}</span></p>
              <p className="text-sm font-semibold text-zinc-200">RM {Number(financials?.weekly || 0).toFixed(2)}</p>
            </div>
            <div className="pl-3">
              <p className="text-[11px] text-zinc-500 mb-1 flex items-center justify-between">Month</p>
              <p className="text-sm font-semibold text-zinc-200">RM {Number(financials?.monthly || 0).toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-lg flex flex-col h-full">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={18} className="text-rose-500" />
            <h2 className="text-lg font-semibold text-white">System Event Log</h2>
          </div>
          <div className="flex-1 bg-zinc-950 rounded-xl p-4 border border-zinc-800 overflow-y-auto min-h-[120px] max-h-[160px] custom-scrollbar">
            {!alerts || alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-zinc-500 h-full justify-center">
                <Info size={16} />
                <span className="text-sm font-medium">Awaiting events...</span>
              </div>
            ) : (
              <ul className="space-y-3">
                {alerts.map((alert, idx) => {
                  let colorClass = 'text-zinc-400';
                  if (alert.type === 'danger') colorClass = 'text-rose-500 font-bold';
                  if (alert.type === 'safe') colorClass = 'text-emerald-500';
                  if (alert.type === 'info') colorClass = 'text-blue-400';
                  return (
                    <li key={idx} className="flex flex-col gap-0.5 text-sm">
                      <span className="text-zinc-600 font-mono text-xs">{alert.time}</span>
                      <span className={`${colorClass} leading-tight`}>{alert.msg}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {profiles && profiles.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={20} className="text-white" />
            <h2 className="text-xl font-bold text-white tracking-tight">Appliance Intelligence Profiles</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {profiles.map((profile, index) => (
              <div key={index} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-md flex flex-col">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-purple-900/40 border border-purple-500/30 flex items-center justify-center">
                    <Power size={20} className="text-purple-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-zinc-100">{profile.name}</h3>
                </div>
                
                <div className="space-y-3 flex-1">
                  <div className="flex justify-between items-end border-b border-zinc-800/60 pb-2">
                    <span className="text-sm text-zinc-500 font-medium">Avg Draw</span>
                    <span className="text-lg font-bold text-zinc-200">{Number(profile.avgPower || 0).toFixed(0)} <span className="text-xs font-medium text-zinc-500">W</span></span>
                  </div>
                  <div className="flex justify-between items-end border-b border-zinc-800/60 pb-2">
                    <span className="text-sm text-zinc-500 font-medium">Est. Cost</span>
                    <span className="text-lg font-bold text-zinc-200">RM {Number(profile.costPerHour || 0).toFixed(3)} <span className="text-xs font-medium text-zinc-500">/hr</span></span>
                  </div>
                  <div className="flex justify-between items-end pt-1">
                    <span className="text-sm text-zinc-500 font-medium flex items-center gap-1"><Clock size={14}/> Last Seen</span>
                    <span className="text-sm font-medium text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded-md">{profile.lastSeen}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
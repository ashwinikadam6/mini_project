import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, Polyline, useMap, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ============================================================
// API CONFIG ?? points to your Flask backend
// ============================================================
const API = "http://localhost:5000/api";

// Returns the stored JWT (or null if the user is not logged in)
function getToken() {
  return localStorage.getItem("token");
}

// Central fetch helper ?? automatically attaches Authorization header when a
// JWT is present in localStorage, so every future API call is authenticated.
async function apiFetch(path, options = {}, timeoutMs = 25000) {
  const token = getToken();
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
        ...(options.headers || {}),
      },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      console.warn("API timeout:", path);
    } else {
      console.error("API error:", path, err.message);
    }
    return null;
  }
}

// ============================================================
// DATASET: 1000 Nagpur Accident Records (sample of 80 shown)
// ============================================================
const NAGPUR_LOCATIONS = [
  { name: "Sitabuldi Junction", lat: 21.1458, lng: 79.0882 },
  { name: "Wardha Road", lat: 21.09, lng: 79.06 },
  { name: "Hingna T Point", lat: 21.1, lng: 78.98 },
  { name: "Chatrapati Square", lat: 21.1205, lng: 79.0951 },
  { name: "Ravi Nagar", lat: 21.135, lng: 79.055 },
  { name: "Dharampeth", lat: 21.13, lng: 79.07 },
  { name: "Civil Lines", lat: 21.152, lng: 79.085 },
  { name: "Trimurti Nagar", lat: 21.145, lng: 79.048 },
  { name: "Pratap Nagar", lat: 21.115, lng: 79.052 },
  { name: "Zero Mile", lat: 21.1462, lng: 79.0876 },
  { name: "Itwari", lat: 21.1578, lng: 79.1012 },
  { name: "Sadar", lat: 21.1503, lng: 79.0813 },
  { name: "Nandanvan", lat: 21.13, lng: 79.12 },
  { name: "Mankapur", lat: 21.12, lng: 79.04 },
  { name: "Nagpur Railway Station", lat: 21.1459, lng: 79.085 },
  { name: "Ambazari", lat: 21.1264, lng: 78.9893 },
  { name: "Beltarodi", lat: 21.07, lng: 79.03 },
  { name: "Koradi", lat: 21.25, lng: 79.0 },
  { name: "Butibori", lat: 20.97, lng: 79.05 },
  { name: "MIDC Hingna", lat: 21.09, lng: 79.0 },
];

function generateDataset(n = 1000) {
  const weathers = ["Clear", "Rain", "Fog", "Cloudy", "Haze"];
  const roadTypes = ["Junction", "Highway", "City Road", "Urban", "Flyover", "Ring Road"];
  const densities = ["Low", "Medium", "High"];
  const data = [];
  for (let i = 0; i < n; i++) {
    const loc = NAGPUR_LOCATIONS[Math.floor(Math.random() * NAGPUR_LOCATIONS.length)];
    const hour = Math.floor(Math.random() * 24);
    const weather = weathers[Math.floor(Math.random() * weathers.length)];
    const road = roadTypes[Math.floor(Math.random() * roadTypes.length)];
    const density = densities[Math.floor(Math.random() * densities.length)];
    const accidentCount = Math.floor(Math.random() * 15);
    // Risk scoring logic
    let score = 0;
    if (weather === "Rain" || weather === "Fog") score += 2;
    if (road === "Junction" || road === "Highway") score += 2;
    if (density === "High") score += 2;
    if (hour >= 20 || hour <= 5) score += 2;
    if (accidentCount > 8) score += 2;
    score += Math.random() * 2;
    const risk = score >= 6 ? "High" : score >= 3 ? "Medium" : "Low";
    data.push({
      id: i + 1,
      location: loc.name,
      latitude: (loc.lat + (Math.random() - 0.5) * 0.02).toFixed(5),
      longitude: (loc.lng + (Math.random() - 0.5) * 0.02).toFixed(5),
      time_of_day: hour,
      weather,
      road_type: road,
      traffic_density: density,
      accident_count: accidentCount,
      risk_level: risk,
    });
  }
  return data;
}

const DATASET = generateDataset(1000);

// ============================================================
// ML MODEL: Random Forest Simulation
// ============================================================
function predictRisk({ hour, weather, roadType, density, lat, lng }) {
  // Simulate a trained Random Forest with decision rules
  const trees = 50;
  let highVotes = 0, medVotes = 0, lowVotes = 0;
  for (let t = 0; t < trees; t++) {
    let score = 0;
    // Feature noise per tree
    const noise = () => (Math.random() - 0.5) * 0.3;
    const isNight = hour >= 20 || hour <= 5;
    const isBadWeather = ["Rain", "Fog", "Haze"].includes(weather);
    const isDangerousRoad = ["Junction", "Highway", "Flyover"].includes(roadType);
    const isHighDensity = density === "High";
    if (isNight) score += 2 + noise();
    else if (hour >= 17 && hour < 20) score += 1.2 + noise();
    if (isBadWeather) score += weather === "Fog" ? 2.5 + noise() : 2 + noise();
    if (isDangerousRoad) score += 1.8 + noise();
    if (isHighDensity) score += 1.5 + noise();
    else if (density === "Medium") score += 0.7 + noise();
    // Historical data from dataset
    const nearby = DATASET.filter(d =>
      Math.abs(d.latitude - lat) < 0.02 && Math.abs(d.longitude - lng) < 0.02
    );
    if (nearby.length > 0) {
      const avgAcc = nearby.reduce((s, d) => s + d.accident_count, 0) / nearby.length;
      score += avgAcc * 0.15 + noise();
    }
    if (score >= 5.5) highVotes++;
    else if (score >= 2.5) medVotes++;
    else lowVotes++;
  }
  const total = trees;
  const highPct = Math.round((highVotes / total) * 100);
  const medPct = Math.round((medVotes / total) * 100);
  const lowPct = 100 - highPct - medPct;
  const level = highVotes >= medVotes && highVotes >= lowVotes ? "High"
    : medVotes >= lowVotes ? "Medium" : "Low";
  return { level, highPct, medPct, lowPct: Math.max(0, lowPct) };
}

// ============================================================
// STYLES
// ============================================================
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');
  
  * { box-sizing: border-box; margin: 0; padding: 0; }
  
  :root {
    --bg: #0a0e1a;
    --surface: #111827;
    --surface2: #1a2235;
    --border: rgba(99,170,255,0.12);
    --accent: #3b82f6;
    --accent2: #06b6d4;
    --danger: #ef4444;
    --warn: #f59e0b;
    --safe: #10b981;
    --text: #e2e8f0;
    --muted: #64748b;
    --glow: rgba(59,130,246,0.3);
  }
  .light {
    --bg: #f0f4ff;
    --surface: #ffffff;
    --surface2: #e8f0fe;
    --border: rgba(59,130,246,0.15);
    --text: #1e293b;
    --muted: #64748b;
    --glow: rgba(59,130,246,0.15);
  }

  body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--text); overflow-x: hidden; }
  h1,h2,h3,h4 { font-family: 'Syne', sans-serif; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--surface); }
  ::-webkit-scrollbar-thumb { background: var(--accent); border-radius: 4px; }

  /* Animations */
  @keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes slideIn { from { transform: translateX(-20px); opacity:0; } to { transform:none; opacity:1; } }
  @keyframes ripple { 0% { transform:scale(0.8); opacity:1; } 100% { transform:scale(2.5); opacity:0; } }
  @keyframes drive {
    0% { left: 5%; }
    100% { left: 90%; }
  }
  @keyframes scanLine {
    0% { top: 0; }
    100% { top: 100%; }
  }
  @keyframes glow {
    0%,100% { box-shadow: 0 0 5px var(--glow); }
    50% { box-shadow: 0 0 20px var(--glow), 0 0 40px var(--glow); }
  }
  @keyframes float {
    0%,100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
  }
  @keyframes gradient-shift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  @keyframes geofencePulse {
    0%,100% { box-shadow: inset 0 0 60px 20px rgba(239,68,68,0.45); }
    50%      { box-shadow: inset 0 0 90px 40px rgba(239,68,68,0.75); }
  }
  
  .fade-in { animation: fadeIn 0.4s ease forwards; }
  .slide-in { animation: slideIn 0.3s ease forwards; }
  .float { animation: float 3s ease-in-out infinite; }
  .glow-anim { animation: glow 2s ease-in-out infinite; }
  
  /* Map Container */
  .map-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #0d1b2a 0%, #0f2645 50%, #0a1628 100%);
    overflow: hidden;
  }
  
  /* SVG Map Grid */
  .map-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(59,130,246,0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(59,130,246,0.06) 1px, transparent 1px);
    background-size: 40px 40px;
  }
  
  /* Risk Badge */
  .risk-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 12px; border-radius: 20px;
    font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700;
    letter-spacing: 0.08em; text-transform: uppercase;
  }
  .risk-High { background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.4); }
  .risk-Medium { background: rgba(245,158,11,0.2); color: #f59e0b; border: 1px solid rgba(245,158,11,0.4); }
  .risk-Low { background: rgba(16,185,129,0.2); color: #10b981; border: 1px solid rgba(16,185,129,0.4); }
  
  /* Glass card */
  .glass {
    background: rgba(17,24,39,0.85);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    border-radius: 16px;
  }
  .light .glass {
    background: rgba(255,255,255,0.9);
  }
  
  /* Input */
  .input-field {
    width: 100%; padding: 10px 14px;
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 10px; color: var(--text); font-family: 'DM Sans', sans-serif;
    font-size: 13px; outline: none; transition: border-color 0.2s;
  }
  .input-field:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
  
  /* Button */
  .btn-primary {
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    color: white; border: none; border-radius: 10px;
    padding: 10px 20px; cursor: pointer;
    font-family: 'Syne', sans-serif; font-weight: 600; font-size: 13px;
    transition: all 0.2s; letter-spacing: 0.03em;
  }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(59,130,246,0.4); }
  .btn-ghost {
    background: transparent; border: 1px solid var(--border);
    color: var(--text); border-radius: 10px;
    padding: 8px 16px; cursor: pointer;
    font-family: 'DM Sans', sans-serif; font-size: 13px;
    transition: all 0.2s;
  }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }

  /* Nav */
  .topnav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    height: 60px; display: flex; align-items: center; gap: 16px;
    padding: 0 20px;
    background: rgba(10,14,26,0.95);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--border);
  }
  .light .topnav { background: rgba(240,244,255,0.95); }

  /* Sidebar */
  .sidebar {
    position: fixed; left: 0; top: 60px; bottom: 0;
    width: 300px; z-index: 50;
    background: var(--surface);
    border-right: 1px solid var(--border);
    overflow-y: auto; padding: 16px;
  }
  
  /* Right panel */
  .rightpanel {
    position: fixed; right: 0; top: 60px; bottom: 0;
    width: 320px; z-index: 50;
    background: var(--surface);
    border-left: 1px solid var(--border);
    overflow-y: auto; padding: 16px;
  }
  
  /* Map area */
  .map-area {
    position: fixed; left: 300px; right: 320px; top: 60px; bottom: 0;
  }
  
  /* Stat card */
  .stat-card {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 12px; padding: 16px;
    position: relative; overflow: hidden;
  }
  .stat-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
  }
  
  /* Alert */
  .alert-high {
    background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);
    border-radius: 10px; padding: 12px;
    animation: pulse 2s ease-in-out infinite;
  }
  .alert-med {
    background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3);
    border-radius: 10px; padding: 12px;
  }
  .alert-low {
    background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3);
    border-radius: 10px; padding: 12px;
  }
  
  /* Progress bar */
  .progress-track { background: var(--surface2); border-radius: 99px; height: 8px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 99px; transition: width 1s ease; }
  
  /* Vehicle on map */
  .vehicle-dot {
    position: absolute; width: 14px; height: 14px;
    border-radius: 50%; background: var(--accent2);
    border: 2px solid white;
    box-shadow: 0 0 12px var(--accent2);
    transition: left 0.05s linear;
    z-index: 20;
  }
  .vehicle-dot::after {
    content: ''; position: absolute;
    inset: -4px; border-radius: 50%;
    border: 2px solid var(--accent2);
    animation: ripple 1.5s ease-out infinite;
  }
  
  /* Map pin */
  .map-pin {
    position: absolute; transform: translate(-50%, -50%);
    cursor: pointer; z-index: 15;
  }
  .pin-dot {
    width: 12px; height: 12px; border-radius: 50%;
    border: 2px solid white;
  }
  .pin-dot.high { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
  .pin-dot.medium { background: var(--warn); box-shadow: 0 0 8px var(--warn); }
  .pin-dot.low { background: var(--safe); box-shadow: 0 0 8px var(--safe); }
  
  /* Heatmap circle */
  .heat-circle {
    position: absolute; border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  
  /* Login */
  .auth-bg {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--bg);
    background-image: radial-gradient(ellipse at 20% 50%, rgba(59,130,246,0.15) 0%, transparent 50%),
                      radial-gradient(ellipse at 80% 20%, rgba(6,182,212,0.1) 0%, transparent 50%);
  }
  
  /* Tab */
  .tab { padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; transition: all 0.2s; border: none; }
  .tab.active { background: var(--accent); color: white; }
  .tab:not(.active) { background: transparent; color: var(--muted); }
  .tab:not(.active):hover { color: var(--text); }
  
  /* Road line on map */
  .road-line { position: absolute; pointer-events: none; z-index: 5; }
  
  /* Tooltip */
  .tooltip {
    position: absolute; bottom: 120%; left: 50%; transform: translateX(-50%);
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 12px; font-size: 12px;
    white-space: nowrap; z-index: 30;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  }
  .tooltip::after {
    content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
    border: 5px solid transparent; border-top-color: var(--surface);
  }

  /* Weather icon anim */
  @keyframes rain { 0% { transform: translateY(0); } 100% { transform: translateY(8px); opacity:0; } }

  /* Admin grid */
  .admin-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  }
  
  /* Mobile & Layout */
  @media (max-width: 900px) {
    .brand-section { display: none !important; }
  }
  @media (max-width: 768px) {
    .sidebar, .rightpanel { display: none; }
    .map-area { left: 0; right: 0; }
  }

  /* Chart bar */
  .chart-bar {
    display: flex; align-items: flex-end; gap: 4px;
    height: 80px;
  }
  .chart-col {
    flex: 1; border-radius: 4px 4px 0 0;
    transition: height 0.5s ease;
    cursor: pointer;
    position: relative;
  }
  .chart-col:hover { filter: brightness(1.3); }
  
  /* Scan effect */
  .scan-container { position: relative; overflow: hidden; }
  .scan-line {
    position: absolute; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, transparent, var(--accent2), transparent);
    animation: scanLine 2s linear infinite;
    opacity: 0.5;
  }
`;

// ============================================================
// ICONS (SVG inline)
// ============================================================
const Icon = {
  Logo: () => (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M14 2L26 8V20L14 26L2 20V8L14 2Z" fill="url(#lg1)" stroke="rgba(59,130,246,0.5)" strokeWidth="1" />
      <path d="M14 8L8 20H20L14 8Z" fill="white" opacity="0.9" />
      <defs><linearGradient id="lg1" x1="2" y1="2" x2="26" y2="26" gradientUnits="userSpaceOnUse">
        <stop stopColor="#3b82f6" /><stop offset="1" stopColor="#06b6d4" />
      </linearGradient></defs>
    </svg>
  ),
  Map: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 20L3 17V4l6 3 6-3 6 3v13l-6-3-6 3z" /><path d="M9 7v13M15 4v13" /></svg>,
  Nav: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>,
  Risk: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  Admin: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>,
  Weather: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" /></svg>,
  Search: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
  User: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  Car: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 17H3v-5l2-5h14l2 5v5h-2M5 17a2 2 0 104 0M5 17h10m0 0a2 2 0 104 0" /></svg>,
  Hospital: () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /><line x1="12" y1="6" x2="12" y2="10" /><line x1="10" y1="8" x2="14" y2="8" /></svg>,
  Police: () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
  Sun: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>,
  Moon: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>,
  Bell: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>,
  ArrowRight: () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>,
  Logout: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>,
  Download: () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  Trophy: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9H4a2 2 0 01-2-2V5h4" /><path d="M18 9h2a2 2 0 002-2V5h-4" /><path d="M12 17v4" /><path d="M8 21h8" /><path d="M6 9a6 6 0 0012 0V3H6v6z" /></svg>,
};

// ============================================================
// MAP COMPONENT (SVG-based interactive map)
// ============================================================
// ============================================================
// SAFE POLYLINE ?? draws the A* route returned by /api/route
// route_coords is [[lat,lng], ...] straight from the backend
// ============================================================
function SafePolyline({ coords, color, riskLevel }) {
  const map = useMap();

  useEffect(() => {
    if (!coords || coords.length < 2) return;
    map.fitBounds(coords, { padding: [40, 40], maxZoom: 15 });
  }, [coords, map]);

  if (!coords || coords.length < 2) return null;

  // Risk-coloured outline + main line
  const outlineColor = riskLevel === 'High' ? '#ef4444' : riskLevel === 'Low' ? '#10b981' : '#f59e0b';

  return (
    <>
      {/* Glow outline */}
      <Polyline
        positions={coords}
        pathOptions={{ color: outlineColor, weight: 10, opacity: 0.25 }}
      />
      {/* Main line */}
      <Polyline
        positions={coords}
        pathOptions={{ color: color || '#3b82f6', weight: 5, opacity: 0.9, dashArray: null }}
      />
    </>
  );
}

function MapUpdater({ centerTo }) {
  const map = useMap();
  useEffect(() => {
    if (centerTo) map.flyTo(centerTo, 14, { duration: 1.5 });
  }, [centerTo, map]);
  return null;
}

// ============================================================
// HAZARD TYPE CONFIG  (colour + emoji for each category)
// ============================================================
const HAZARD_CONFIG = {
  Pothole:       { color: "#f59e0b", emoji: "??️" },
  Accident:      { color: "#ef4444", emoji: "??" },
  "Road Closure":{ color: "#8b5cf6", emoji: "??" },
  Waterlogging:  { color: "#06b6d4", emoji: "??" },
  Debris:        { color: "#6b7280", emoji: "?" },
  "Stray Animals":{ color: "#10b981", emoji: "??" },
  Other:         { color: "#e879f9", emoji: "?️" },
};

function NagpurMap({ pins, heatmap, safeCoords, safeColor, safeRisk, shortCoords, shortColor, vehiclePos, onPinClick, activePin, hazardPins, liveGpsPos }) {
  // Center of Nagpur
  const center = [21.1458, 79.0882];
  const [routeCoords, setRouteCoords] = useState([]);
  const [userLoc, setUserLoc] = useState(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLoc([pos.coords.latitude, pos.coords.longitude]),
        (err) => console.log("Geolocation error:", err),
        { enableHighAccuracy: true }
      );
    }
  }, []);

  return (
    <div className="map-wrapper" style={{ width: "100%", height: "100%", zIndex: 0 }}>
      {/* react-leaflet requires the container to have a height */}
      <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }}>
        <MapUpdater centerTo={userLoc} />
        {userLoc && (
          <Marker
            position={userLoc}
            icon={L.divIcon({
              className: 'custom-user-marker',
              html: `<div style="background-color: #3b82f6; width: 18px; height: 18px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(59,130,246,0.8); animation: pulse 2s infinite;"></div>`,
              iconSize: [24, 24],
              iconAnchor: [12, 12]
            })}
          >
            <Popup>?? Your Exact Live Location</Popup>
          </Marker>
        )}

        {/* Phase 5.1 ?? Live GPS tracking dot (watchPosition) */}
        {liveGpsPos && (
          <Marker
            position={[liveGpsPos.lat, liveGpsPos.lng]}
            icon={L.divIcon({
              className: 'custom-gps-marker',
              html: `
                <div style="position:relative;width:24px;height:24px;">
                  <div style="position:absolute;inset:0;border-radius:50%;background:rgba(6,182,212,0.25);animation:ripple 1.5s ease-out infinite;"></div>
                  <div style="position:absolute;inset:4px;border-radius:50%;background:#06b6d4;border:2px solid white;box-shadow:0 0 12px rgba(6,182,212,0.8);"></div>
                </div>`,
              iconSize: [24, 24],
              iconAnchor: [12, 12]
            })}
          >
            <Popup>
              📍 Live GPS<br/>
              Lat: {liveGpsPos.lat.toFixed(5)}<br/>
              Lng: {liveGpsPos.lng.toFixed(5)}<br/>
              ±{Math.round(liveGpsPos.accuracy)} m
            </Popup>
          </Marker>
        )}
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Street View">
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite View">
            <TileLayer
              url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
              attribution='&copy; Google'
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {/* Shortest route (grey, behind) */}
        {shortCoords && shortCoords.length > 1 && (
          <Polyline
            positions={shortCoords}
            pathOptions={{ color: shortColor || '#6b7280', weight: 4, opacity: 0.5, dashArray: '8 6' }}
          />
        )}

        {/* Safe A* route (coloured, on top) */}
        {safeCoords && safeCoords.length > 1 && (
          <SafePolyline coords={safeCoords} color={safeColor} riskLevel={safeRisk} />
        )}

        {/* Moving vehicle dot along safe route */}
        {vehiclePos !== undefined && safeCoords && safeCoords.length > 0 && (
          <Marker
            position={safeCoords[Math.min(Math.floor((vehiclePos / 100) * safeCoords.length), safeCoords.length - 1)]}
            icon={L.divIcon({
              className: 'custom-car-marker',
              html: `<div style="font-size: 24px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3)); display: flex; align-items: center; justify-content: center; transform: scaleX(-1);">???</div>`,
              iconSize: [24, 24],
              iconAnchor: [12, 12]
            })}
          />
        )}

        {/* Heatmap proxy (circles) */}
        {heatmap && NAGPUR_LOCATIONS.slice(0, 12).map((loc, i) => {
          const nearby = DATASET.filter(d =>
            Math.abs(parseFloat(d.latitude) - loc.lat) < 0.04 &&
            Math.abs(parseFloat(d.longitude) - loc.lng) < 0.04
          );
          const highCount = nearby.filter(d => d.risk_level === "High").length;
          const intensity = Math.min(highCount / 20, 1);
          if (intensity === 0) return null;
          const color = intensity > 0.6 ? "#ef4444" : intensity > 0.3 ? "#f59e0b" : "#10b981";
          return (
            <CircleMarker
              key={`heat-${i}`}
              center={[loc.lat, loc.lng]}
              radius={20 + intensity * 30}
              pathOptions={{ color: 'transparent', fillColor: color, fillOpacity: 0.25 }}
            />
          );
        })}

        {/* ???? Phase 3: Hazard pins (real-time crowdsourced) ???? */}
        {hazardPins && hazardPins.map((h, i) => {
          const cfg = HAZARD_CONFIG[h.hazard_type] || HAZARD_CONFIG.Other;
          return (
            <CircleMarker
              key={`hazard-${h.id ?? i}`}
              center={[h.latitude, h.longitude]}
              radius={9}
              pathOptions={{
                color: cfg.color,
                weight: 3,
                fillColor: cfg.color,
                fillOpacity: 0.85,
              }}
            >
              <Popup autoPan={false}>
                <div style={{ fontSize: 13, minWidth: 170, fontFamily: "DM Sans, sans-serif" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                    {cfg.emoji} {h.hazard_type}
                  </div>
                  {h.description && (
                    <div style={{ color: "#64748b", marginBottom: 4, fontSize: 12 }}>{h.description}</div>
                  )}
                  <div style={{ display: "flex", gap: 8, fontSize: 11, color: "#64748b" }}>
                    <span>?? {h.upvotes ?? 0} upvotes</span>
                    <span style={{
                      color: h.status === "Verified" ? "#10b981" : h.status === "Rejected" ? "#ef4444" : "#f59e0b",
                      fontWeight: 700,
                    }}>{h.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                    {new Date(h.created_at).toLocaleString()}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* Accident pins */}
        {pins && pins.map((pin, i) => {
          const riskClass = pin.risk_level?.toLowerCase();
          const color = riskClass === "high" ? "#ef4444" : riskClass === "medium" ? "#f59e0b" : "#10b981";
          const isActive = activePin === i;
          return (
            <CircleMarker
              key={`pin-${i}`}
              center={[pin.latitude, pin.longitude]}
              radius={isActive ? 10 : 7}
              pathOptions={{ color: 'white', weight: 2, fillColor: color, fillOpacity: 1 }}
              eventHandlers={{
                click: () => onPinClick && onPinClick(i, pin),
              }}
            >
              <Popup autoPan={false}>
                <div style={{ fontSize: 13, minWidth: 160, fontFamily: "DM Sans, sans-serif" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>{pin.location}</div>
                  <div style={{ marginBottom: 4 }}>Risk: <span style={{ color, fontWeight: 700 }}>{pin.risk_level}</span></div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>{pin.weather} · {pin.road_type}</div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

// ============================================================
// LOGIN / REGISTER
// ============================================================
function AuthPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const handle = async () => {
    setErr("");

    // --- Client-side validation ---
    if (mode === "register" && !form.name.trim()) {
      setErr("Full name is required"); return;
    }
    if (!form.email || !form.password) {
      setErr("Email and password are required"); return;
    }
    if (mode === "register" && form.password !== form.confirm) {
      setErr("Passwords don't match"); return;
    }

    setLoading(true);
    try {
      if (mode === "register") {
        // ------ REGISTER ------
        const res = await fetch(`${API}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim().toLowerCase(),
            password: form.password,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setErr(data.error || "Registration failed"); setLoading(false); return; }
        // Auto-login after successful registration
        const loginRes = await fetch(`${API}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email.trim().toLowerCase(), password: form.password }),
        });
        const loginData = await loginRes.json();
        if (!loginRes.ok) { setErr(loginData.error || "Auto-login failed"); setLoading(false); return; }
        localStorage.setItem("token", loginData.access_token);
        onLogin(loginData.user);
      } else {
        // ------ LOGIN ------
        const res = await fetch(`${API}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: form.email.trim().toLowerCase(),
            password: form.password,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setErr(data.error || "Login failed"); setLoading(false); return; }
        // Store JWT in localStorage ?? apiFetch will pick it up automatically
        localStorage.setItem("token", data.access_token);
        onLogin(data.user);
      }
    } catch (e) {
      setErr("Network error ?? is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-bg">
      <style>{STYLES}</style>
      <div style={{ display: "flex", gap: 60, alignItems: "center", padding: 20, maxWidth: 1000, width: "100%", justifyContent: "center" }}>
        {/* Left branding */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }} className="desktop-show brand-section">
          <div className="float" style={{ marginBottom: 24 }}>
            <Icon.Logo />
          </div>
          <h1 style={{ fontSize: 42, lineHeight: 1.1, marginBottom: 16 }}>
            SafeRoute<br /><span style={{ background: "linear-gradient(135deg, #3b82f6, #06b6d4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI</span>
          </h1>
          <p style={{ color: "var(--muted)", lineHeight: 1.7, fontSize: 15, marginBottom: 32 }}>
            Smart city road safety platform powered by machine learning. Predict accident risks before you drive.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {["AI-powered accident risk prediction", "Real-time safety alerts & warnings", "Smart route recommendations", "Blackspot heatmap visualization"].map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--muted)" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
                {f}
              </div>
            ))}
          </div>
        </div>

        {/* Auth card */}
        <div className="glass fade-in" style={{ width: "100%", maxWidth: 400, padding: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
            <Icon.Logo />
            <h2 style={{ fontSize: 20 }}>SafeRoute AI</h2>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 24, background: "var(--surface2)", borderRadius: 10, padding: 4 }}>
            {["login", "register"].map(m => (
              <button key={m} className={`tab ${mode === m ? "active" : ""}`}
                style={{ flex: 1, textTransform: "capitalize" }}
                onClick={() => setMode(m)}>{m}</button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {mode === "register" && (
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: "0.08em" }}>Full Name</label>
                <input className="input-field" placeholder="John Driver"
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
            )}
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: "0.08em" }}>Email</label>
              <input className="input-field" type="email" placeholder="you@example.com"
                value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: "0.08em" }}>Password</label>
              <input className="input-field" type="password" placeholder="••••••••"
                value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
            {mode === "register" && (
              <div>
                <label style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: "0.08em" }}>Confirm Password</label>
                <input className="input-field" type="password" placeholder="••••••••"
                  value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} />
              </div>
            )}
            {err && <div style={{ color: "#ef4444", fontSize: 12, background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: "8px 12px" }}>{err}</div>}
            <button className="btn-primary" style={{ width: "100%", padding: "12px", marginTop: 4, position: "relative" }} onClick={handle}>
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.6s linear infinite", display: "inline-block" }} />
                  {mode === "login" ? "Signing in..." : "Creating account..."}
                </span>
              ) : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </div>

          <div style={{ marginTop: 20, padding: "12px", background: "var(--surface2)", borderRadius: 10, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
            Register a free account to get started
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TOP NAV
// ============================================================
function TopNav({ user, page, setPage, darkMode, setDarkMode, onLogout }) {
  const pages = [
    { id: "dashboard",   label: "Map",         icon: Icon.Map },
    { id: "navigation",  label: "Navigate",    icon: Icon.Nav },
    { id: "risk",        label: "Risk Analysis",icon: Icon.Risk },
    { id: "leaderboard", label: "Leaderboard",  icon: Icon.Trophy },
    { id: "admin",       label: "Admin",        icon: Icon.Admin },
  ];

  return (
    <nav className="topnav">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 8 }}>
        <Icon.Logo />
        <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15 }}>SafeRoute AI</span>
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        {pages.map(p => (
          <button key={p.id} className={`tab ${page === p.id ? "active" : ""}`}
            onClick={() => setPage(p.id)}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <p.icon />{p.label}
          </button>
        ))}
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn-ghost" style={{ padding: "6px 10px" }} onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? <Icon.Sun /> : <Icon.Moon />}
        </button>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
          background: "var(--surface2)", borderRadius: 20, border: "1px solid var(--border)", fontSize: 12
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: "50%",
            background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700, color: "white"
          }}>
            {user?.name?.[0]?.toUpperCase() || "U"}
          </div>
          <span>{user?.name || "User"}</span>
        </div>
        <button className="btn-ghost" style={{ padding: "6px 10px", color: "var(--danger)" }} onClick={onLogout}>
          <Icon.Logout />
        </button>
      </div>
    </nav>
  );
}

// ============================================================
// DASHBOARD PAGE
// ============================================================
// ============================================================
// REPORT HAZARD MODAL
// ============================================================
const HAZARD_TYPES = ["Pothole", "Accident", "Road Closure", "Waterlogging", "Debris", "Stray Animals", "Other"];

function ReportHazardModal({ onClose, onSubmitted }) {
  const [form, setForm] = useState({ hazard_type: "Pothole", description: "", latitude: "", longitude: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [locating, setLocating] = useState(false);

  // Auto-fill with current GPS location
  const getLocation = () => {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm(f => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) }));
        setLocating(false);
      },
      () => { setErr("Could not get location"); setLocating(false); }
    );
  };

  const submit = async () => {
    setErr("");
    if (!form.latitude || !form.longitude) { setErr("Please set a location first"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/hazards`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          hazard_type:  form.hazard_type,
          description:  form.description,
          latitude:     parseFloat(form.latitude),
          longitude:    parseFloat(form.longitude),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Submit failed"); setLoading(false); return; }
      onSubmitted(data.hazard);
      onClose();
    } catch (e) {
      setErr("Network error ?? is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div className="glass fade-in" style={{ width: "100%", maxWidth: 420, padding: 28, borderRadius: 18 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ fontSize: 17, display: "flex", alignItems: "center", gap: 8 }}>?️ Report a Hazard</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 20 }}>??</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Hazard type */}
          <div>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Hazard Type</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {HAZARD_TYPES.map(t => {
                const cfg = HAZARD_CONFIG[t] || HAZARD_CONFIG.Other;
                return (
                  <button key={t} onClick={() => setForm(f => ({ ...f, hazard_type: t }))}
                    style={{
                      padding: "6px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                      border: `1px solid ${form.hazard_type === t ? cfg.color : "var(--border)"}`,
                      background: form.hazard_type === t ? `${cfg.color}22` : "var(--surface2)",
                      color: form.hazard_type === t ? cfg.color : "var(--muted)",
                      fontWeight: form.hazard_type === t ? 700 : 400,
                      transition: "all 0.15s",
                    }}>{cfg.emoji} {t}</button>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Description (optional)</label>
            <textarea className="input-field" rows={2}
              placeholder="e.g. Large pothole near bus stop, right lane blocked..."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ resize: "none" }}
            />
          </div>

          {/* Location */}
          <div>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Location</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input-field" placeholder="Latitude"
                value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}
                style={{ flex: 1 }} />
              <input className="input-field" placeholder="Longitude"
                value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}
                style={{ flex: 1 }} />
            </div>
            <button onClick={getLocation} disabled={locating}
              style={{
                marginTop: 8, padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--surface2)", color: "var(--text)", fontSize: 12, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}>
              {locating ? "?? Locating..." : "?? Use My GPS Location"}
            </button>
          </div>

          {err && <div style={{ color: "#ef4444", fontSize: 12, background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: "8px 12px" }}>{err}</div>}

          <button className="btn-primary" onClick={submit} disabled={loading}
            style={{ width: "100%", padding: 12, marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {loading
              ? <><span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.6s linear infinite", display: "inline-block" }} /> Submitting...</>
              : "?? Submit Hazard Report"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DashboardPage() {
  const [activePin, setActivePin] = useState(null);
  const [showHeat, setShowHeat] = useState(true);
  const [showPins, setShowPins] = useState(true);
  const [filter, setFilter] = useState("All");
  const [apiStats, setApiStats] = useState(null);
  const [apiPins, setApiPins] = useState([]);
  const [backendOk, setBackendOk] = useState(null);

  //  Phase 3: Hazard state 
  const [hazardPins, setHazardPins] = useState([]);        // all hazards shown on map
  const [showHazards, setShowHazards] = useState(true);    // toggle layer
  const [showHazardModal, setShowHazardModal] = useState(false);  // modal open/close
  const [liveToast, setLiveToast] = useState(null);        // toast for incoming WS events
  const socketRef = useRef(null);

  useEffect(() => {
    apiFetch("/health").then(d => setBackendOk(!!d?.status));
    apiFetch("/statistics").then(d => { if (d) setApiStats(d); });
    apiFetch("/dataset?limit=80").then(d => { if (d?.data) setApiPins(d.data); });

    //  Load existing hazards from REST endpoint ??????????????????????????????
    apiFetch("/hazards").then(d => { if (d?.hazards) setHazardPins(d.hazards); });

    //  Connect to Flask-SocketIO ????????????????????????????????????????????????????????????
    const socket = io("http://localhost:5000", { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => console.log("[WS] Connected ?? id:", socket.id));
    socket.on("disconnect", () => console.log("[WS] Disconnected"));

    //  new_hazard: prepend instantly to the map ??????????????????????????????
    socket.on("new_hazard", (hazard) => {
      setHazardPins(prev => [hazard, ...prev]);
      const cfg = HAZARD_CONFIG[hazard.hazard_type] || HAZARD_CONFIG.Other;
      setLiveToast({ msg: `${cfg.emoji} New ${hazard.hazard_type} reported nearby!`, id: Date.now() });
    });

    //  hazard_updated: patch the existing hazard in state ??????????
    socket.on("hazard_updated", (updated) => {
      setHazardPins(prev => prev.map(h => h.id === updated.id ? updated : h));
    });

    return () => { socket.disconnect(); };
  }, []);

  // Auto-dismiss toast after 4 s
  useEffect(() => {
    if (!liveToast) return;
    const t = setTimeout(() => setLiveToast(null), 4000);
    return () => clearTimeout(t);
  }, [liveToast]);

  const pins = apiPins.length > 0 ? apiPins : DATASET.slice(0, 80);
  const displayPins = pins.filter(d => filter === "All" || d.risk_level === filter);

  const stats = apiStats ? {
    total: apiStats.total,
    high: apiStats.high,
    med: apiStats.medium,
    low: apiStats.low,
  } : {
    total: DATASET.length,
    high: DATASET.filter(d => d.risk_level === "High").length,
    med: DATASET.filter(d => d.risk_level === "Medium").length,
    low: DATASET.filter(d => d.risk_level === "Low").length,
  };

  return (
    <div style={{ display: "flex", height: "100vh", paddingTop: 60 }}>
      {/* Left sidebar */}
      <div className="sidebar">
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Map Controls</h3>

        {/* Backend status */}
        <div style={{
          marginBottom: 14, padding: "8px 12px", borderRadius: 8,
          background: backendOk === true ? "rgba(16,185,129,0.1)" : backendOk === false ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)",
          border: `1px solid ${backendOk === true ? "rgba(16,185,129,0.3)" : backendOk === false ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)"}`,
          fontSize: 11, display: "flex", alignItems: "center", gap: 6
        }}>
          <span style={{ color: backendOk === true ? "#10b981" : backendOk === false ? "#ef4444" : "#f59e0b" }}>?</span>
          <span style={{ color: "var(--muted)" }}>
            {backendOk === null ? "Connecting to backend..." : backendOk ? "Flask API connected" : "Backend offline ?? using local data"}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {["All", "High", "Medium", "Low"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{
                padding: "8px 14px", borderRadius: 8, cursor: "pointer",
                background: filter === f ? (f === "High" ? "rgba(239,68,68,0.2)" : f === "Medium" ? "rgba(245,158,11,0.2)" : f === "Low" ? "rgba(16,185,129,0.2)" : "var(--accent)") : "var(--surface2)",
                border: `1px solid ${filter === f ? (f === "High" ? "rgba(239,68,68,0.5)" : f === "Medium" ? "rgba(245,158,11,0.5)" : f === "Low" ? "rgba(16,185,129,0.5)" : "var(--accent)") : "var(--border)"}`,
                color: filter === f ? (f === "High" ? "#ef4444" : f === "Medium" ? "#f59e0b" : f === "Low" ? "#10b981" : "white") : "var(--text)",
                fontSize: 13, textAlign: "left", display: "flex", justifyContent: "space-between",
                fontFamily: "DM Sans, sans-serif",
              }}>
              <span>{f === "All" ? "All Locations" : `${f} Risk`}</span>
              <span style={{ opacity: 0.7, fontSize: 11 }}>
                {f === "All" ? stats.total : f === "High" ? stats.high : f === "Medium" ? stats.med : stats.low}
              </span>
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }} onClick={() => setShowHeat(!showHeat)}>
            <div style={{
              width: 36, height: 20, borderRadius: 10,
              background: showHeat ? "var(--accent)" : "var(--surface2)",
              position: "relative", transition: "background 0.2s",
              border: "1px solid var(--border)",
            }}>
              <div style={{
                position: "absolute", top: 2, left: showHeat ? "calc(100% - 18px)" : 2,
                width: 14, height: 14, borderRadius: "50%", background: "white",
                transition: "left 0.2s",
              }} />
            </div>
            Heatmap Overlay
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }} onClick={() => setShowPins(!showPins)}>
            <div style={{
              width: 36, height: 20, borderRadius: 10,
              background: showPins ? "var(--accent)" : "var(--surface2)",
              position: "relative", transition: "background 0.2s",
              border: "1px solid var(--border)",
            }}>
              <div style={{
                position: "absolute", top: 2, left: showPins ? "calc(100% - 18px)" : 2,
                width: 14, height: 14, borderRadius: "50%", background: "white",
                transition: "left 0.2s",
              }} />
            </div>
            Show Blackspots
          </label>
        </div>

        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Statistics</h3>
        {[
          { label: "High Risk Zones", val: stats.high, color: "#ef4444", pct: Math.round(stats.high / stats.total * 100) },
          { label: "Medium Risk", val: stats.med, color: "#f59e0b", pct: Math.round(stats.med / stats.total * 100) },
          { label: "Safe Zones", val: stats.low, color: "#10b981", pct: Math.round(stats.low / stats.total * 100) },
        ].map(s => (
          <div key={s.label} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
              <span style={{ color: "var(--muted)" }}>{s.label}</span>
              <span style={{ color: s.color, fontWeight: 700 }}>{s.val}</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${s.pct}%`, background: s.color }} />
            </div>
          </div>
        ))}

        <div style={{ marginTop: 20, padding: 12, background: "rgba(239,68,68,0.08)", borderRadius: 10, border: "1px solid rgba(239,68,68,0.2)" }}>
          <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ animation: "pulse 1s infinite", display: "inline-block" }}>?</span> Live Alert
          </div>
          <div style={{ fontSize: 12, color: "var(--text)" }}>High accident risk detected near <strong>Sitabuldi Junction</strong></div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Rain + Night conditions · 87% risk</div>
        </div>
          {/* Hazard layer toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, marginTop: 4 }} onClick={() => setShowHazards(!showHazards)}>
            <div style={{
              width: 36, height: 20, borderRadius: 10,
              background: showHazards ? "#f59e0b" : "var(--surface2)",
              position: "relative", transition: "background 0.2s",
              border: "1px solid var(--border)",
            }}>
              <div style={{
                position: "absolute", top: 2, left: showHazards ? "calc(100% - 18px)" : 2,
                width: 14, height: 14, borderRadius: "50%", background: "white",
                transition: "left 0.2s",
              }} />
            </div>
            <span>?️ Hazard Pins <span style={{ color: "var(--muted)", fontSize: 11 }}>({hazardPins.length})</span></span>
          </label>
        </div>

      {/* Map */}
      <div className="map-area">
        {/* ???? Report Hazard floating button ???? */}
        <button
          id="report-hazard-btn"
          onClick={() => setShowHazardModal(true)}
          style={{
            position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
            zIndex: 500,
            background: "linear-gradient(135deg, #ef4444, #f59e0b)",
            color: "white", border: "none", borderRadius: 28,
            padding: "12px 24px", fontSize: 14, fontWeight: 700,
            fontFamily: "Syne, sans-serif", cursor: "pointer",
            boxShadow: "0 4px 24px rgba(239,68,68,0.45)",
            display: "flex", alignItems: "center", gap: 8,
            transition: "transform 0.15s, box-shadow 0.15s",
            letterSpacing: "0.03em",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateX(-50%) translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 32px rgba(239,68,68,0.55)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "translateX(-50%)"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(239,68,68,0.45)"; }}
        >
          ?? Report Hazard
        </button>

        {/* ???? Live toast notification ???? */}
        {liveToast && (
          <div key={liveToast.id} style={{
            position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
            zIndex: 600,
            background: "rgba(245,158,11,0.95)", color: "white",
            borderRadius: 12, padding: "10px 20px",
            fontSize: 13, fontWeight: 600,
            boxShadow: "0 4px 20px rgba(245,158,11,0.4)",
            animation: "fadeIn 0.3s ease forwards",
            whiteSpace: "nowrap",
          }}>
            {liveToast.msg}
          </div>
        )}

        <NagpurMap
          pins={showPins ? displayPins : []}
          heatmap={showHeat}
          activePin={activePin}
          onPinClick={(i) => setActivePin(activePin === i ? null : i)}
          hazardPins={showHazards ? hazardPins : []}
        />

        {/* Report Hazard Modal */}
        {showHazardModal && (
          <ReportHazardModal
            onClose={() => setShowHazardModal(false)}
            onSubmitted={(h) => setHazardPins(prev => [h, ...prev])}
          />
        )}
      </div>

      {/* Right panel */}
      <div className="rightpanel">
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>Accident Hotspots</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {NAGPUR_LOCATIONS.slice(0, 10).map((loc, i) => {
            const nearby = DATASET.filter(d =>
              Math.abs(parseFloat(d.latitude) - loc.lat) < 0.03 &&
              Math.abs(parseFloat(d.longitude) - loc.lng) < 0.03
            );
            const high = nearby.filter(d => d.risk_level === "High").length;
            const risk = high > 8 ? "High" : high > 4 ? "Medium" : "Low";
            return (
              <div key={i} style={{
                padding: "10px 12px", background: "var(--surface2)",
                borderRadius: 10, border: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                cursor: "pointer", transition: "border-color 0.2s",
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{loc.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{nearby.length} records</div>
                </div>
                <span className={`risk-badge risk-${risk}`}>{risk}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// AUTOCOMPLETE COMPONENT
// ============================================================
function LocationAutocomplete({ placeholder, value, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [show, setShow] = useState(false);
  const debounceRef = useRef();

  const handleInput = (e) => {
    const val = e.target.value;
    onChange(val);
    setShow(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!val.trim()) {
      setSuggestions(NAGPUR_LOCATIONS.map(l => l.name));
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const local = NAGPUR_LOCATIONS.filter(l => l.name.toLowerCase().includes(val.toLowerCase())).map(l => l.name);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&countrycodes=in&limit=5`);
        const data = await res.json();
        const remote = data ? data.map(d => d.display_name) : [];
        setSuggestions([...new Set([...local, ...remote])]);
      } catch (err) {
        setSuggestions(local);
      }
    }, 500);
  };

  return (
    <div style={{ position: "relative", flex: 1 }}>
      <input
        className="input-field"
        style={{ paddingLeft: 28 }}
        placeholder={placeholder}
        value={value}
        onChange={handleInput}
        onFocus={() => {
          setShow(true);
          if (!value && suggestions.length === 0) setSuggestions(NAGPUR_LOCATIONS.map(l => l.name));
        }}
        onBlur={() => setTimeout(() => setShow(false), 200)}
      />
      {show && suggestions.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 8, marginTop: 4, zIndex: 100, maxHeight: 200, overflowY: "auto",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)", textAlign: "left"
        }}>
          {suggestions.map((s, i) => (
            <div
              key={i}
              style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", borderBottom: i < suggestions.length - 1 ? "1px solid var(--border)" : "none" }}
              onMouseDown={() => { onChange(s); setShow(false); }}
            >
              <div style={{ fontWeight: 600, color: "var(--text)" }}>{s.split(',')[0]}</div>
              {s.includes(',') && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{s.substring(s.indexOf(',') + 1).trim()}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// NAVIGATION PAGE
// ============================================================
function NavigationPage() {
  const [src, setSrc] = useState("");
  const [dst, setDst] = useState("");
  const [routes, setRoutes] = useState(null);       // [{name,coords,color,risk,...}]
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [safeCoords,  setSafeCoords]  = useState(null);  // [[lat,lng],...] from A*
  const [shortCoords, setShortCoords] = useState(null);  // [[lat,lng],...] shortest
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError,   setRouteError]   = useState("");
  const [vehiclePos, setVehiclePos] = useState(5);
  const [driving, setDriving] = useState(false);
  const [step, setStep] = useState(0);
  const [dynamicSummary, setDynamicSummary] = useState(null);
  const [weatherData, setWeatherData] = useState(null);
  const [trafficData, setTrafficData] = useState(null);
  const driveRef = useRef(null);

  //  Phase 5 Step 5.1: Live GPS Telematics 
  const [gpsPos,       setGpsPos]       = useState(null);   // { lat, lng, accuracy }
  const [gpsSpeed,     setGpsSpeed]     = useState(0);      // km/h (calculated)
  const [gpsHeading,   setGpsHeading]   = useState(null);   // degrees (0-360)
  const [gpsError,     setGpsError]     = useState("");
  const [gpsTracking,  setGpsTracking]  = useState(false);
  const [gpsFix,       setGpsFix]       = useState(false);  // true once first fix received
  const prevGpsRef  = useRef(null);   // { lat, lng, ts } ?? for manual speed calc
  const watchIdRef  = useRef(null);   // geolocation watchId

  //  Phase 5 Step 5.2: Geo-fence Alerts ????????????????????????????????????????????????????????????????????????
  const GEOFENCE_RADIUS_M = 500;   // metres
  const [geoAlert,     setGeoAlert]    = useState(null); // { location, dist } | null
  const [alertDismiss, setAlertDismiss] = useState(false); // user closed this alert
  const lastAlertRef = useRef(null);  // name of zone currently alerting (avoid re-beep)
  const audioCtxRef  = useRef(null);  // Web Audio context (lazy-init)

  // Pre-compute the list of unique High-Risk locations (name + coords) once
  const HIGH_RISK_PINS = (() => {
    const seen = new Set();
    return DATASET
      .filter(d => d.risk_level === "High")
      .reduce((acc, d) => {
        const key = `${parseFloat(d.latitude).toFixed(3)},${parseFloat(d.longitude).toFixed(3)}`;
        if (!seen.has(key)) {
          seen.add(key);
          acc.push({ name: d.location, lat: parseFloat(d.latitude), lng: parseFloat(d.longitude) });
        }
        return acc;
      }, []);
  })();

  // Play a short alarm using Web Audio API (no external file needed)
  const playAlarm = () => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtxRef.current;
      const playBeep = (freq, startT, duration) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "square";
        osc.frequency.setValueAtTime(freq, startT);
        gain.gain.setValueAtTime(0.35, startT);
        gain.gain.exponentialRampToValueAtTime(0.001, startT + duration);
        osc.start(startT); osc.stop(startT + duration);
      };
      const t = ctx.currentTime;
      // Three descending beeps: 880 Hz ?? 660 Hz ?? 440 Hz
      playBeep(880, t,       0.18);
      playBeep(660, t + 0.2, 0.18);
      playBeep(440, t + 0.4, 0.28);
    } catch (e) { console.warn("Audio error:", e); }
  };
  //  end geo-fence ??????????????????????????????????????????????????????????????????????????????????????????????????????????

  // Haversine distance in metres between two lat/lng points
  const haversineM = (la1, lo1, la2, lo2) => {
    const R = 6_371_000;
    const dLat = (la2 - la1) * Math.PI / 180;
    const dLon = (lo2 - lo1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  // Start / stop GPS watch
  const startGPS = () => {
    if (!navigator.geolocation) { setGpsError("Geolocation not supported by this browser."); return; }
    setGpsError("");
    setGpsTracking(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, speed, heading, accuracy } = pos.coords;
        const ts = pos.timestamp;

        // Use browser-provided speed (m/s) when available, else calculate from positions
        let kmh = 0;
        if (speed !== null && speed >= 0) {
          kmh = speed * 3.6;
        } else if (prevGpsRef.current) {
          const dt = (ts - prevGpsRef.current.ts) / 1000;  // seconds
          if (dt > 0) {
            const dm = haversineM(prevGpsRef.current.lat, prevGpsRef.current.lng, lat, lng);
            kmh = (dm / dt) * 3.6;
          }
        }

        // Clamp to sane road speed (GPS noise can produce spikes)
        kmh = Math.min(Math.round(kmh * 10) / 10, 200);

        prevGpsRef.current = { lat, lng, ts };
        setGpsPos({ lat, lng, accuracy });
        setGpsSpeed(kmh);
        setGpsHeading(heading);
        setGpsFix(true);

        //  Step 5.2: Geo-fence check ????????????????????????????????????????????????????????????????????????????
        let nearest = null;
        let nearestDist = Infinity;
        for (const pin of HIGH_RISK_PINS) {
          const d = haversineM(lat, lng, pin.lat, pin.lng);
          if (d <= GEOFENCE_RADIUS_M && d < nearestDist) {
            nearestDist = d;
            nearest = pin;
          }
        }
        if (nearest) {
          // Only beep + reset dismiss when entering a NEW zone
          if (lastAlertRef.current !== nearest.name) {
            lastAlertRef.current = nearest.name;
            setAlertDismiss(false);
            playAlarm();
          }
          setGeoAlert({ location: nearest.name, dist: Math.round(nearestDist) });
        } else {
          lastAlertRef.current = null;
          setGeoAlert(null);
        }
      },
      (err) => {
        const msgs = ["", "Permission denied", "Position unavailable", "Timeout"];
        setGpsError(`GPS error: ${msgs[err.code] || err.message}`);
        setGpsTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  };

  const stopGPS = () => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    setGpsTracking(false);
    setGpsSpeed(0);
  };

  // Clean up watch on unmount
  useEffect(() => () => { if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current); }, []);

  //  Step 5.3: Speed-in-zone score deduction (throttled to 1 call per 30 s) ????
  const lastDeductRef = useRef(0);
  useEffect(() => {
    if (!geoAlert || !gpsTracking) return;           // only when inside a zone
    const SAFE_SPEED_KMH = 40;                       // speed limit inside risk zones
    if (gpsSpeed <= SAFE_SPEED_KMH) return;          // under the limit ?? no penalty
    const now = Date.now();
    if (now - lastDeductRef.current < 30_000) return;// throttle: max once per 30 s
    lastDeductRef.current = now;

    // Deduction scales with excess speed: 1 pt per 10 km/h over limit (max 10 pts)
    const excess    = gpsSpeed - SAFE_SPEED_KMH;
    const deduction = Math.min(10, Math.max(1, Math.round(excess / 10)));

    apiFetch("/score/deduct", {
      method: "POST",
      body: JSON.stringify({
        deduction,
        reason:    "Speeding in high-risk zone",
        zone:      geoAlert.location,
        speed_kmh: gpsSpeed,
      }),
    }).then(res => {
      if (res?.new_score !== undefined)
        console.log(`[SCORE] -${deduction} pts -> ${res.new_score} (${gpsSpeed.toFixed(1)} km/h in ${geoAlert.location})`);
    });
  }, [geoAlert, gpsSpeed, gpsTracking]);
  //  end score deduction ??????????????????????????????????????????????????????????????????????????????????????????????????????
  //  end GPS telematics ??????????????????????????????????????????????????????????????????????????????????????????????????????

  useEffect(() => {
    // Fetch live weather via our Flask backend (OpenWeatherMap)
    const W_ICONS = { Clear: "??️", Cloudy: "??", Fog: "??️", Haze: "??", Rain: "??️" };
    apiFetch("/live-weather?lat=21.1458&lon=79.0882").then(d => {
      if (d?.weather) setWeatherData({ temp: d.temperature, text: d.weather, icon: W_ICONS[d.weather] || "??️", humidity: d.humidity });
    });
    // Fetch live traffic via our Flask backend (TomTom)
    apiFetch("/live-traffic?lat=21.1458&lon=79.0882").then(d => {
      if (d?.traffic_density) setTrafficData(d);
    });
  }, []);

  async function geocode(address) {
    if (!address) return null;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=in&limit=1`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name.split(',')[0] };
    } catch (err) { console.error("Geocode failed", err); }
    return null;
  }

  const findRoutes = async () => {
    setRouteError("");
    setSafeCoords(null);
    setShortCoords(null);
    setRoutes(null);

    const getLoc = async (val) => {
      if (!val) return null;
      val = val.trim();
      const exact = NAGPUR_LOCATIONS.find(l => l.name.toLowerCase() === val.toLowerCase());
      if (exact) return exact;
      const coords = val.split(',').map(s => parseFloat(s.trim()));
      if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1]))
        return { lat: coords[0], lng: coords[1], name: "Custom Location" };
      return await geocode(val);
    };

    const srcLoc = await getLoc(src);
    const dstLoc = await getLoc(dst);
    if (!srcLoc || !dstLoc) { setRouteError("Could not find one or both locations."); return; }

    setRouteLoading(true);
    try {
      // Phase 4.3: A* backend — 60 s timeout (graph loads on first request)
      const [safeRes, shortRes] = await Promise.all([
        apiFetch("/route", {
          method: "POST",
          body: JSON.stringify({
            origin_lat: srcLoc.lat, origin_lng: srcLoc.lng,
            dest_lat:   dstLoc.lat, dest_lng:   dstLoc.lng,
            risk_penalty: 500,
          }),
        }, 60000),
        apiFetch("/route", {
          method: "POST",
          body: JSON.stringify({
            origin_lat: srcLoc.lat, origin_lng: srcLoc.lng,
            dest_lat:   dstLoc.lat, dest_lng:   dstLoc.lng,
            risk_penalty: 0,
          }),
        }, 60000),
      ]);

      // Both timed out / failed — give the user a clear retry message
      if (!safeRes && !shortRes) {
        setRouteError(
          "Road network is loading (first run can take 30-60 s). Please try again in a moment."
        );
        return;
      }

      // Fallback risk prediction if backend is offline
      const fallback = (road) => predictRisk({
        hour: new Date().getHours(), weather: "Clear",
        roadType: road, density: "Low",
        lat: srcLoc.lat, lng: srcLoc.lng,
      });

      const toRisk = (res, road) => res
        ? { level: res.risk_level, highPct: Math.round((res.avg_risk_score || 0.3) * 100), medPct: 30, lowPct: 20 }
        : fallback(road);

      const r1 = {
        name: "Safest Route",
        dist: safeRes  ? `${safeRes.total_distance_km} km`  : "--",
        time: safeRes  ? `~${Math.round(safeRes.total_distance_km / 0.3)} min` : "--",
        risk: toRisk(safeRes, "Urban"),
        color: "#10b981",
        coords: safeRes?.route_coords  || null,
        backendOk: !!safeRes,
      };
      const r2 = {
        name: "Shortest Route",
        dist: shortRes ? `${shortRes.total_distance_km} km` : "--",
        time: shortRes ? `~${Math.round(shortRes.total_distance_km / 0.35)} min` : "--",
        risk: toRisk(shortRes, "Highway"),
        color: "#6b7280",
        coords: shortRes?.route_coords || null,
        backendOk: !!shortRes,
      };

      setRoutes([r1, r2]);
      setSafeCoords(r1.coords);
      setShortCoords(r2.coords);
      setSelectedRoute(0);
      setVehiclePos(5);
    } catch (e) {
      setRouteError("Routing failed — is the backend running?");
    } finally {
      setRouteLoading(false);
    }
  };


  const startDrive = () => {
    setDriving(true);
    setVehiclePos(0);
    let pos = 0;
    driveRef.current = setInterval(() => {
      pos += 1; // 1% per tick
      setVehiclePos(pos);
      if (pos >= 100) {
        clearInterval(driveRef.current);
        setDriving(false);
        setStep(3);
      }
    }, 100);
  };

  useEffect(() => () => clearInterval(driveRef.current), []);

  const steps = [
    "Enter your source and destination",
    "Choose your preferred route",
    "Start navigation and drive safely",
  ];

  const nearby = [
    { type: "Hospital", name: "GMCH Nagpur", dist: "1.2 km", icon: Icon.Hospital, color: "#ef4444" },
    { type: "Police", name: "Sitabuldi PS", dist: "0.8 km", icon: Icon.Police, color: "#3b82f6" },
    { type: "Hospital", name: "Orange City Hospital", dist: "2.1 km", icon: Icon.Hospital, color: "#ef4444" },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", paddingTop: 60 }}>
      {/* Left */}
      <div className="sidebar">
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>Route Planner</h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 8, height: 8, borderRadius: "50%", background: "#10b981", zIndex: 2 }} />
              <LocationAutocomplete placeholder="Source location..." value={src} onChange={setSrc} />
            </div>
            <button className="btn-ghost" style={{ padding: "0 12px", background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center" }} title="Use Live Location"
              onClick={() => {
                if (navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition(async (pos) => {
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    setSrc("Locating...");
                    try {
                      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
                      const data = await res.json();
                      if (data && data.display_name) setSrc(data.display_name);
                      else setSrc(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
                    } catch (e) {
                      setSrc(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
                    }
                  }, undefined, { enableHighAccuracy: true });
                } else {
                  alert("Geolocation is not supported by your browser.");
                }
              }}>??</button>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 8, height: 8, borderRadius: "50%", background: "#ef4444", zIndex: 2 }} />
            <LocationAutocomplete placeholder="Destination..." value={dst} onChange={setDst} />
          </div>
          <button className="btn-primary" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }} onClick={findRoutes} disabled={routeLoading}>
            {routeLoading ? <><span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.6s linear infinite", display: "inline-block" }} /> Computing A* Route...</> : "??️ Find Safe Route"}
          </button>
          {routeError && <div style={{ fontSize: 12, color: "#ef4444", background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: "8px 12px" }}>{routeError}</div>}
        </div>

        {/* Routes */}
        {routes && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {routes.map((r, i) => (
              <div key={i} onClick={() => { setSelectedRoute(i); }} style={{
                padding: 12, borderRadius: 10, cursor: "pointer",
                border: `2px solid ${selectedRoute === i ? r.color : "var(--border)"}`,
                background: selectedRoute === i ? `${r.color}15` : "var(--surface2)",
                transition: "all 0.2s",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: selectedRoute === i ? r.color : "var(--text)" }}>{r.name}</span>
                  <span className={`risk-badge risk-${r.risk.level}`}>{r.risk.level}</span>
                </div>
                {!r.backendOk && <div style={{ fontSize: 10, color: "#f59e0b", marginBottom: 4 }}>? Backend offline ?? estimated values</div>}
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted)" }}>
                  <span>⏱ {r.time}</span>
                  <span>?? {r.dist}</span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Risk: {r.risk.highPct}% High · {r.risk.medPct}% Medium</div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{
                      width: `${r.risk.highPct}%`,
                      background: r.risk.level === "High" ? "#ef4444" : r.risk.level === "Medium" ? "#f59e0b" : "#10b981"
                    }} />
                  </div>
                </div>
              </div>
            ))}
            {!driving && (
              <button className="btn-primary" style={{ width: "100%" }} onClick={startDrive}>
                <Icon.Car /> Start Navigation
              </button>
            )}
            {driving && (
              <div style={{ padding: 12, background: "rgba(59,130,246,0.1)", borderRadius: 10, border: "1px solid rgba(59,130,246,0.3)", textAlign: "center", fontSize: 13 }}>
                <span style={{ animation: "pulse 1s infinite", display: "inline-block" }}>?</span> Navigating...
              </div>
            )}
          </div>
        )}

        {/* Nearby emergency */}
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>Emergency Services</h3>
        {nearby.map((n, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: `${n.color}20`, color: n.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <n.icon />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{n.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{n.type} · {n.dist}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Map */}
      <div className="map-area">
        <NagpurMap
          pins={DATASET.slice(0, 40)}
          heatmap={false}
          safeCoords={safeCoords}
          safeColor="#10b981"
          safeRisk={routes?.[0]?.risk?.level}
          shortCoords={shortCoords}
          shortColor="#6b7280"
          vehiclePos={driving ? vehiclePos : undefined}
          liveGpsPos={gpsPos}
        />

        {/* ???? GPS Speed HUD overlay ???? */}
        {gpsTracking && gpsFix && (
          <div style={{
            position: "absolute", bottom: 80, right: 16, zIndex: 500,
            background: "rgba(10,14,26,0.92)", backdropFilter: "blur(12px)",
            border: "1px solid rgba(99,170,255,0.2)", borderRadius: 16,
            padding: "16px 20px", minWidth: 130, textAlign: "center",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}>
            {/* Circular speedometer arc */}
            <svg width="90" height="90" viewBox="0 0 90 90" style={{ display: "block", margin: "0 auto 8px" }}>
              {/* Track */}
              <circle cx="45" cy="45" r="36" fill="none" stroke="rgba(99,170,255,0.12)" strokeWidth="7" />
              {/* Speed arc: max 120 km/h maps to 270° sweep */}
              <circle cx="45" cy="45" r="36" fill="none"
                stroke={gpsSpeed > 80 ? "#ef4444" : gpsSpeed > 50 ? "#f59e0b" : "#10b981"}
                strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${Math.min(gpsSpeed / 120, 1) * 226} 226`}
                strokeDashoffset="56.5"
                style={{ transition: "stroke-dasharray 0.6s ease, stroke 0.4s" }}
              />
              {/* Speed text */}
              <text x="45" y="41" textAnchor="middle" fill="white"
                style={{ fontSize: 22, fontFamily: "Syne, sans-serif", fontWeight: 700 }}>
                {Math.round(gpsSpeed)}
              </text>
              <text x="45" y="55" textAnchor="middle" fill="#64748b"
                style={{ fontSize: 9, fontFamily: "DM Sans, sans-serif" }}>km/h</text>
            </svg>
            <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" }}>Live Speed</div>
            {gpsHeading !== null && (
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                {["N","NE","E","SE","S","SW","W","NW"][Math.round(gpsHeading/45)%8]} · {Math.round(gpsHeading)}°
              </div>
            )}
          </div>
        )}
        {/* ???? Step 5.2: Geo-fence pulsing red alert overlay ???? */}
        {geoAlert && !alertDismiss && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 600,
            pointerEvents: "none",
            // Pulsing red vignette border
            boxShadow: "inset 0 0 60px 20px rgba(239,68,68,0.45)",
            animation: "geofencePulse 1s ease-in-out infinite",
            borderRadius: 0,
          }}>
            {/* Central alert banner */}
            <div style={{
              position: "absolute",
              top: 24, left: "50%", transform: "translateX(-50%)",
              pointerEvents: "all",
              background: "rgba(239,68,68,0.97)",
              backdropFilter: "blur(12px)",
              borderRadius: 16,
              padding: "18px 28px",
              textAlign: "center",
              boxShadow: "0 8px 40px rgba(239,68,68,0.6), 0 0 0 2px rgba(239,68,68,0.8)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              minWidth: 280, maxWidth: 420,
            }}>
              {/* Warning icon */}
              <div style={{ fontSize: 36, animation: "pulse 0.8s ease-in-out infinite" }}>?️</div>
              <div style={{
                fontFamily: "Syne, sans-serif", fontWeight: 800,
                fontSize: 17, color: "white", letterSpacing: "0.02em",
              }}>HIGH RISK ZONE DETECTED</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>
                ?? {geoAlert.location}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                You are {geoAlert.dist} m from a high-risk accident blackspot.
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontStyle: "italic" }}>
                Reduce speed · Stay alert · Watch for hazards
              </div>
              <button
                onClick={() => setAlertDismiss(true)}
                style={{
                  marginTop: 6, padding: "7px 22px",
                  background: "rgba(255,255,255,0.2)",
                  border: "1px solid rgba(255,255,255,0.5)",
                  borderRadius: 8, color: "white",
                  fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 12,
                  cursor: "pointer", letterSpacing: "0.04em",
                }}
              >Dismiss</button>
            </div>
          </div>
        )}

        {/* You have arrived overlay */}
        {step === 3 && (
          <div style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            background: "rgba(16,185,129,0.95)", color: "white",
            padding: "20px 32px", borderRadius: 16, textAlign: "center",
            fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 18,
            backdropFilter: "blur(10px)", zIndex: 20,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
            boxShadow: "0 10px 40px rgba(0,0,0,0.2)"
          }}>
            <div>🎉 You have arrived safely!</div>
            <button className="btn-ghost" style={{ background: "rgba(0,0,0,0.2)", padding: "8px 24px", borderRadius: 8, fontSize: 14, color: "white", cursor: "pointer", border: "none", fontWeight: 600 }} onClick={() => setStep(0)}>
              Close
            </button>
          </div>
        )}
      </div>

      {/* Right panel ?? Live GPS Telematics (Phase 5.1) */}
      <div className="rightpanel">
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>Live Telematics</h3>

        {/* GPS tracking toggle */}
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={gpsTracking ? stopGPS : startGPS}
            style={{
              width: "100%", padding: "11px 0", borderRadius: 10, border: "none", cursor: "pointer",
              fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13,
              background: gpsTracking
                ? "linear-gradient(135deg,#ef4444,#f59e0b)"
                : "linear-gradient(135deg,#3b82f6,#06b6d4)",
              color: "white",
              boxShadow: gpsTracking ? "0 4px 16px rgba(239,68,68,0.35)" : "0 4px 16px rgba(59,130,246,0.35)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "all 0.2s",
            }}
          >
            <span style={{ fontSize: 16 }}>{gpsTracking ? "⏹" : "??"}</span>
            {gpsTracking ? "Stop GPS" : "Start Live GPS"}
          </button>
          {gpsError && <div style={{ marginTop: 8, fontSize: 11, color: "#ef4444", background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: "6px 10px" }}>{gpsError}</div>}
        </div>

        {/* GPS Status */}
        <div className="stat-card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>GPS Status</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: gpsFix ? "rgba(16,185,129,0.15)" : "rgba(100,116,139,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
            }}>??</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: gpsFix ? "#10b981" : "var(--muted)" }}>
                {!gpsTracking ? "Idle" : !gpsFix ? "Acquiring fix..." : "Fixed"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {gpsPos ? `±${Math.round(gpsPos.accuracy)} m accuracy` : "??"}
              </div>
            </div>
          </div>
        </div>

        {/* Speed gauge card */}
        <div className="stat-card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>Current Speed</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{
              fontSize: 42, fontFamily: "Syne, sans-serif", fontWeight: 800, lineHeight: 1,
              color: gpsSpeed > 80 ? "#ef4444" : gpsSpeed > 50 ? "#f59e0b" : gpsTracking ? "#10b981" : "var(--muted)",
              transition: "color 0.3s",
            }}>{Math.round(gpsSpeed)}</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>km/h</span>
          </div>
          {/* Speed bar */}
          <div className="progress-track" style={{ marginTop: 10 }}>
            <div className="progress-fill" style={{
              width: `${Math.min(gpsSpeed / 120 * 100, 100)}%`,
              background: gpsSpeed > 80 ? "#ef4444" : gpsSpeed > 50 ? "#f59e0b" : "#10b981",
              transition: "width 0.5s ease, background 0.3s",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
            <span>0</span><span>40</span><span>80</span><span>120 km/h</span>
          </div>
          {gpsSpeed > 80 && <div style={{ marginTop: 8, fontSize: 11, color: "#ef4444", fontWeight: 700 }}>? Reduce speed!</div>}
        </div>

        {/* Coordinates */}
        <div className="stat-card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>Live Coordinates</div>
          {gpsPos ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                <span style={{ color: "var(--muted)" }}>LAT</span> {gpsPos.lat.toFixed(5)}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                <span style={{ color: "var(--muted)" }}>LNG</span> {gpsPos.lng.toFixed(5)}
              </div>
              {gpsHeading !== null && (
                <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                  <span style={{ color: "var(--muted)" }}>HDG</span> {Math.round(gpsHeading)}°
                  &nbsp;{["N","NE","E","SE","S","SW","W","NW"][Math.round(gpsHeading/45)%8]}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Start GPS tracking to see coordinates</div>
          )}
        </div>

        {/* Weather */}
        <div className="stat-card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Weather</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 24 }}>{weatherData ? weatherData.icon : "??️"}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{weatherData ? weatherData.text : "Clear"}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{weatherData ? weatherData.temp : 28}°C · {weatherData ? weatherData.humidity : 50}% humidity</div>
            </div>
          </div>
        </div>

        {/* Traffic */}
        <div className="stat-card">
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Traffic · <span style={{ color: "#06b6d4" }}>TomTom</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 20 }}>??</div>
            <div>
              <div style={{ fontWeight: 700, color: trafficData?.traffic_density === "High" ? "#ef4444" : trafficData?.traffic_density === "Low" ? "#10b981" : "#f59e0b" }}>
                {trafficData?.traffic_density || "??"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {trafficData ? `${trafficData.current_speed} km/h road speed` : "Loading..."}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// RISK ANALYSIS PAGE
// ============================================================
function RiskPage() {
  const [inputs, setInputs] = useState({ location: "Sitabuldi Junction" });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [liveData, setLiveData] = useState(null);
  const loc = NAGPUR_LOCATIONS.find(l => l.name === inputs.location) || NAGPUR_LOCATIONS[0];
  const [apiError, setApiError] = useState("");

  const analyze = async () => {
    setLoading(true);
    setApiError("");
    setLiveData(null);

    // Step 2.3: only send latitude + longitude
    const data = await apiFetch("/predict", {
      method: "POST",
      body: JSON.stringify({ latitude: loc.lat, longitude: loc.lng }),
    });

    if (data) {
      setLiveData({ weather: data.live_weather, traffic: data.live_traffic, inputs: data.inputs_used });
      setResult({
        level: data.risk_level,
        highPct: Math.round(data.probabilities?.High ?? 0),
        medPct: Math.round(data.probabilities?.Medium ?? 0),
        lowPct: Math.round(data.probabilities?.Low ?? 0),
        confidence: data.confidence,
        source: "flask",
      });
    } else {
      setApiError("Backend offline ?? using local simulation");
      const hour = new Date().getHours();
      const pred = predictRisk({ hour, weather: "Clear", roadType: "City Road", density: "Low", lat: loc.lat, lng: loc.lng });
      setResult({ ...pred, source: "local" });
    }
    setLoading(false);
  };

  // Derive displayed values from live API response (or fallback defaults)
  const usedInputs = liveData?.inputs || {};
  const hour = usedInputs.time_of_day ?? new Date().getHours();
  const weather = usedInputs.weather ?? "Clear";
  const roadType = usedInputs.road_type ?? "City Road";
  const density = usedInputs.traffic_density ?? "Low";

  const factors = result ? [
    { label: "Time of Day", value: hour >= 20 || hour <= 5 ? `${hour}:00 ?? Night` : hour >= 17 ? `${hour}:00 ?? Evening` : `${hour}:00 ?? Day`, score: hour >= 20 || hour <= 5 ? 85 : hour >= 17 ? 50 : 20, color: hour >= 20 || hour <= 5 ? "#ef4444" : hour >= 17 ? "#f59e0b" : "#10b981" },
    { label: "Weather ⮐ Live OWM", value: weather, score: weather === "Rain" ? 75 : weather === "Fog" ? 90 : weather === "Haze" ? 60 : weather === "Cloudy" ? 35 : 20, color: ["Rain", "Fog", "Haze"].includes(weather) ? "#f59e0b" : "#10b981" },
    { label: "Road Type", value: roadType, score: ["Junction", "Highway", "Flyover"].includes(roadType) ? 70 : 35, color: ["Junction", "Highway"].includes(roadType) ? "#ef4444" : "#10b981" },
    { label: "Traffic ⮐ Live TomTom", value: density, score: density === "High" ? 80 : density === "Medium" ? 50 : 20, color: density === "High" ? "#ef4444" : density === "Medium" ? "#f59e0b" : "#10b981" },
  ] : [];

  const riskColor = result?.level === "High" ? "#ef4444" : result?.level === "Medium" ? "#f59e0b" : "#10b981";

  return (
    <div style={{ minHeight: "100vh", paddingTop: 60, display: "flex" }}>
      {/* Input panel */}
      <div className="sidebar" style={{ paddingTop: 20 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>Input Parameters</h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: "0.06em" }}>Location</label>
            <select className="input-field" value={inputs.location}
              onChange={e => setInputs({ ...inputs, location: e.target.value })}>
              {NAGPUR_LOCATIONS.map(l => <option key={l.name}>{l.name}</option>)}
            </select>
          </div>

          <div style={{ padding: "12px 14px", background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 10, fontSize: 12, lineHeight: 1.8 }}>
            <div style={{ color: "#06b6d4", fontWeight: 700, fontSize: 11, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ animation: "pulse 2s infinite", display: "inline-block" }}>?</span> LIVE DATA MODE ACTIVE
            </div>
            <div style={{ color: "var(--muted)" }}>
              ??️ Weather ?? <strong style={{ color: "var(--text)" }}>OpenWeatherMap API</strong><br />
              ?? Traffic ?? <strong style={{ color: "var(--text)" }}>TomTom Traffic API</strong><br />
              ⏰ Time ?? <strong style={{ color: "var(--text)" }}>Current server clock</strong>
            </div>
          </div>

          <button className="btn-primary" style={{ width: "100%", padding: "12px", marginTop: 4 }} onClick={analyze}>
            {loading ? (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.6s linear infinite", display: "inline-block" }} />
                Fetching Live Data...
              </span>
            ) : "?? Analyze Live Risk"}
          </button>

          {apiError && (
            <div style={{ padding: "8px 10px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, fontSize: 11, color: "#f59e0b" }}>
              ?️ {apiError}
            </div>
          )}
          {result?.source && (
            <div style={{ padding: "8px 10px", background: result.source === "flask" ? "rgba(16,185,129,0.1)" : "rgba(100,116,139,0.1)", border: `1px solid ${result.source === "flask" ? "rgba(16,185,129,0.3)" : "rgba(100,116,139,0.3)"}`, borderRadius: 8, fontSize: 11, color: result.source === "flask" ? "#10b981" : "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
              <span>?</span>
              {result.source === "flask" ? "Live result from Flask Random Forest model" : "Local simulation (backend offline)"}
            </div>
          )}
        </div>

        <div style={{ marginTop: 20, padding: 12, background: "var(--surface2)", borderRadius: 10, fontSize: 11, color: "var(--muted)", lineHeight: 1.7 }}>
          <strong style={{ color: "var(--text)", fontFamily: "Syne, sans-serif" }}>Model Info</strong><br />
          Algorithm: Random Forest Classifier<br />
          Trees: 100 · Features: 10<br />
          Training accuracy: 74.5%<br />
          Dataset: 1000 Nagpur records
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflow: "auto", padding: 24, paddingLeft: 320, paddingRight: 340 }}>
        {!result && !loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 16, color: "var(--muted)", textAlign: "center" }}>
            <div style={{ fontSize: 48, opacity: 0.3 }}>??</div>
            <div style={{ fontSize: 15, fontFamily: "Syne, sans-serif" }}>Configure parameters and run prediction</div>
            <div style={{ fontSize: 13 }}>The AI will analyze accident risk using the Random Forest model</div>
          </div>
        )}

        {result && (
          <div className="fade-in">
            {/* Main result */}
            <div className="glass" style={{ padding: 28, marginBottom: 20, textAlign: "center", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 50% 50%, ${riskColor}15 0%, transparent 70%)` }} />
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>AI Prediction Result</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
                {inputs.location} · {hour}:00 · {weather} · Traffic: {density}
              </div>

              <div style={{ position: "relative", width: 140, height: 140, margin: "0 auto 20px" }}>
                <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface2)" strokeWidth="10" />
                  <circle cx="50" cy="50" r="42" fill="none" stroke={riskColor} strokeWidth="10"
                    strokeDasharray={`${2 * Math.PI * 42 * result.highPct / 100} ${2 * Math.PI * 42}`}
                    strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 6px ${riskColor})`, transition: "stroke-dasharray 1s ease" }} />
                </svg>
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: riskColor, fontFamily: "Syne, sans-serif" }}>{result.highPct}%</div>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>RISK</div>
                </div>
              </div>

              <span className={`risk-badge risk-${result.level}`} style={{ fontSize: 14, padding: "8px 20px" }}>{result.level} Risk</span>

              {/* Live data cards shown right below the risk badge */}
              {liveData && (
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <div style={{ flex: 1, padding: "10px 12px", background: "rgba(6,182,212,0.08)", borderRadius: 10, border: "1px solid rgba(6,182,212,0.2)", textAlign: "left" }}>
                    <div style={{ color: "#06b6d4", fontSize: 10, fontWeight: 700, marginBottom: 4 }}>??️ LIVE WEATHER</div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{liveData.weather?.weather ?? "??"}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {liveData.weather?.temperature}°C · {liveData.weather?.humidity}% RH
                    </div>
                  </div>
                  <div style={{ flex: 1, padding: "10px 12px", background: "rgba(245,158,11,0.08)", borderRadius: 10, border: "1px solid rgba(245,158,11,0.2)", textAlign: "left" }}>
                    <div style={{ color: "#f59e0b", fontSize: 10, fontWeight: 700, marginBottom: 4 }}>?? LIVE TRAFFIC</div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{liveData.traffic?.traffic_density ?? "??"}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {liveData.traffic?.current_speed} km/h · {Math.round((liveData.traffic?.congestion_ratio ?? 0) * 100)}% congestion
                    </div>
                  </div>
                </div>
              )}

              <div style={{
                marginTop: 16, padding: "12px 16px", borderRadius: 10,
                background: result.level === "High" ? "rgba(239,68,68,0.1)" : result.level === "Medium" ? "rgba(245,158,11,0.1)" : "rgba(16,185,129,0.1)",
                border: `1px solid ${riskColor}30`, fontSize: 13, color: "var(--text)"
              }}>
                {result.level === "High" ? "?️ Warning: High accident risk zone. Avoid this route or proceed with extreme caution." :
                  result.level === "Medium" ? "? Caution: Moderate accident risk. Drive carefully and reduce speed." :
                    "?? Safe Zone: Low accident risk. Standard driving precautions apply."}
              </div>
            </div>

            {/* Factor analysis */}
            <div className="glass" style={{ padding: 24, marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, fontFamily: "Syne, sans-serif" }}>Risk Factor Analysis</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {factors.map(f => (
                  <div key={f.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                      <span style={{ color: "var(--muted)" }}>{f.label}</span>
                      <span style={{ color: f.color, fontWeight: 600 }}>{f.value}</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${f.score}%`, background: f.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Probability breakdown */}
            <div className="glass" style={{ padding: 24, marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, fontFamily: "Syne, sans-serif" }}>Probability Distribution</h3>
              <div style={{ display: "flex", gap: 12 }}>
                {[
                  { label: "High Risk", pct: result.highPct, color: "#ef4444" },
                  { label: "Medium Risk", pct: result.medPct, color: "#f59e0b" },
                  { label: "Low Risk", pct: result.lowPct, color: "#10b981" },
                ].map(p => (
                  <div key={p.label} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: p.color, fontFamily: "Syne, sans-serif" }}>{p.pct}%</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{p.label}</div>
                    <div className="progress-track" style={{ marginTop: 8 }}>
                      <div className="progress-fill" style={{ width: `${p.pct}%`, background: p.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Historical data */}
            <div className="glass" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, fontFamily: "Syne, sans-serif" }}>Historical Records ?? {inputs.location}</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["Time", "Weather", "Road", "Traffic", "Accidents", "Risk"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontWeight: 600, fontFamily: "Syne, sans-serif", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DATASET.filter(d => d.location === inputs.location).slice(0, 8).map((d, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)", transition: "background 0.1s" }}>
                        <td style={{ padding: "8px 10px" }}>{d.time_of_day}:00</td>
                        <td style={{ padding: "8px 10px" }}>{d.weather}</td>
                        <td style={{ padding: "8px 10px" }}>{d.road_type}</td>
                        <td style={{ padding: "8px 10px" }}>{d.traffic_density}</td>
                        <td style={{ padding: "8px 10px" }}>{d.accident_count}</td>
                        <td style={{ padding: "8px 10px" }}>
                          <span className={`risk-badge risk-${d.risk_level}`}>{d.risk_level}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right */}
      <div className="rightpanel" style={{ paddingTop: 20 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>Safety Recommendations</h3>
        {[
          { icon: "—", title: "Speed", desc: "Reduce to 40 km/h in rain and fog conditions" },
          { icon: "??", title: "Visibility", desc: "Turn on headlights in fog or at night" },
          { icon: "??", title: "Distraction", desc: "Avoid phone use while driving" },
          { icon: "—", title: "Route", desc: "Consider safer alternate routes if risk is high" },
          { icon: "?", title: "Vehicle", desc: "Check brakes and tires before driving in rain" },
        ].map((r, i) => (
          <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: 12 }}>
            <span style={{ fontSize: 20 }}>{r.icon}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>{r.title}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{r.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// LEADERBOARD PAGE  (Phase 5.3)
// ============================================================
function LeaderboardPage() {
  const [board,    setBoard]    = useState([]);
  const [myScore,  setMyScore]  = useState(null);  // { driving_score, name, recent_events }
  const [loading,  setLoading]  = useState(true);
  const [refresh,  setRefresh]  = useState(0);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch("/leaderboard?limit=50"),
      apiFetch("/score/me"),
    ]).then(([lb, me]) => {
      if (lb?.leaderboard) setBoard(lb.leaderboard);
      if (me?.driving_score !== undefined) setMyScore(me);
      setLoading(false);
    });
  }, [refresh]);

  const badgeColor = (badge) => ({
    Elite: { bg: "rgba(251,191,36,0.2)",  border: "rgba(251,191,36,0.6)",  text: "#fbbf24" },
    Safe:  { bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.5)",  text: "#10b981" },
    Fair:  { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.5)",  text: "#f59e0b" },
    Risky: { bg: "rgba(239,68,68,0.15)",  border: "rgba(239,68,68,0.5)",   text: "#ef4444" },
  }[badge] || { bg: "var(--surface2)", border: "var(--border)", text: "var(--muted)" });

  const scoreColor = (s) => s >= 80 ? "#10b981" : s >= 60 ? "#f59e0b" : "#ef4444";

  // SVG ring progress for score (0-100)
  const ScoreRing = ({ score, size = 56 }) => {
    const r = (size / 2) - 5;
    const circ = 2 * Math.PI * r;
    const arc  = (score / 100) * circ;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(99,170,255,0.1)" strokeWidth="5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={scoreColor(score)} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${arc} ${circ}`}
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
        <text x={size/2} y={size/2 + 5} textAnchor="middle"
          fill={scoreColor(score)}
          style={{ fontSize: size * 0.28, fontFamily: "Syne, sans-serif", fontWeight: 800 }}>
          {score}
        </text>
      </svg>
    );
  };

  const medalEmoji = (rank) => rank === 1 ? "??" : rank === 2 ? "??" : rank === 3 ? "??" : `#${rank}`;

  return (
    <div style={{ paddingTop: 60, minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 28, marginBottom: 4 }}>🏆 Safe Driving Leaderboard</h1>
            <p style={{ color: "var(--muted)", fontSize: 13 }}>Drivers ranked by cumulative safe driving score. Stay safe to climb the ranks.</p>
          </div>
          <button className="btn-ghost" onClick={() => setRefresh(r => r + 1)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            ??? Refresh
          </button>
        </div>

        {/* My Score card */}
        {myScore && (
          <div className="stat-card" style={{ marginBottom: 28, padding: "20px 24px", background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(6,182,212,0.08))" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <ScoreRing score={myScore.driving_score} size={72} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Your Score</div>
                <div style={{ fontSize: 22, fontFamily: "Syne, sans-serif", fontWeight: 800 }}>{myScore.name}</div>
                <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                  {["Elite","Safe","Fair","Risky"].map(b => {
                    const bc = badgeColor(b);
                    return (
                      <span key={b} style={{
                        padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                        background: bc.bg, border: `1px solid ${bc.border}`, color: bc.text,
                        opacity: (
                          myScore.driving_score >= 95 && b === "Elite" ||
                          myScore.driving_score >= 80 && myScore.driving_score < 95 && b === "Safe" ||
                          myScore.driving_score >= 60 && myScore.driving_score < 80 && b === "Fair" ||
                          myScore.driving_score < 60 && b === "Risky"
                        ) ? 1 : 0.25,
                      }}>{b}</span>
                    );
                  })}
                </div>
              </div>
              {/* Recent events mini-log */}
              {myScore.recent_events?.length > 0 && (
                <div style={{ minWidth: 200 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Recent Penalties</div>
                  {myScore.recent_events.slice(0, 4).map((ev, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ color: "var(--muted)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.zone || ev.reason}</span>
                      <span style={{ color: "#ef4444", fontWeight: 700 }}>-{ev.deduction} pts</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Leaderboard table */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>
            <div style={{ width: 32, height: 32, border: "3px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
            Loading leaderboard...
          </div>
        ) : board.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>
            No users yet. Register and start driving!
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {board.map((entry, i) => {
              const bc  = badgeColor(entry.badge);
              const isMe = myScore?.name === entry.name;
              return (
                <div key={i} className="slide-in" style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "14px 20px", borderRadius: 14,
                  background: isMe ? "rgba(59,130,246,0.1)" : "var(--surface)",
                  border: `1px solid ${isMe ? "rgba(59,130,246,0.5)" : "var(--border)"}`,
                  animation: `slideIn 0.3s ease ${i * 0.04}s both`,
                  transition: "box-shadow 0.2s",
                  boxShadow: isMe ? "0 0 0 2px rgba(59,130,246,0.3)" : "none",
                }}>
                  {/* Rank medal */}
                  <div style={{
                    width: 36, textAlign: "center",
                    fontFamily: "Syne, sans-serif", fontWeight: 800,
                    fontSize: entry.rank <= 3 ? 22 : 15,
                    color: entry.rank <= 3 ? undefined : "var(--muted)",
                  }}>{medalEmoji(entry.rank)}</div>

                  {/* Avatar */}
                  <div style={{
                    width: 38, height: 38, borderRadius: "50%",
                    background: `linear-gradient(135deg, ${scoreColor(entry.driving_score)}, #06b6d4)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, color: "white",
                    flexShrink: 0,
                  }}>{entry.name[0].toUpperCase()}</div>

                  {/* Name + badge */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {entry.name}
                      {isMe && <span style={{ marginLeft: 8, fontSize: 10, color: "var(--accent)", fontFamily: "DM Sans" }}>(you)</span>}
                    </div>
                    <span style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700,
                      background: bc.bg, border: `1px solid ${bc.border}`, color: bc.text,
                    }}>{entry.badge}</span>
                  </div>

                  {/* Score ring */}
                  <ScoreRing score={entry.driving_score} size={52} />

                  {/* Score bar */}
                  <div style={{ width: 100 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
                      <span>Score</span><span style={{ color: scoreColor(entry.driving_score), fontWeight: 700 }}>{entry.driving_score}/100</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{
                        width: `${entry.driving_score}%`,
                        background: scoreColor(entry.driving_score),
                        transition: "width 1s ease",
                      }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Score legend */}
        <div style={{ marginTop: 28, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            { badge: "Elite", range: "95-100", tip: "Outstanding safe driver" },
            { badge: "Safe",  range: "80-94",  tip: "Good driving habits" },
            { badge: "Fair",  range: "60-79",  tip: "Needs improvement" },
            { badge: "Risky", range: "0-59",   tip: "High-risk behaviour" },
          ].map(({ badge, range, tip }) => {
            const bc = badgeColor(badge);
            return (
              <div key={badge} style={{
                padding: "8px 14px", borderRadius: 10,
                background: bc.bg, border: `1px solid ${bc.border}`,
                textAlign: "center", fontSize: 11,
              }}>
                <div style={{ fontWeight: 700, color: bc.text, marginBottom: 2 }}>{badge} · {range}</div>
                <div style={{ color: "var(--muted)" }}>{tip}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PHASE 6.1 ?? ADMIN ANALYTICS DASHBOARD (Recharts + Role-Gated)
// ============================================================
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, RadialBarChart, RadialBar,
} from "recharts";

//  Role guard wrapper 
function AdminPage() {
  // Read user from localStorage (same pattern as App root)
  const user = (() => {
    try { return JSON.parse(localStorage.getItem("user") || "null"); }
    catch { return null; }
  })();

  if (!user || user.role !== "admin") {
    return (
      <div style={{ minHeight: "100vh", paddingTop: 120, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div style={{ fontSize: 64 }}>🔒</div>
        <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 22, fontWeight: 800 }}>Admin Access Required</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, textAlign: "center", maxWidth: 360 }}>
          This page is restricted to users with the <strong>Admin</strong> role.<br />
          Contact your system administrator to request access.
        </p>
        <div style={{ fontSize: 12, fontFamily: "monospace", background: "var(--surface2)", padding: "6px 14px", borderRadius: 8, color: "#ef4444" }}>
          403 ?? Forbidden: role="{user?.role || "guest"}"
        </div>
      </div>
    );
  }

  return <AdminDashboard />;
}

//  Actual dashboard (only rendered for role=admin) ??????????????????????
function AdminDashboard() {
  const [tab,          setTab]          = useState("charts");
  const [analytics,    setAnalytics]    = useState(null);   // /api/admin/analytics
  const [apiStats,     setApiStats]     = useState(null);
  const [apiBlackspots,setApiBlackspots]= useState([]);
  const [apiDataset,   setApiDataset]   = useState([]);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch("/admin/analytics"),
      apiFetch("/statistics"),
      apiFetch("/blackspots"),
      apiFetch("/dataset?limit=20"),
    ]).then(([an, stats, spots, ds]) => {
      if (an)        setAnalytics(an);
      if (stats)     setApiStats(stats);
      if (spots)     setApiBlackspots(spots);
      if (ds?.data)  setApiDataset(ds.data);
      setLoading(false);
    });
  }, []);

  // Fall back to local data if API is offline
  const stats = apiStats ? {
    total: apiStats.total, high: apiStats.high, med: apiStats.medium,
    low: apiStats.low, avgAcc: apiStats.avg_accidents?.toFixed(1) ?? "??",
  } : {
    total: DATASET.length,
    high: DATASET.filter(d => d.risk_level === "High").length,
    med:  DATASET.filter(d => d.risk_level === "Medium").length,
    low:  DATASET.filter(d => d.risk_level === "Low").length,
    avgAcc: (DATASET.reduce((s, d) => s + d.accident_count, 0) / DATASET.length).toFixed(1),
  };

  const blackspots = apiBlackspots.length > 0 ? apiBlackspots : NAGPUR_LOCATIONS.map(loc => {
    const data = DATASET.filter(d => d.location === loc.name);
    return { ...loc, total: data.length, high: data.filter(d => d.risk_level === "High").length,
      avg_accidents: data.length ? (data.reduce((s, d) => s + d.accident_count, 0) / data.length).toFixed(1) : 0, status: "??" };
  }).sort((a, b) => b.high - a.high);

  const tableData = apiDataset.length > 0 ? apiDataset : DATASET.slice(0, 20);

  //  Build chart data (use API analytics or fallback from DATASET) ????
  const accByHour = analytics?.accidents_by_hour ?? (() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, High: 0, Medium: 0, Low: 0 }));
    DATASET.forEach(d => {
      const h = parseInt(d.time_of_day || 0) % 24;
      const rl = d.risk_level || "Low";
      if (buckets[h][rl] !== undefined) buckets[h][rl]++;
    });
    return buckets;
  })();

  const hazardsByType = (() => {
    if (analytics?.hazards_by_type?.length) return analytics.hazards_by_type.map(h => ({ name: h.type, value: h.count }));
    // Fallback: simulate from DATASET risk levels
    return [
      { name: "Pothole",       value: 38 },
      { name: "Accident",      value: 24 },
      { name: "Road Closure",  value: 12 },
      { name: "Waterlogging",  value: 18 },
      { name: "Other",         value: 8  },
    ];
  })();

  const riskByRoad = analytics?.risk_by_road ?? (() => {
    const m = {};
    DATASET.forEach(d => {
      const rt = d.road_type || "Unknown";
      const rl = d.risk_level || "Low";
      if (!m[rt]) m[rt] = { road_type: rt, High: 0, Medium: 0, Low: 0 };
      if (m[rt][rl] !== undefined) m[rt][rl]++;
    });
    return Object.values(m);
  })();

  const weatherData = analytics?.weather_breakdown ?? (() => {
    const m = {};
    DATASET.forEach(d => { const w = d.weather || "Unknown"; m[w] = (m[w] || 0) + 1; });
    return Object.entries(m).map(([weather, count]) => ({ weather, count }));
  })();

  const downloadCSV = async () => {
    const res = await apiFetch("/dataset?limit=1000");
    const rows = res?.data ?? DATASET;
    const headers = ["id","location","latitude","longitude","time_of_day","weather","road_type","traffic_density","accident_count","risk_level"];
    const csv = [headers.join(","), ...rows.map(d => headers.map(h => d[h]).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "nagpur_accident_dataset.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  //  Step 6.2: PDF Report generation (jsPDF + html2canvas) ????????????????
  const chartsRef   = useRef(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const downloadPDF = async () => {
    setPdfLoading(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] =
        await Promise.all([import("jspdf"), import("html2canvas")]);

      const doc   = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W     = doc.internal.pageSize.getWidth();   // 210 mm
      const H     = doc.internal.pageSize.getHeight();  // 297 mm
      const now   = new Date();
      const month = now.toLocaleString("default", { month: "long", year: "numeric" });

      //  Page 1: Cover 
      // Dark hero gradient (drawn as a filled rect)
      doc.setFillColor(10, 14, 26);          // #0a0e1a
      doc.rect(0, 0, W, H, "F");

      // Accent stripe
      doc.setFillColor(59, 130, 246);        // #3b82f6
      doc.rect(0, 0, 6, H, "F");

      // Title
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(26);
      doc.text("SafeRoute AI", 20, 52);

      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(148, 163, 184);       // slate-400
      doc.text("Monthly Road Safety Intelligence Report", 20, 62);

      // Divider
      doc.setDrawColor(59, 130, 246);
      doc.setLineWidth(0.5);
      doc.line(20, 70, W - 20, 70);

      // Report metadata
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`Reporting Period:  ${month}`, 20, 82);
      doc.text(`Generated:         ${now.toLocaleString()}`, 20, 90);
      doc.text(`Location:          Nagpur, Maharashtra, India`, 20, 98);
      doc.text(`Classification:    Confidential ? City Planners Only`, 20, 106);

      // KPI summary table
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(99, 170, 255);
      doc.text("KEY PERFORMANCE INDICATORS", 20, 124);

      const kpis = [
        ["Total Accident Records",   String(stats.total)],
        ["High Risk Events",         String(stats.high)],
        ["Medium Risk Events",       String(stats.med)],
        ["Safe Events",              String(stats.low)],
        ["Avg Accidents / Location", String(stats.avgAcc)],
        ["Registered Users",         String(analytics?.total_users  ?? "?")],
        ["Hazards Reported",         String(analytics?.total_hazards ?? "?")],
      ];
      const ROW_H = 10, COL1 = 20, COL2 = 140, TBL_Y = 132;
      kpis.forEach(([label, val], i) => {
        const y   = TBL_Y + i * ROW_H;
        const alt = i % 2 === 0;
        doc.setFillColor(alt ? 22 : 30, alt ? 28 : 36, alt ? 48 : 58);
        doc.rect(COL1, y, W - 40, ROW_H, "F");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(200, 214, 230);
        doc.text(label, COL1 + 4, y + 7);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(255, 255, 255);
        doc.text(val, COL2, y + 7);
      });

      // Footer on cover
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text("SafeRoute AI ? Powered by Random Forest + A* Risk Routing", 20, H - 12);
      doc.text(`Page 1`, W - 28, H - 12);

      //  Page 2+: Charts screenshot ????????????????????????
      if (chartsRef.current) {
        const canvas = await html2canvas(chartsRef.current, {
          backgroundColor: "#0a0e1a",
          scale: 1.6,            // high-DPI
          useCORS: true,
          logging: false,
        });

        const imgData    = canvas.toDataURL("image/jpeg", 0.88);
        const imgW       = W - 20;  // 190 mm
        const imgH       = (canvas.height / canvas.width) * imgW;
        const pageContentH = H - 36; // leave 18 mm top + 18 mm bottom margins
        const pagesNeeded  = Math.ceil(imgH / pageContentH);

        for (let p = 0; p < pagesNeeded; p++) {
          doc.addPage();
          doc.setFillColor(10, 14, 26);
          doc.rect(0, 0, W, H, "F");
          doc.setFillColor(59, 130, 246);
          doc.rect(0, 0, 6, H, "F");

          // Section header
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.setTextColor(99, 170, 255);
          doc.text("ANALYTICS CHARTS", 20, 14);
          doc.setDrawColor(59, 130, 246);
          doc.line(20, 17, W - 20, 17);

          // Clip and draw the portion of the chart image for this page
          const srcY     = p * pageContentH;
          const sliceH   = Math.min(pageContentH, imgH - srcY);

          // Add image with clipping via y-offset trick
          doc.addImage(
            imgData, "JPEG",
            10, 20,          // x, y on PDF page
            imgW, imgH,      // full image dimensions
            undefined,       // alias
            "FAST",
            0,               // rotation
          );

          // White overlay to hide lower portion on intermediate pages
          if (p < pagesNeeded - 1) {
            doc.setFillColor(10, 14, 26);
            doc.rect(0, 20 + sliceH, W, H, "F");
          }

          // Footer
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(71, 85, 105);
          doc.text(`SafeRoute AI ? ${month}`, 20, H - 6);
          doc.text(`Page ${p + 2}`, W - 28, H - 6);
        }
      }

      doc.save(`SafeRoute_Report_${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("PDF generation failed ? see console for details.");
    } finally {
      setPdfLoading(false);
    }
  };
  //  end PDF report ???????????????????????????????????????????????????????

  // Custom Recharts tooltip style
  const tooltipStyle = { background: "rgba(10,14,26,0.95)", border: "1px solid rgba(99,170,255,0.2)", borderRadius: 10, fontSize: 12 };
  const PIE_COLORS = ["#ef4444","#f59e0b","#10b981","#3b82f6","#8b5cf6","#ec4899","#06b6d4"];
  const CHART_FONT = { fontSize: 11, fill: "#64748b", fontFamily: "DM Sans" };

  // Custom pie label
  const renderPieLabel = ({ name, percent }) =>
    percent > 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : "";

  return (
    <div style={{ minHeight: "100vh", paddingTop: 80, padding: "80px 24px 40px" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 800 }}>🏛 Admin Analytics Dashboard</h2>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
              Nagpur Road Safety Intelligence Platform · <span style={{ color: "#10b981" }}>role: admin</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={downloadCSV}>
              <Icon.Download /> Export CSV
            </button>
            <button
              className="btn-primary"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: pdfLoading ? "rgba(239,68,68,0.7)" : "linear-gradient(135deg,#ef4444,#f59e0b)",
                boxShadow: "0 4px 16px rgba(239,68,68,0.3)",
                opacity: pdfLoading ? 0.8 : 1,
              }}
              onClick={downloadPDF}
              disabled={pdfLoading}
            >
              {pdfLoading
                ? <><span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.6s linear infinite", display: "inline-block" }} /> Generating PDF?</>
                : <>? Download PDF Report</>
              }
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="admin-grid" style={{ marginBottom: 28 }}>
          {[
            { label: "Total Records",      val: stats.total,  color: "#3b82f6", icon: "📊" },
            { label: "High Risk Events",   val: stats.high,   color: "#ef4444", icon: "??" },
            { label: "Medium Risk",        val: stats.med,    color: "#f59e0b", icon: "??" },
            { label: "Safe Events",        val: stats.low,    color: "#10b981", icon: "??" },
            { label: "Avg Accidents/Loc",  val: stats.avgAcc, color: "#8b5cf6", icon: "📉" },
            { label: "Registered Users",   val: analytics?.total_users   ?? "??", color: "#06b6d4", icon: "??" },
            { label: "Hazards Reported",   val: analytics?.total_hazards ?? "??", color: "#ec4899", icon: "?️" },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>{s.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontFamily: "Syne, sans-serif" }}>{s.val}</div>
                </div>
                <span style={{ fontSize: 24 }}>{s.icon}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24, background: "var(--surface2)", borderRadius: 10, padding: 4, width: "fit-content" }}>
          {[["charts","??? Charts"],["blackspots","🗺 Blackspots"],["dataset","??? Dataset"]].map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {/* ?? CHARTS TAB ?????????????????????????????????????????????? */}
        {tab === "charts" && (
          <div ref={chartsRef} className="fade-in" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

            {/* 1. Accidents by Hour ?? Stacked Bar */}
            <div className="glass" style={{ padding: 24, gridColumn: "1 / -1" }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, fontFamily: "Syne, sans-serif" }}>
                Accidents by Time of Day
              </h3>
              <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 20 }}>
                Stacked by risk level ?? identifies peak accident hours for city planners
              </p>
              {loading ? (
                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>Loading?</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={accByHour} margin={{ top: 4, right: 16, left: 0, bottom: 4 }} barSize={14}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,170,255,0.08)" />
                    <XAxis dataKey="hour" tickFormatter={h => `${h}:00`} tick={CHART_FONT} interval={2} />
                    <YAxis tick={CHART_FONT} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={h => `${h}:00 ?? ${h + 1}:00`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="High"   stackId="a" fill="#ef4444" radius={[0,0,0,0]} />
                    <Bar dataKey="Medium" stackId="a" fill="#f59e0b" radius={[0,0,0,0]} />
                    <Bar dataKey="Low"    stackId="a" fill="#10b981" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 2. Hazards by Type ?? Pie Chart */}
            <div className="glass" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, fontFamily: "Syne, sans-serif" }}>
                Hazards Reported by Type
              </h3>
              <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>
                Breakdown of citizen-reported hazard categories
              </p>
              {loading ? (
                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>Loading?</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={hazardsByType} cx="50%" cy="50%"
                      outerRadius={100} innerRadius={50}
                      dataKey="value" nameKey="name"
                      label={renderPieLabel} labelLine={false}
                      paddingAngle={3}
                    >
                      {hazardsByType.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 3. Risk Level by Road Type ?? Grouped Bar */}
            <div className="glass" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, fontFamily: "Syne, sans-serif" }}>
                Risk Level by Road Type
              </h3>
              <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>
                Which road categories carry the most high-risk incidents?
              </p>
              {loading ? (
                <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>Loading?</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={riskByRoad} margin={{ top: 4, right: 8, left: 0, bottom: 20 }} barSize={18}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,170,255,0.08)" />
                    <XAxis dataKey="road_type" tick={{ ...CHART_FONT, angle: -20, textAnchor: "end" }} />
                    <YAxis tick={CHART_FONT} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="High"   fill="#ef4444" radius={[4,4,0,0]} />
                    <Bar dataKey="Medium" fill="#f59e0b" radius={[4,4,0,0]} />
                    <Bar dataKey="Low"    fill="#10b981" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 4. Weather Breakdown ?? Horizontal Bar */}
            <div className="glass" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, fontFamily: "Syne, sans-serif" }}>
                Accidents by Weather Condition
              </h3>
              <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>
                Identifies which weather conditions correlate with most accidents
              </p>
              {loading ? (
                <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>Loading?</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={weatherData} layout="vertical" margin={{ top: 4, right: 16, left: 60, bottom: 4 }} barSize={18}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,170,255,0.08)" />
                    <XAxis type="number" tick={CHART_FONT} />
                    <YAxis type="category" dataKey="weather" tick={CHART_FONT} width={56} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" name="Incidents" radius={[0,4,4,0]}
                      fill="url(#weatherGrad)"
                    />
                    <defs>
                      <linearGradient id="weatherGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#06b6d4" />
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

          </div>
        )}

        {/* ?? BLACKSPOTS TAB ?????????????????????????????????????????? */}
        {tab === "blackspots" && (
          <div className="fade-in">
            <div className="glass" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Location","Total","High Risk","Avg Accidents"].map(h => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {blackspots.slice(0, 20).map((b, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>{b.name}</td>
                      <td style={{ padding: "12px 16px" }}>{b.total}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{ color: "#ef4444", fontWeight: 700 }}>{b.high}</span>
                      </td>
                      <td style={{ padding: "12px 16px" }}>{b.avg_accidents}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ?? DATASET TAB ?????????????????????????????????????????????? */}
        {tab === "dataset" && (
          <div className="fade-in">
            <div className="glass" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Location","Hour","Weather","Road","Density","Accidents","Risk"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((d, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 12px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.location}</td>
                      <td style={{ padding: "10px 12px" }}>{d.time_of_day}:00</td>
                      <td style={{ padding: "10px 12px" }}>{d.weather}</td>
                      <td style={{ padding: "10px 12px" }}>{d.road_type}</td>
                      <td style={{ padding: "10px 12px" }}>{d.traffic_density}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700 }}>{d.accident_count}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span className={`risk-badge risk-${d.risk_level}`}>{d.risk_level}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}




// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  // Restore session from localStorage if a token already exists
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem("user");
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [page, setPage] = useState("dashboard");
  const [darkMode, setDarkMode] = useState(true);

  // Keep localStorage in sync whenever the user object changes
  const handleLogin = (u) => {
    localStorage.setItem("user", JSON.stringify(u));
    setUser(u);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  return (
    <div className={darkMode ? "" : "light"} style={{ minHeight: "100vh" }}>
      <style>{STYLES}</style>
      {!user ? (
        <AuthPage onLogin={handleLogin} />
      ) : (
        <>
          <TopNav user={user} page={page} setPage={setPage}
            darkMode={darkMode} setDarkMode={setDarkMode}
            onLogout={handleLogout} />
          {page === "dashboard"   && <DashboardPage />}
          {page === "navigation"  && <NavigationPage />}
          {page === "risk"        && <RiskPage />}
          {page === "leaderboard" && <LeaderboardPage />}
          {page === "admin"       && <AdminPage />}
        </>
      )}
    </div>
  );
}

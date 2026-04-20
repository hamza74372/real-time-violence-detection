import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import MetricsStrip from './MetricsStrip';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const PYTHON_STREAM = "http://127.0.0.1:8000/api/video_feed";
const API_BASE      = "http://127.0.0.1:8000/api";

const CAMERA_NETWORK = [
  { id: 1, name: "CAM-01", location: "Main St / Central",  zone: "ZONE-A", status: "AI ACTIVE", type: "live",      url: PYTHON_STREAM },
  { id: 2, name: "CAM-02", location: "Subway Entrance",    zone: "ZONE-B", status: "STANDBY",   type: "simulated", bg: "#050d1a" },
  { id: 3, name: "CAM-03", location: "Riverside Park",     zone: "ZONE-C", status: "NO SIGNAL", type: "error",     bg: "#0a0a0a" },
  { id: 4, name: "CAM-04", location: "Financial District", zone: "ZONE-D", status: "STANDBY",   type: "simulated", bg: "#050d1a" },
];

const ZONE_LAYOUT = [
  { id: "ZONE-A", label: "Central",    x: 42, y: 28, w: 28, h: 22 },
  { id: "ZONE-B", label: "Transit",    x: 10, y: 52, w: 26, h: 22 },
  { id: "ZONE-C", label: "Riverside",  x: 64, y: 54, w: 26, h: 22 },
  { id: "ZONE-D", label: "Financial",  x: 38, y: 62, w: 24, h: 20 },
];

const CAM_PIN_POS = { 1: { x: 56, y: 39 }, 2: { x: 23, y: 63 }, 3: { x: 77, y: 65 }, 4: { x: 50, y: 72 } };

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return String(ts); }
}

// ─── CONFIDENCE ARC ───────────────────────────────────────────────────────────
function ConfidenceArc({ value = 0, threshold = 60, size = 88 }) {
  const r = 34, cx = 44, cy = 44, circ = 2 * Math.PI * r, arc = circ * 0.75;
  const fill  = arc * (Math.min(value, 100) / 100);
  const color = value >= threshold ? '#ef4444' : value > threshold * 0.65 ? '#f59e0b' : '#22d3ee';
  const scale = size / 88;
  return (
    <svg width={size} height={size} viewBox="0 0 88 88">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(51,65,85,0.5)" strokeWidth="6"
        strokeDasharray={`${arc} ${circ - arc}`} strokeDashoffset={circ * 0.125}
        strokeLinecap="round" transform="rotate(135 44 44)" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${fill} ${circ - fill}`} strokeDashoffset={circ * 0.125}
        strokeLinecap="round" transform="rotate(135 44 44)"
        style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.3s ease' }} />
      <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize="15"
        fontFamily="'JetBrains Mono',monospace" fontWeight="700">{value}%</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="#64748b" fontSize="8"
        fontFamily="'JetBrains Mono',monospace">CONF</text>
    </svg>
  );
}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function MiniSparkline({ data = [] }) {
  if (data.length < 2) return <div style={{ width: 120, height: 28 }} />;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 120},${28 - (v / max) * 24}`).join(' ');
  return (
    <svg width="120" height="28" viewBox="0 0 120 28">
      <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ─── CITY ZONE MAP ────────────────────────────────────────────────────────────
function CityZoneMap({ isViolent, onCamSelect, focusedCam }) {
  const zoneForCam = (zone) => CAMERA_NETWORK.find(c => c.zone === zone);
  const zoneStatus = (zoneId) => {
    const cam = zoneForCam(zoneId);
    if (!cam) return 'offline';
    if (cam.id === 1 && isViolent) return 'threat';
    if (cam.status === 'AI ACTIVE') return 'active';
    if (cam.status === 'NO SIGNAL') return 'offline';
    return 'standby';
  };
  const COLORS = { threat: '#ef4444', active: '#22d3ee', standby: '#334155', offline: '#1e293b' };
  const FILLS  = { threat: 'rgba(239,68,68,0.15)', active: 'rgba(34,211,238,0.08)', standby: 'rgba(30,41,59,0.4)', offline: 'rgba(15,23,42,0.4)' };

  return (
    <div className="glass-panel map-panel">
      <div className="panel-header">
        <span className="panel-title">CITY ZONE MAP</span>
        <span className="pill-mono pill-cyan">LIVE TOPOLOGY</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="city-svg">
        {[20,40,60,80].map(v => (
          <React.Fragment key={v}>
            <line x1={v} y1="0" x2={v} y2="100" stroke="rgba(51,65,85,0.18)" strokeWidth="0.3"/>
            <line x1="0"  y1={v} x2="100" y2={v}  stroke="rgba(51,65,85,0.18)" strokeWidth="0.3"/>
          </React.Fragment>
        ))}
        {ZONE_LAYOUT.map(z => {
          const st = zoneStatus(z.id);
          return (
            <g key={z.id}>
              <rect x={z.x} y={z.y} width={z.w} height={z.h} rx="1.5"
                fill={FILLS[st]} stroke={COLORS[st]} strokeWidth="0.5" />
              <text x={z.x + z.w/2} y={z.y + z.h/2 - 2.5} textAnchor="middle"
                fill={COLORS[st]} fontSize="3.8" fontFamily="'JetBrains Mono',monospace" fontWeight="700">{z.id}</text>
              <text x={z.x + z.w/2} y={z.y + z.h/2 + 3.5} textAnchor="middle"
                fill="rgba(148,163,184,0.6)" fontSize="2.6" fontFamily="'JetBrains Mono',monospace">{z.label}</text>
            </g>
          );
        })}
        {CAMERA_NETWORK.map(cam => {
          const p = CAM_PIN_POS[cam.id];
          const threat  = cam.id === 1 && isViolent;
          const focused = focusedCam === cam.id;
          const col = threat ? '#ef4444' : cam.status === 'AI ACTIVE' ? '#22d3ee' : cam.status === 'NO SIGNAL' ? '#475569' : '#64748b';
          return (
            <g key={cam.id} onClick={() => onCamSelect(cam.id)} style={{ cursor: 'pointer' }}>
              {focused && <circle cx={p.x} cy={p.y} r="4" fill="none" stroke={col} strokeWidth="0.4" opacity="0.5" />}
              {threat && (
                <circle cx={p.x} cy={p.y} r="3" fill="none" stroke="#ef4444" strokeWidth="0.4" opacity="0.5">
                  <animate attributeName="r" values="3;5.5;3" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.5;0;0.5" dur="1.4s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={p.x} cy={p.y} r="1.8" fill={col} />
              <text x={p.x + 2.5} y={p.y + 0.8} fill="rgba(203,213,225,0.75)"
                fontSize="2.3" fontFamily="'JetBrains Mono',monospace">{cam.name}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── INCIDENT TRIAGE ──────────────────────────────────────────────────────────
function IncidentTriagePanel({ incidents, onAction, alarmsArmed }) {
  const [filter, setFilter] = useState('ALL');
  const counts = { UNREVIEWED: 0, CONFIRMED: 0, DISMISSED: 0, ESCALATED: 0 };
  incidents.forEach(i => { const s = i.review_status || 'UNREVIEWED'; if (counts[s] !== undefined) counts[s]++; });
  const list = filter === 'ALL' ? incidents : incidents.filter(i => (i.review_status || 'UNREVIEWED') === filter);

  return (
    <div className="glass-panel triage-panel">
      <div className="panel-header">
        <span className="panel-title">INCIDENT TRIAGE</span>
        <span className="pill-mono pill-gray">{incidents.length} TOTAL</span>
      </div>
      <div className="filter-row">
        {['ALL','UNREVIEWED','CONFIRMED','DISMISSED'].map(f => (
          <button key={f} className={`filter-btn ${filter === f ? 'filter-active' : ''}`} onClick={() => setFilter(f)}>
            {f}{f !== 'ALL' && counts[f] ? <span className="f-count">{counts[f]}</span> : null}
          </button>
        ))}
      </div>
      <div className="triage-scroll">
        {!alarmsArmed && <div className="empty-state"><div className="empty-icon">⬡</div><p>Arm network to begin monitoring</p></div>}
        {alarmsArmed && list.length === 0 && <div className="empty-state"><div className="empty-icon">✓</div><p>No incidents in this category</p></div>}
        {list.map(inc => {
          const st = inc.review_status || 'UNREVIEWED';
          return (
            <div key={inc.id} className={`triage-card tc-${st.toLowerCase()}`}>
              <div className="tc-top">
                <span className="tc-cam">{inc.camera || 'CAM-01'}</span>
                <span className={`tc-status-pill sp-${st.toLowerCase()}`}>{st}</span>
              </div>
              <div className="tc-time">{fmtTime(inc.timestamp)}</div>
              <div className="tc-desc">{inc.description}</div>
              {inc.confidence !== undefined && (
                <div className="tc-conf-bar">
                  <div className="tc-conf-fill" style={{ width: `${inc.confidence}%` }} />
                  <span className="tc-conf-label">{inc.confidence}%</span>
                </div>
              )}
              {st === 'UNREVIEWED' && (
                <div className="tc-actions">
                  <button className="tc-btn btn-confirm"  onClick={() => onAction(inc.id, 'CONFIRMED')}>✓ Confirm</button>
                  <button className="tc-btn btn-dismiss"  onClick={() => onAction(inc.id, 'DISMISSED')}>✕ False +ve</button>
                  <button className="tc-btn btn-escalate" onClick={() => onAction(inc.id, 'ESCALATED')}>↑ Escalate</button>
                </div>
              )}
              {st !== 'UNREVIEWED' && inc.reviewed_by && (
                <div className="tc-reviewed">Actioned by {inc.reviewed_by}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
function AnalyticsDashboard({ incidents }) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, count: 0 }));
  incidents.forEach(inc => { try { hours[new Date(inc.timestamp).getHours()].count++; } catch {} });
  const maxH = Math.max(...hours.map(h => h.count), 1);

  const confirmed  = incidents.filter(i => i.review_status === 'CONFIRMED').length;
  const dismissed  = incidents.filter(i => i.review_status === 'DISMISSED').length;
  const unreviewed = incidents.filter(i => !i.review_status || i.review_status === 'UNREVIEWED').length;
  const total      = incidents.length;
  const accuracy   = total > 0 ? Math.round((confirmed / Math.max(confirmed + dismissed, 1)) * 100) : 0;

  const camBars = CAMERA_NETWORK.map(c => ({
    name: c.name,
    count: incidents.filter(i => i.camera === c.name || (!i.camera && c.id === 1)).length,
  }));
  const maxCam = Math.max(...camBars.map(c => c.count), 1);

  // Donut segments
  const donutData = [
    { label: 'Unreviewed', v: unreviewed, color: '#94a3b8' },
    { label: 'Confirmed',  v: confirmed,  color: '#ef4444' },
    { label: 'Dismissed',  v: dismissed,  color: '#f59e0b' },
  ];
  const donutTotal = donutData.reduce((s, d) => s + d.v, 0) || 1;
  let donutOffset = 0;

  const exportCSV = () => {
    const rows = ['id,timestamp,camera,description,status',
      ...incidents.map(i => `${i.id},"${i.timestamp}","${i.camera||'CAM-01'}","${i.description}","${i.review_status||'UNREVIEWED'}"`)
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    a.download = `citysheid_incidents_${Date.now()}.csv`;
    a.click();
  };

  return (
    <div className="analytics-root">
      <div className="kpi-row">
        {[
          { label: 'TOTAL INCIDENTS', value: total,        color: '#e2e8f0' },
          { label: 'CONFIRMED THREATS',value: confirmed,   color: '#ef4444' },
          { label: 'FALSE POSITIVES',  value: dismissed,   color: '#f59e0b' },
          { label: 'MODEL PRECISION',  value: `${accuracy}%`, color: '#22d3ee' },
        ].map(k => (
          <div key={k.label} className="kpi-card glass-panel">
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-val" style={{ color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="charts-row">
        {/* Hourly heatmap */}
        <div className="glass-panel chart-card">
          <div className="chart-title">Incidents by hour of day</div>
          <div className="heatmap">
            {hours.map(({ h, count }) => (
              <div key={h} className="hm-col" title={`${h}:00 — ${count}`}>
                <div className="hm-wrap">
                  <div className="hm-bar" style={{
                    height: `${(count / maxH) * 100}%`,
                    background: count > 0 ? `rgba(239,68,68,${0.15 + (count / maxH) * 0.85})` : 'rgba(51,65,85,0.25)'
                  }} />
                </div>
                {h % 6 === 0 && <span className="hm-label">{h}h</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Camera bars */}
        <div className="glass-panel chart-card">
          <div className="chart-title">Alerts per camera node</div>
          <div className="cam-bars">
            {camBars.map(c => (
              <div key={c.name} className="cam-bar-row">
                <span className="cbar-label">{c.name}</span>
                <div className="cbar-track"><div className="cbar-fill" style={{ width: `${(c.count / maxCam) * 100}%` }} /></div>
                <span className="cbar-count">{c.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Donut */}
        <div className="glass-panel chart-card">
          <div className="chart-title">Review status breakdown</div>
          <div className="donut-row">
            <svg width="90" height="90" viewBox="0 0 90 90">
              {donutData.map((d, idx) => {
                const pct  = d.v / donutTotal;
                const dash = pct * 219.9; // circumference of r=35
                const el = <circle key={idx} cx="45" cy="45" r="35" fill="none"
                  stroke={d.color} strokeWidth="16"
                  strokeDasharray={`${dash} ${219.9 - dash}`}
                  strokeDashoffset={-donutOffset}
                  transform="rotate(-90 45 45)" />;
                donutOffset += dash;
                return el;
              })}
              <circle cx="45" cy="45" r="22" fill="rgba(10,15,30,0.9)" />
              <text x="45" y="49" textAnchor="middle" fill="#e2e8f0"
                fontSize="11" fontFamily="'JetBrains Mono',monospace" fontWeight="700">{total}</text>
            </svg>
            <div className="donut-legend">
              {donutData.map(d => (
                <div key={d.label} className="legend-row">
                  <span className="leg-dot" style={{ background: d.color }} />
                  <span className="leg-label">{d.label}</span>
                  <span className="leg-val">{d.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="analytics-footer">
        <button className="btn-export" onClick={exportCSV}>⬇ Export CSV</button>
        <span className="analytics-note">{incidents.length} records · Live SQLite sync</span>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [isViolent,    setIsViolent]    = useState(false);
  const [systemStatus, setSystemStatus] = useState('OFFLINE');
  const [alarmsArmed,  setAlarmsArmed]  = useState(false);
  const [incidents,    setIncidents]    = useState([]);
  const [confidence,   setConfidence]   = useState(0);
  const [threshold,    setThreshold]    = useState(60);
  const [activeTab,    setActiveTab]    = useState('MATRIX');
  const [focusedCam,   setFocusedCam]   = useState(1);
  const [currentTime,  setCurrentTime]  = useState(new Date());
  const [confHistory,  setConfHistory]  = useState([]);

  const audioCtxRef   = useRef(null);
  const oscRef        = useRef(null);
  const gainRef       = useRef(null);
  const sirenTimerRef = useRef(null);

  // ── Audio ──────────────────────────────────────────────────────────────────
  const stopSiren = useCallback(() => {
    clearInterval(sirenTimerRef.current);
    try { oscRef.current?.stop(); oscRef.current?.disconnect(); } catch {}
    try { gainRef.current?.disconnect(); } catch {}
    oscRef.current = null; gainRef.current = null;
  }, []);

  const startSiren = useCallback(() => {
    if (!audioCtxRef.current || oscRef.current) return;
    const ctx  = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    osc.connect(gain); gain.connect(ctx.destination); osc.start();
    oscRef.current = osc; gainRef.current = gain;
    sirenTimerRef.current = setInterval(() => {
      if (gainRef.current) gainRef.current.gain.value = gainRef.current.gain.value === 0 ? 0.22 : 0;
    }, 280);
  }, []);

  // ── Clock ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Arm ───────────────────────────────────────────────────────────────────
  const handleArm = () => {
    audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current.resume();
    setAlarmsArmed(true);
  };

  const runDiagnostic = () => {
    setIsViolent(true); setConfidence(87); startSiren();
    setTimeout(() => { setIsViolent(false); setConfidence(12); stopSiren(); }, 3000);
  };

  // ── AI Status Polling ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!alarmsArmed) return;
    const poll = setInterval(async () => {
      try {
        const data = await fetch(`${API_BASE}/status`).then(r => r.json());
        setSystemStatus(data.status || 'MONITORING');
        const conf = Math.round((data.confidence || 0) * 100);
        setConfidence(conf);
        setConfHistory(h => [...h.slice(-29), conf]);
        const violent = String(data.status).includes('VIOLENCE');
        if (violent && !isViolent)  { setIsViolent(true);  startSiren(); }
        if (!violent && isViolent)  { setIsViolent(false); stopSiren();  }
      } catch { setSystemStatus('CONN ERR'); }
    }, 500);
    return () => { clearInterval(poll); stopSiren(); };
  }, [alarmsArmed, isViolent, startSiren, stopSiren]);

  // ── Incident Polling ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!alarmsArmed) return;
    const load = () => fetch(`${API_BASE}/incidents`).then(r => r.json()).then(setIncidents).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [alarmsArmed]);

  // ── Threshold Sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!alarmsArmed) return;
    const t = setTimeout(() => {
      fetch(`${API_BASE}/config/threshold`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: threshold / 100 }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [threshold, alarmsArmed]);

  // ── Triage Action ──────────────────────────────────────────────────────────
  const handleTriageAction = useCallback(async (id, status) => {
    const payload = { status, reviewed_by: 'Operator-1', reviewed_at: new Date().toISOString() };
    // Optimistic update
    setIncidents(prev => prev.map(i => i.id === id ? { ...i, review_status: status, ...payload } : i));
    fetch(`${API_BASE}/incidents/${id}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, []);

  const timeStr = currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = currentTime.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const unreviewed = incidents.filter(i => !i.review_status || i.review_status === 'UNREVIEWED').length;

  return (
    <div className={`app-root ${isViolent ? 'alert-mode' : ''}`}>

      {/* ── NAV ── */}
      <nav className="top-nav">
        <div className="nav-brand">
          <div className="brand-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <path d="M16 2L4 7v8c0 7.4 5.1 14.3 12 16 6.9-1.7 12-8.6 12-16V7L16 2z" stroke="#22d3ee" strokeWidth="1.5"/>
              <path d="M11 16l3 3 7-7" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div className="brand-name">CityShield<span className="brand-ai"> AI</span></div>
            <div className="brand-sub">SMART CITY SURVEILLANCE · COMMAND CENTER</div>
          </div>
        </div>

        <div className="nav-tabs">
          {['MATRIX','ANALYTICS'].map(tab => (
            <button key={tab} className={`nav-tab ${activeTab === tab ? 'tab-active' : ''}`} onClick={() => setActiveTab(tab)}>
              {tab === 'MATRIX' ? '⬛ LIVE MATRIX' : '◈ ANALYTICS'}
              {tab === 'MATRIX' && unreviewed > 0 && <span className="tab-badge">{unreviewed}</span>}
            </button>
          ))}
        </div>

        <div className="nav-right">
          <div className="clock-block">
            <div className="clock-time">{timeStr}</div>
            <div className="clock-date">{dateStr}</div>
          </div>
          {alarmsArmed && <button className="btn-diag" onClick={runDiagnostic}>DIAG TEST</button>}
          {!alarmsArmed
            ? <button className="btn-arm pulse-arm" onClick={handleArm}>▶ ARM NETWORK</button>
            : <div className={`sys-badge ${isViolent ? 'badge-threat' : 'badge-secure'}`}>
                <span className="sys-dot" />
                {isViolent ? '⚠ THREAT DETECTED' : '● ALL NODES SECURE'}
              </div>
          }
        </div>
      </nav>

      {/* ── METRICS STRIP ── */}
      <MetricsStrip alarmsArmed={alarmsArmed} />

      {/* ── ANALYTICS ── */}
      {activeTab === 'ANALYTICS' && (
        <div className="tab-pane"><AnalyticsDashboard incidents={incidents} /></div>
      )}

      {/* ── MATRIX ── */}
      {activeTab === 'MATRIX' && (
        <div className="matrix-layout">

          {/* Camera 2×2 grid */}
          <section className="col-cams">
            <div className="camera-matrix">
              {CAMERA_NETWORK.map(cam => (
                <div key={cam.id}
                  className={`matrix-cell glass-panel
                    ${focusedCam === cam.id ? 'cell-focused' : ''}
                    ${cam.id === 1 && isViolent ? 'cell-threat pulse-border' : ''}`}
                  onClick={() => setFocusedCam(cam.id)}>
                  <div className="cell-hdr">
                    <div className="cell-hdr-left">
                      <span className="cam-id">{cam.name}</span>
                      <span className="cam-loc">{cam.location}</span>
                    </div>
                    {cam.id === 1
                      ? <span className={`ai-pill ${isViolent ? 'pill-red' : 'pill-green'}`}>
                          {isViolent ? '⚠ VIOLENCE' : systemStatus}
                        </span>
                      : <span className="pill-mono pill-gray">{cam.status}</span>
                    }
                  </div>
                  <div className="cell-video">
                    {cam.type === 'live' ? (
                      <>
                        <img src={cam.url} alt="AI Feed" className="matrix-feed" />
                        {/* Confidence arc overlay */}
                        <div className="conf-overlay">
                          <ConfidenceArc value={confidence} threshold={threshold} size={70} />
                        </div>
                        {/* Crosshairs */}
                        <div className="xh xh-tl"/><div className="xh xh-tr"/>
                        <div className="xh xh-bl"/><div className="xh xh-br"/>
                        {isViolent && (
                          <div className="threat-overlay">
                            <span className="threat-label">⚠ VIOLENCE DETECTED</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="matrix-sim" style={{ background: cam.bg }}>
                        {cam.type === 'error' && <div className="static-noise"/>}
                        <span className="sim-txt">{cam.status}</span>
                      </div>
                    )}
                  </div>
                  <div className="cell-ftr">
                    <span className="cell-zone">{cam.zone}</span>
                    {cam.id === 1 && <span className="cell-thr">THR {threshold}%</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Right sidebar */}
          <aside className="col-side">

            {/* Confidence + threshold */}
            <div className="glass-panel conf-panel">
              <div className="panel-header">
                <span className="panel-title">AI CONFIDENCE MONITOR</span>
                <span className="pill-mono pill-cyan">CAM-01</span>
              </div>
              <div className="conf-row">
                <ConfidenceArc value={confidence} threshold={threshold} size={90} />
                <div className="conf-spark-block">
                  <div className="spark-label">30s HISTORY</div>
                  <MiniSparkline data={confHistory} />
                  <div className="conf-status" style={{ color: confidence >= threshold ? '#ef4444' : '#22d3ee' }}>
                    {confidence >= threshold ? '⚠ ABOVE THRESHOLD' : '● MONITORING'}
                  </div>
                </div>
              </div>
              <div className="thr-control">
                <div className="thr-hdr">
                  <span className="thr-label">Alert threshold</span>
                  <span className="thr-val">{threshold}%</span>
                </div>
                <input type="range" min="30" max="95" step="1" value={threshold}
                  onChange={e => setThreshold(Number(e.target.value))}
                  className="thr-slider" />
                <div className="thr-hints">
                  <span>← High recall</span>
                  <span>High precision →</span>
                </div>
              </div>
            </div>

            {/* City map */}
            <CityZoneMap isViolent={isViolent} onCamSelect={setFocusedCam} focusedCam={focusedCam} />

            {/* Triage */}
            <IncidentTriagePanel incidents={incidents} onAction={handleTriageAction} alarmsArmed={alarmsArmed} />
          </aside>
        </div>
      )}
    </div>
  );
}
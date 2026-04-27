import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import MetricsStrip      from './MetricsStrip';
import ToastStack        from './ToastStack';
import CameraConfigPanel from './CameraConfigPanel';
import UserManagement    from './UserManagement';
import { useNotifications } from './useNotifications';
import { useAuth }       from './AuthContext';
import LoginScreen       from './LoginScreen';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const PYTHON_STREAM = "http://127.0.0.1:8000/api/video_feed";
const API_BASE      = "http://127.0.0.1:8000/api";

const CAMERA_NETWORK = [
  { id: 1, name: "CAM-01", location: "Main St / Central",  zone: "ZONE-A", status: "AI ACTIVE", type: "live",      url: PYTHON_STREAM },
  { id: 2, name: "CAM-02", location: "Subway Entrance",    zone: "ZONE-B", status: "STANDBY",   type: "simulated", bg: "#f1f5f9" },
  { id: 3, name: "CAM-03", location: "Riverside Park",     zone: "ZONE-C", status: "NO SIGNAL", type: "error",     bg: "#f8fafc" },
  { id: 4, name: "CAM-04", location: "Financial District", zone: "ZONE-D", status: "STANDBY",   type: "simulated", bg: "#f1f5f9" },
];

const ZONE_LAYOUT = [
  { id: "ZONE-A", label: "Central",   x: 42, y: 28, w: 28, h: 22 },
  { id: "ZONE-B", label: "Transit",   x: 10, y: 52, w: 26, h: 22 },
  { id: "ZONE-C", label: "Riverside", x: 64, y: 54, w: 26, h: 22 },
  { id: "ZONE-D", label: "Financial", x: 38, y: 62, w: 24, h: 20 },
];

const CAM_PIN_POS = { 1:{x:56,y:39}, 2:{x:23,y:63}, 3:{x:77,y:65}, 4:{x:50,y:72} };

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' }); }
  catch { return String(ts); }
}

// ─── CONFIDENCE ARC ───────────────────────────────────────────────────────────
function ConfidenceArc({ value = 0, threshold = 60, size = 88 }) {
  const r = 34, cx = 44, cy = 44, circ = 2 * Math.PI * r, arc = circ * 0.75;
  const fill  = arc * (Math.min(value, 100) / 100);
  const color = value >= threshold ? 'var(--red)' : value > threshold * 0.65 ? 'var(--amber)' : 'var(--accent)';
  return (
    <svg width={size} height={size} viewBox="0 0 88 88">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-light)" strokeWidth="6"
        strokeDasharray={`${arc} ${circ-arc}`} strokeDashoffset={circ*0.125}
        strokeLinecap="round" transform="rotate(135 44 44)" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${fill} ${circ-fill}`} strokeDashoffset={circ*0.125}
        strokeLinecap="round" transform="rotate(135 44 44)"
        style={{ transition:'stroke-dasharray 0.4s ease, stroke 0.3s ease' }} />
      <text x={cx} y={cy-4} textAnchor="middle" fill={color} fontSize="15"
        fontFamily="'DM Mono',monospace" fontWeight="500">{value}%</text>
      <text x={cx} y={cy+10} textAnchor="middle" fill="var(--text-muted)" fontSize="8"
        fontFamily="'DM Mono',monospace">CONF</text>
    </svg>
  );
}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function MiniSparkline({ data = [] }) {
  if (data.length < 2) return <div style={{ width:120, height:28 }} />;
  const max = Math.max(...data, 1);
  const pts = data.map((v,i) => `${(i/(data.length-1))*120},${28-(v/max)*24}`).join(' ');
  return (
    <svg width="120" height="28" viewBox="0 0 120 28">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ─── CITY ZONE MAP ────────────────────────────────────────────────────────────
function CityZoneMap({ isViolent, onCamSelect, focusedCam }) {
  const zoneStatus = (zoneId) => {
    const cam = CAMERA_NETWORK.find(c => c.zone === zoneId);
    if (!cam) return 'offline';
    if (cam.id === 1 && isViolent) return 'threat';
    if (cam.status === 'AI ACTIVE') return 'active';
    if (cam.status === 'NO SIGNAL') return 'offline';
    return 'standby';
  };
  const COLORS = { threat:'#dc2626', active:'#0284c7', standby:'#cbd5e1', offline:'#e2e8f0' };
  const FILLS  = { threat:'rgba(220,38,38,0.1)', active:'rgba(2,132,199,0.08)', standby:'rgba(241,245,249,0.6)', offline:'rgba(248,250,252,0.6)' };

  return (
    <div className="glass-panel map-panel">
      <div className="panel-header">
        <span className="panel-title">CITY ZONE MAP</span>
        <span className="pill-mono pill-cyan">LIVE TOPOLOGY</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="city-svg">
        {[20,40,60,80].map(v => (
          <React.Fragment key={v}>
            <line x1={v} y1="0" x2={v} y2="100" stroke="var(--border-light)" strokeWidth="0.3"/>
            <line x1="0" y1={v} x2="100" y2={v}  stroke="var(--border-light)" strokeWidth="0.3"/>
          </React.Fragment>
        ))}
        {ZONE_LAYOUT.map(z => {
          const st = zoneStatus(z.id);
          return (
            <g key={z.id}>
              <rect x={z.x} y={z.y} width={z.w} height={z.h} rx="1.5"
                fill={FILLS[st]} stroke={COLORS[st]} strokeWidth="0.5" />
              <text x={z.x+z.w/2} y={z.y+z.h/2-2.5} textAnchor="middle"
                fill={COLORS[st]} fontSize="3.8" fontFamily="'DM Mono',monospace" fontWeight="500">{z.id}</text>
              <text x={z.x+z.w/2} y={z.y+z.h/2+3.5} textAnchor="middle"
                fill="var(--text-muted)" fontSize="2.6" fontFamily="'DM Mono',monospace">{z.label}</text>
            </g>
          );
        })}
        {CAMERA_NETWORK.map(cam => {
          const p       = CAM_PIN_POS[cam.id];
          const threat  = cam.id === 1 && isViolent;
          const focused = focusedCam === cam.id;
          const col     = threat ? '#dc2626' : cam.status === 'AI ACTIVE' ? '#0284c7' : cam.status === 'NO SIGNAL' ? '#cbd5e1' : '#94a3b8';
          return (
            <g key={cam.id} onClick={() => onCamSelect(cam.id)} style={{ cursor:'pointer' }}>
              {focused && <circle cx={p.x} cy={p.y} r="4" fill="none" stroke={col} strokeWidth="0.4" opacity="0.5" />}
              {threat && (
                <circle cx={p.x} cy={p.y} r="3" fill="none" stroke="#dc2626" strokeWidth="0.4" opacity="0.5">
                  <animate attributeName="r" values="3;5.5;3" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.5;0;0.5" dur="1.4s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={p.x} cy={p.y} r="1.8" fill={col} />
              <text x={p.x+2.5} y={p.y+0.8} fill="var(--text-secondary)"
                fontSize="2.3" fontFamily="'DM Mono',monospace">{cam.name}</text>
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
  const counts = { UNREVIEWED:0, CONFIRMED:0, DISMISSED:0, ESCALATED:0 };
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
          <button key={f} className={`filter-btn ${filter===f?'filter-active':''}`} onClick={() => setFilter(f)}>
            {f}{f!=='ALL'&&counts[f]?<span className="f-count">{counts[f]}</span>:null}
          </button>
        ))}
      </div>
      <div className="triage-scroll">
        {!alarmsArmed && <div className="empty-state"><div className="empty-icon">⬡</div><p>Arm network to begin monitoring</p></div>}
        {alarmsArmed && list.length===0 && <div className="empty-state"><div className="empty-icon">✓</div><p>No incidents in this category</p></div>}
        {list.map(inc => {
          const st = inc.review_status || 'UNREVIEWED';
          return (
            <div key={inc.id} className={`triage-card tc-${st.toLowerCase()}`}>
              <div className="tc-top">
                <span className="tc-cam">{inc.camera||'CAM-01'}</span>
                <span className={`tc-status-pill sp-${st.toLowerCase()}`}>{st}</span>
              </div>
              <div className="tc-time">{fmtTime(inc.timestamp)}</div>
              <div className="tc-desc">{inc.description}</div>
              {inc.confidence !== undefined && (
                <div className="tc-conf-bar">
                  <div className="tc-conf-fill" style={{ width:`${inc.confidence}%` }} />
                  <span className="tc-conf-label">{inc.confidence}%</span>
                </div>
              )}
              {st === 'UNREVIEWED' && (
                <div className="tc-actions">
                  <button className="tc-btn btn-confirm"  onClick={() => onAction(inc.id,'CONFIRMED')}>✓ Confirm</button>
                  <button className="tc-btn btn-dismiss"  onClick={() => onAction(inc.id,'DISMISSED')}>✕ False +ve</button>
                  <button className="tc-btn btn-escalate" onClick={() => onAction(inc.id,'ESCALATED')}>↑ Escalate</button>
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
  const hours = Array.from({ length:24 }, (_,h) => ({ h, count:0 }));
  incidents.forEach(inc => { try { hours[new Date(inc.timestamp).getHours()].count++; } catch {} });
  const maxH = Math.max(...hours.map(h => h.count), 1);

  const confirmed  = incidents.filter(i => i.review_status==='CONFIRMED').length;
  const dismissed  = incidents.filter(i => i.review_status==='DISMISSED').length;
  const unreviewed = incidents.filter(i => !i.review_status||i.review_status==='UNREVIEWED').length;
  const total      = incidents.length;
  const accuracy   = total>0 ? Math.round((confirmed/Math.max(confirmed+dismissed,1))*100) : 0;

  const camBars = CAMERA_NETWORK.map(c => ({
    name: c.name,
    count: incidents.filter(i => i.camera===c.name||(!i.camera&&c.id===1)).length,
  }));
  const maxCam = Math.max(...camBars.map(c => c.count), 1);

  const donutData = [
    { label:'Unreviewed', v:unreviewed, color:'#94a3b8' },
    { label:'Confirmed',  v:confirmed,  color:'#dc2626' },
    { label:'Dismissed',  v:dismissed,  color:'#d97706' },
  ];
  const donutTotal = donutData.reduce((s,d) => s+d.v, 0) || 1;
  let donutOffset  = 0;

  const exportCSV = () => {
    const rows = ['id,timestamp,camera,description,status',
      ...incidents.map(i => `${i.id},"${i.timestamp}","${i.camera||'CAM-01'}","${i.description}","${i.review_status||'UNREVIEWED'}"`)
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows], { type:'text/csv' }));
    a.download = `cityshield_incidents_${Date.now()}.csv`;
    a.click();
  };

  return (
    <div className="analytics-root">
      <div className="kpi-row">
        {[
          { label:'TOTAL INCIDENTS',  value:total,         color:'var(--text-primary)' },
          { label:'CONFIRMED THREATS',value:confirmed,     color:'var(--red)' },
          { label:'FALSE POSITIVES',  value:dismissed,     color:'var(--amber)' },
          { label:'MODEL PRECISION',  value:`${accuracy}%`,color:'var(--accent)' },
        ].map(k => (
          <div key={k.label} className="kpi-card glass-panel">
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-val" style={{ color:k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="charts-row">
        <div className="glass-panel chart-card">
          <div className="chart-title">Incidents by hour of day</div>
          <div className="heatmap">
            {hours.map(({ h, count }) => (
              <div key={h} className="hm-col" title={`${h}:00 — ${count}`}>
                <div className="hm-wrap">
                  <div className="hm-bar" style={{
                    height:`${(count/maxH)*100}%`,
                    background: count>0 ? `rgba(220,38,38,${0.15+(count/maxH)*0.85})` : 'var(--surface-4)'
                  }} />
                </div>
                {h%6===0 && <span className="hm-label">{h}h</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel chart-card">
          <div className="chart-title">Alerts per camera node</div>
          <div className="cam-bars">
            {camBars.map(c => (
              <div key={c.name} className="cam-bar-row">
                <span className="cbar-label">{c.name}</span>
                <div className="cbar-track"><div className="cbar-fill" style={{ width:`${(c.count/maxCam)*100}%` }} /></div>
                <span className="cbar-count">{c.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel chart-card">
          <div className="chart-title">Review status breakdown</div>
          <div className="donut-row">
            <svg width="90" height="90" viewBox="0 0 90 90">
              {donutData.map((d, idx) => {
                const dash = (d.v/donutTotal)*219.9;
                const el = <circle key={idx} cx="45" cy="45" r="35" fill="none"
                  stroke={d.color} strokeWidth="16"
                  strokeDasharray={`${dash} ${219.9-dash}`}
                  strokeDashoffset={-donutOffset}
                  transform="rotate(-90 45 45)" />;
                donutOffset += dash;
                return el;
              })}
              <circle cx="45" cy="45" r="22" fill="var(--surface)" />
              <text x="45" y="49" textAnchor="middle" fill="var(--text-primary)"
                fontSize="11" fontFamily="'DM Mono',monospace" fontWeight="500">{total}</text>
            </svg>
            <div className="donut-legend">
              {donutData.map(d => (
                <div key={d.label} className="legend-row">
                  <span className="leg-dot" style={{ background:d.color }} />
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
  const [isViolent,   setIsViolent]   = useState(false);
  const [systemStatus,setSystemStatus]= useState('OFFLINE');
  const [alarmsArmed, setAlarmsArmed] = useState(false);
  const [incidents,   setIncidents]   = useState([]);
  const [confidence,  setConfidence]  = useState(0);
  const [threshold,   setThreshold]   = useState(60);
  const [activeTab,   setActiveTab]   = useState('MATRIX');
  const [focusedCam,  setFocusedCam]  = useState(1);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [confHistory, setConfHistory] = useState([]);
  const [dbCameras,   setDbCameras]   = useState([]);
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [soundMode,      setSoundMode]      = useState('siren');

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { user, isAdmin, isOperator, fullName, role, logout, isAuthenticated, loading: authLoading } = useAuth();

  // ── Notifications ──────────────────────────────────────────────────────────
  const { toasts, dismissToast, pushEnabled, requestPushPermission } = useNotifications({
    isViolent, confidence, systemStatus, incidents, alarmsArmed,
  });

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
    if (soundMode === 'silent') return;
    if (!audioCtxRef.current || oscRef.current) return;
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = soundMode === 'siren' ? 'square' : 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    osc.connect(gain); gain.connect(ctx.destination); osc.start();
    oscRef.current = osc; gainRef.current = gain;
    sirenTimerRef.current = setInterval(() => {
      if (gainRef.current) gainRef.current.gain.value = gainRef.current.gain.value === 0 ? 0.22 : 0;
    }, 280);
  }, [alarmsArmed, soundMode]);

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
    setShowPushBanner(true);
    setTimeout(() => setShowPushBanner(false), 12000);
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
        if (!violent && isViolent)  { setIsViolent(false); stopSiren(); }
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
    if (!alarmsArmed || !isAdmin) return;
    const t = setTimeout(() => {
      fetch(`${API_BASE}/config/threshold`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ threshold: threshold/100 }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [threshold, alarmsArmed, isAdmin]);

  // ── Triage Action ──────────────────────────────────────────────────────────
  const handleTriageAction = useCallback(async (id, status) => {
    const payload = { status, reviewed_by: fullName || 'Operator', reviewed_at: new Date().toISOString() };
    setIncidents(prev => prev.map(i => i.id===id ? {...i, review_status:status, ...payload} : i));
    fetch(`${API_BASE}/incidents/${id}/status`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, [fullName]);

  // ── Auth guards ────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
        <div style={{ width:28, height:28, border:'2.5px solid var(--border)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
      </div>
    );
  }

  if (!isAuthenticated) return <LoginScreen />;

  // ── Derived ────────────────────────────────────────────────────────────────
  const timeStr    = currentTime.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const dateStr    = currentTime.toLocaleDateString('en-GB',  { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
  const unreviewed = incidents.filter(i => !i.review_status || i.review_status === 'UNREVIEWED').length;

  // Admin sees 4 tabs, Operator sees 2
  const tabs = isAdmin
    ? ['MATRIX', 'ANALYTICS', 'CAMERAS', 'USERS']
    : ['MATRIX', 'ANALYTICS'];

  const tabLabels = {
    MATRIX:    '⬛ LIVE MATRIX',
    ANALYTICS: '◈ ANALYTICS',
    CAMERAS:   '⬡ CAMERAS',
    USERS:     '⊕ USERS',
  };

  return (
    <div className={`app-root ${isViolent ? 'alert-mode' : ''}`}>

      {/* ── NAV ── */}
      <nav className="top-nav">
        <div className="nav-brand">
          <div className="brand-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <path d="M16 2L4 7v8c0 7.4 5.1 14.3 12 16 6.9-1.7 12-8.6 12-16V7L16 2z" stroke="var(--accent)" strokeWidth="1.5"/>
              <path d="M11 16l3 3 7-7" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div className="brand-name">CityShield<span className="brand-ai"> AI</span></div>
            <div className="brand-sub">SMART CITY SURVEILLANCE · COMMAND CENTER</div>
          </div>
        </div>

        {/* Tabs — filtered by role */}
        <div className="nav-tabs">
          {tabs.map(tab => (
            <button key={tab}
              className={`nav-tab ${activeTab===tab ? 'tab-active':''}`}
              onClick={() => setActiveTab(tab)}>
              {tabLabels[tab]}
              {tab==='MATRIX' && unreviewed>0 && <span className="tab-badge">{unreviewed}</span>}
            </button>
          ))}
        </div>

        <div className="nav-right">
          <div className="clock-block">
            <div className="clock-time">{timeStr}</div>
            <div className="clock-date">{dateStr}</div>
          </div>

          {/* User pill */}
          <div className="nav-user-pill">
            <div className="nav-user-avatar">{fullName?.[0]?.toUpperCase() || 'U'}</div>
            <div className="nav-user-info">
              <span className="nav-user-name">{fullName}</span>
              <span className={`nav-user-role role-${role}`}>{role}</span>
            </div>
            <button className="nav-logout-btn" onClick={logout} title="Sign out">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Sound mode — both roles */}
          <button
            className={`sound-mode-btn ${soundMode!=='silent' ? 'sound-active':''}`}
            onClick={() => setSoundMode(m => m==='siren'?'tone':m==='tone'?'silent':'siren')}
            title="Cycle sound mode"
          >
            <span className="sound-dot" />
            {soundMode==='siren'?'SIREN':soundMode==='tone'?'TONE':'MUTED'}
          </button>

          {/* DIAG — admin only */}
          {alarmsArmed && isAdmin && (
            <button className="btn-diag" onClick={runDiagnostic}>DIAG TEST</button>
          )}

          {!alarmsArmed
            ? <button className="btn-arm pulse-arm" onClick={handleArm}>▶ ARM NETWORK</button>
            : <div className={`sys-badge ${isViolent?'badge-threat':'badge-secure'}`}>
                <span className="sys-dot" />
                {isViolent ? '⚠ THREAT DETECTED' : '● ALL NODES SECURE'}
              </div>
          }
        </div>
      </nav>

      {/* Push notification banner */}
      {showPushBanner && !pushEnabled && (
        <div className="push-permission-banner">
          <div className="push-banner-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="push-banner-text">
            <strong>Enable push alerts</strong> — get notified even when this tab isn't focused
          </span>
          <button className="push-banner-allow" onClick={async () => {
            await requestPushPermission();
            setShowPushBanner(false);
          }}>Allow</button>
          <button className="push-banner-dismiss" onClick={() => setShowPushBanner(false)}>Not now</button>
        </div>
      )}

      {/* Metrics strip */}
      <MetricsStrip alarmsArmed={alarmsArmed} />

      {/* ── ANALYTICS TAB ── */}
      {activeTab === 'ANALYTICS' && (
        <div className="tab-pane">
          <AnalyticsDashboard incidents={incidents} />
        </div>
      )}

      {/* ── CAMERAS TAB — admin only ── */}
      {activeTab === 'CAMERAS' && isAdmin && (
        <div className="tab-pane">
          <CameraConfigPanel onCamerasChange={setDbCameras} />
        </div>
      )}

      {/* ── USERS TAB — admin only ── */}
      {activeTab === 'USERS' && isAdmin && (
        <div className="tab-pane">
          <UserManagement currentUserEmail={user?.email} />
        </div>
      )}

      {/* ── MATRIX TAB ── */}
      {activeTab === 'MATRIX' && (
        <div className="matrix-layout">
          <section className="col-cams">
            <div className="camera-matrix">
              {CAMERA_NETWORK.map(cam => (
                <div key={cam.id}
                  className={`matrix-cell glass-panel
                    ${focusedCam===cam.id ? 'cell-focused':''}
                    ${cam.id===1&&isViolent ? 'cell-threat pulse-border':''}`}
                  onClick={() => setFocusedCam(cam.id)}>
                  <div className="cell-hdr">
                    <div className="cell-hdr-left">
                      <span className="cam-id">{cam.name}</span>
                      <span className="cam-loc">{cam.location}</span>
                    </div>
                    {cam.id===1
                      ? <span className={`ai-pill ${isViolent?'pill-red':'pill-green'}`}>
                          {isViolent ? '⚠ VIOLENCE' : systemStatus}
                        </span>
                      : <span className="pill-mono pill-gray">{cam.status}</span>
                    }
                  </div>
                  <div className="cell-video">
                    {cam.type==='live' ? (
                      <>
                        <img src={cam.url} alt="AI Feed" className="matrix-feed" />
                        <div className="conf-overlay">
                          <ConfidenceArc value={confidence} threshold={threshold} size={70} />
                        </div>
                        <div className="xh xh-tl"/><div className="xh xh-tr"/>
                        <div className="xh xh-bl"/><div className="xh xh-br"/>
                        {isViolent && (
                          <div className="threat-overlay">
                            <span className="threat-label">⚠ VIOLENCE DETECTED</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="matrix-sim" style={{ background:cam.bg }}>
                        {cam.type==='error' && <div className="static-noise"/>}
                        <span className="sim-txt">{cam.status}</span>
                      </div>
                    )}
                  </div>
                  <div className="cell-ftr">
                    <span className="cell-zone">{cam.zone}</span>
                    {cam.id===1 && <span className="cell-thr">THR {threshold}%</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className="col-side">
            {/* Confidence panel */}
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
                  <div className="conf-status" style={{ color: confidence>=threshold ? 'var(--red)':'var(--accent)' }}>
                    {confidence>=threshold ? '⚠ ABOVE THRESHOLD' : '● MONITORING'}
                  </div>
                </div>
              </div>

              {/* Threshold — admin editable, operator read-only */}
              {isAdmin ? (
                <div className="thr-control">
                  <div className="thr-hdr">
                    <span className="thr-label">Alert threshold</span>
                    <span className="thr-val">{threshold}%</span>
                  </div>
                  <input type="range" min="30" max="95" step="1" value={threshold}
                    onChange={e => setThreshold(Number(e.target.value))} className="thr-slider" />
                  <div className="thr-hints"><span>← High recall</span><span>High precision →</span></div>
                </div>
              ) : (
                <div className="thr-control" style={{ opacity:0.6, pointerEvents:'none' }}>
                  <div className="thr-hdr">
                    <span className="thr-label">Alert threshold</span>
                    <span className="thr-val">{threshold}%</span>
                  </div>
                  <div style={{ fontSize:'0.6rem', color:'var(--text-muted)', fontFamily:'var(--font-mono)', marginTop:4 }}>
                    🔒 Admin only — read-only view
                  </div>
                </div>
              )}
            </div>

            {/* City map */}
            <CityZoneMap isViolent={isViolent} onCamSelect={setFocusedCam} focusedCam={focusedCam} />

            {/* Triage — both roles */}
            <IncidentTriagePanel incidents={incidents} onAction={handleTriageAction} alarmsArmed={alarmsArmed} />
          </aside>
        </div>
      )}

      <ToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        onViewIncident={() => setActiveTab('MATRIX')}
      />
    </div>
  );
}
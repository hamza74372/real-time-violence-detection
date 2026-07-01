import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import MetricsStrip      from './MetricsStrip';
import ToastStack        from './ToastStack';
import CameraConfigPanel from './CameraConfigPanel';
import UserManagement    from './UserManagement';
import { useNotifications } from './useNotifications';
import { useAuth }       from './AuthContext';
import LoginScreen       from './LoginScreen';
import { authFetch }     from './authFetch';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
import { API_BASE, API_HOST } from './config';

const PYTHON_STREAM = `${API_HOST}/api/video_feed`;

// CAMERA_NETWORK removed — matrix now driven by dbCameras from the API

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

// cameras with lat=0 lng=0 have no GPS set (backend default) — exclude from map
const hasGps = c => c.latitude != null && c.longitude != null && !(c.latitude === 0 && c.longitude === 0);

// ─── MAP AUTO-CENTER — re-centers map whenever camera list changes ────────────
function MapAutoCenter({ cameras }) {
  const map = useMap();
  useEffect(() => {
    const valid = cameras.filter(hasGps);
    if (!valid.length) return;
    const avgLat = valid.reduce((s, c) => s + c.latitude,  0) / valid.length;
    const avgLng = valid.reduce((s, c) => s + c.longitude, 0) / valid.length;
    map.setView([avgLat, avgLng], map.getZoom(), { animate: true });
  }, [cameras, map]);
  return null;
}

// ─── SHARED COLOR HELPER ──────────────────────────────────────────────────────
function camStatusColor(cam, isViolent) {
  if (isViolent && cam.is_ai) return '#b91c1c'; // bold red on light map
  if (!cam.is_active)         return '#94a3b8'; // muted grey
  if (cam.is_ai)              return '#1d4ed8'; // strong blue
  return '#15803d';                             // strong green
}

// ─── CITY ZONE MAP (sidebar, compact) ────────────────────────────────────────
function CityZoneMap({ isViolent, onCamSelect, focusedCam, cameras = [], onExpand }) {
  const validCams    = cameras.filter(hasGps);
  const defaultCenter = validCams.length
    ? [validCams[0].latitude, validCams[0].longitude]
    : [33.6844, 73.0479];

  return (
    <div className="glass-panel map-panel">
      <div className="panel-header">
        <span className="panel-title">CITY ZONE MAP</span>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span className="pill-mono pill-cyan">GPS · LIVE</span>
          <button className="map-expand-btn" onClick={onExpand} title="Open full map">⛶</button>
        </div>
      </div>
      <div className="leaflet-wrapper">
        <MapContainer center={defaultCenter} zoom={13}
          style={{ height:'100%', width:'100%', background:'#0f172a' }}
          zoomControl={false} scrollWheelZoom={false} attributionControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
          <MapAutoCenter cameras={cameras} />
          {cameras.map(cam => {
            if (!hasGps(cam)) return null;
            const col    = camStatusColor(cam, isViolent);
            const focused = focusedCam === cam.id;
            const threat  = isViolent && cam.is_ai;
            return (
              <CircleMarker key={cam.id}
                center={[cam.latitude, cam.longitude]}
                radius={focused ? 10 : threat ? 9 : 7}
                pathOptions={{ color:col, fillColor:col, fillOpacity:0.8, weight: focused?2.5:1.5,
                  dashArray: threat ? '4 2' : undefined }}
                eventHandlers={{ click: () => onCamSelect(cam.id) }}>
                <Tooltip direction="top" offset={[0,-8]} className="map-cam-tooltip">
                  <strong>{cam.name}</strong><br />{cam.location}
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}

// ─── FULL MAP OVERLAY ─────────────────────────────────────────────────────────
function FullMapOverlay({ cameras, isViolent, onClose }) {
  const validCams     = cameras.filter(hasGps);
  const defaultCenter = validCams.length ? [validCams[0].latitude, validCams[0].longitude] : [33.6844, 73.0479];
  const noGpsActive   = cameras.filter(c => c.is_active && !hasGps(c));

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fmap-overlay">
      <div className="fmap-header">
        <div className="fmap-title-block">
          <span className="fmap-title">CITY SURVEILLANCE MAP</span>
          <span className="fmap-subtitle">
            {cameras.filter(c => c.is_active).length} active &nbsp;·&nbsp;
            {validCams.length} on map &nbsp;·&nbsp;
            {noGpsActive.length > 0 && <span className="fmap-warn">{noGpsActive.length} missing GPS</span>}
          </span>
        </div>
        <div className="fmap-legend">
          {[['#15803d','Online'],['#1d4ed8','AI Active'],['#b91c1c','Threat'],['#94a3b8','Offline']].map(([c,l]) => (
            <span key={l} className="fmap-leg-item">
              <span className="fmap-leg-dot" style={{ background:c }} />
              {l}
            </span>
          ))}
        </div>
        <button className="fmap-close-btn" onClick={onClose}>✕ Close  <kbd>ESC</kbd></button>
      </div>

      <div className="fmap-body">
        <MapContainer center={defaultCenter} zoom={13}
          style={{ height:'100%', width:'100%', background:'#0f172a' }}
          zoomControl={true} scrollWheelZoom={true} attributionControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>' />
          <MapAutoCenter cameras={cameras} />
          {cameras.map(cam => {
            if (!hasGps(cam)) return null;
            const col    = camStatusColor(cam, isViolent);
            const threat  = isViolent && cam.is_ai;
            const status  = !cam.is_active ? 'OFFLINE' : threat ? '⚠ THREAT' : cam.is_ai ? 'AI ACTIVE' : 'STANDBY';
            return (
              <CircleMarker key={cam.id}
                center={[cam.latitude, cam.longitude]}
                radius={threat ? 13 : 10}
                pathOptions={{ color:col, fillColor:col, fillOpacity:0.85, weight:2.5,
                  dashArray: threat ? '5 3' : undefined }}>
                <Tooltip permanent direction="top" offset={[0,-12]} className="map-cam-tooltip">
                  <strong>{cam.name}</strong><br />
                  {cam.location}<br />
                  <span style={{ color:col }}>{status}</span>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>

        {noGpsActive.length > 0 && (
          <div className="fmap-no-gps-bar">
            ⚠ {noGpsActive.map(c => c.name).join(', ')} — no GPS set. Go to CAMERAS tab → Edit to add coordinates.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── EVIDENCE VIEWER (full-screen video / snapshot) ──────────────────────────
function EvidenceModal({ incident, onClose }) {
  const videoSrc = incident.video_path    ? `${API_HOST}${incident.video_path}`    : null;
  const snapSrc  = incident.snapshot_path ? `${API_HOST}${incident.snapshot_path}` : null;

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ev-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ev-modal">

        <div className="ev-header">
          <div className="ev-meta">
            <span className="ev-badge">INC-{String(incident.id).padStart(4,'0')}</span>
            <span className="ev-cam">{incident.camera || 'CAM-01'}</span>
            <span className="ev-time">{incident.timestamp}</span>
            {incident.confidence > 0 && (
              <span className="ev-conf" style={{ color:'#dc2626' }}>{incident.confidence}% confidence</span>
            )}
          </div>
          <div className="ev-actions">
            {videoSrc && (
              <a className="ev-download-btn" href={videoSrc} download title="Download clip">
                ↓ Download clip
              </a>
            )}
            <button className="ev-close-btn" onClick={onClose}>✕ Close <kbd>ESC</kbd></button>
          </div>
        </div>

        <div className="ev-body">
          {videoSrc ? (
            <video
              className="ev-video"
              src={videoSrc}
              controls
              autoPlay
              loop
              onError={e => { e.target.style.display = 'none'; }}
            />
          ) : snapSrc ? (
            <img className="ev-image" src={snapSrc} alt="Evidence snapshot"
              onError={e => { e.target.style.display = 'none'; }} />
          ) : (
            <div className="ev-empty">No evidence media available</div>
          )}
        </div>

        <div className="ev-footer">
          <span className="ev-desc">{incident.description}</span>
          {incident.reviewed_by && (
            <span className="ev-reviewed">Actioned by {incident.reviewed_by}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// DispatchModal removed — email is sent directly from the triage card

// ─── INCIDENT TRIAGE ──────────────────────────────────────────────────────────
function IncidentTriagePanel({ incidents, onAction, alarmsArmed, isAdmin, onClearIncidents, clearedBefore }) {
  const [filter,      setFilter]      = useState('ALL');
  const [sendingId,   setSendingId]   = useState(null);
  const [clearPhase,  setClearPhase]  = useState('idle');
  const [evidenceInc, setEvidenceInc] = useState(null);

  // Filter out incidents created before the last "Clear All" — analytics DB is untouched
  // Replace space with T so Safari/WebKit can parse the SQLite timestamp format
  const visible = clearedBefore
    ? incidents.filter(i => new Date(i.timestamp.replace(' ', 'T')) >= new Date(clearedBefore))
    : incidents;

  const counts = { UNREVIEWED:0, CONFIRMED:0, DISMISSED:0, DISPATCHED:0, ESCALATED:0 };
  visible.forEach(i => { const s = i.review_status || 'UNREVIEWED'; if (counts[s] !== undefined) counts[s]++; });
  const list = filter === 'ALL' ? visible : visible.filter(i => (i.review_status || 'UNREVIEWED') === filter);

  const handleNotify = async (inc) => {
    setSendingId(inc.id);
    await onAction(inc.id, 'DISPATCHED');
    setSendingId(null);
  };

  const handleClear = () => {
    setClearPhase('clearing');
    onClearIncidents();
    setClearPhase('idle');
  };

  return (
    <div className="glass-panel triage-panel">
      <div className="panel-header">
        <span className="panel-title">INCIDENT TRIAGE</span>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span className="pill-mono pill-gray">{visible.length} TOTAL</span>
          {visible.length > 0 && clearPhase === 'idle' && (
            <button className="triage-clear-btn" onClick={() => setClearPhase('confirm')} title="Clear all incidents">
              ✕ Clear All
            </button>
          )}
          {clearPhase === 'confirm' && (
            <span className="triage-clear-confirm">
              Sure?&nbsp;
              <button className="tc-clear-yes" onClick={handleClear}>Yes</button>
              <button className="tc-clear-no"  onClick={() => setClearPhase('idle')}>No</button>
            </span>
          )}
          {clearPhase === 'clearing' && (
            <span className="triage-clearing">Clearing…</span>
          )}
        </div>
      </div>
      <div className="filter-row">
        {['ALL','UNREVIEWED','CONFIRMED','DISPATCHED','DISMISSED'].map(f => (
          <button key={f} className={`filter-btn ${filter===f?'filter-active':''}`} onClick={() => setFilter(f)}>
            {f}{f!=='ALL'&&counts[f]?<span className="f-count">{counts[f]}</span>:null}
          </button>
        ))}
      </div>
      <div className="triage-scroll">
        {list.length===0 && <div className="empty-state"><div className="empty-icon">{alarmsArmed ? '✓' : '⬡'}</div><p>{alarmsArmed ? 'No incidents in this category' : 'No incidents yet — arm network to begin live monitoring'}</p></div>}
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
              {/* ── Evidence thumbnail — click to open full-screen viewer ── */}
              {(inc.video_path || inc.snapshot_path) && (
                <button className="tc-evidence-thumb" onClick={() => setEvidenceInc(inc)}>
                  {inc.snapshot_path
                    ? <img src={`${API_HOST}${inc.snapshot_path}`} alt="evidence"
                        className="tc-thumb-img" onError={e => e.target.style.display='none'} />
                    : <div className="tc-thumb-placeholder">▶</div>
                  }
                  <div className="tc-thumb-overlay">
                    <span>{inc.video_path ? '▶ View Clip' : '🔍 View Snapshot'}</span>
                  </div>
                </button>
              )}
              {st === 'UNREVIEWED' && (
                <div className="tc-actions">
                  <button className="tc-btn btn-confirm"  onClick={() => onAction(inc.id,'CONFIRMED')}>✓ Confirm</button>
                  <button className="tc-btn btn-dismiss"  onClick={() => onAction(inc.id,'DISMISSED')}>✕ False +ve</button>
                  <button className="tc-btn btn-escalate" onClick={() => onAction(inc.id,'ESCALATED')}>↑ Escalate</button>
                </div>
              )}
              {st === 'CONFIRMED' && (
                <div className="tc-actions">
                  <button
                    className="tc-btn btn-dispatch"
                    disabled={sendingId === inc.id}
                    onClick={() => handleNotify(inc)}
                  >
                    {sendingId === inc.id ? '⏳ Sending...' : '📧 Inform Concerned Authority'}
                  </button>
                </div>
              )}
              {st === 'DISPATCHED' && (
                <div className="tc-dispatched-row">
                  <span className="tc-dispatched-unit">✓ Authority Notified via Email</span>
                </div>
              )}
              {st !== 'UNREVIEWED' && inc.reviewed_by && (
                <div className="tc-reviewed">Actioned by {inc.reviewed_by}</div>
              )}
            </div>
          );
        })}
      </div>

      {evidenceInc && (
        <EvidenceModal
          incident={evidenceInc}
          onClose={() => setEvidenceInc(null)}
        />
      )}
    </div>
  );
}

// ─── ANALYTICS CHART HELPERS ──────────────────────────────────────────────────
function AreaChart({ data = [], xKey = 'day', yKey = 'total', y2Key = null }) {
  if (data.length < 2) return (
    <div style={{ height:130, display:'flex', alignItems:'center', justifyContent:'center',
      color:'var(--text-muted)', fontSize:'0.65rem', fontFamily:'var(--font-mono)' }}>
      No data for this period
    </div>
  );
  const W=600, H=130, PL=28, PB=20, PT=6, PR=8;
  const cW=W-PL-PR, cH=H-PB-PT;
  const maxV = Math.max(...data.map(d => d[yKey]||0), 1);
  const xS = i => PL + (i/(data.length-1))*cW;
  const yS = v => PT + cH - ((v||0)/maxV)*cH;
  const pts  = data.map((d,i) => `${xS(i)},${yS(d[yKey]||0)}`).join(' ');
  const area = `${PL},${PT+cH} ${pts} ${PL+cW},${PT+cH}`;
  const pts2 = y2Key ? data.map((d,i) => `${xS(i)},${yS(d[y2Key]||0)}`).join(' ') : null;
  const step  = Math.max(1, Math.ceil(data.length/8));
  const xLbls = data.reduce((acc,d,i) => {
    if (i%step===0 || i===data.length-1) acc.push({ i, lbl: String(d[xKey]).slice(-5) });
    return acc;
  }, []);
  const yTicks = [0, Math.round(maxV/2), maxV];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display:'block' }}>
      <defs>
        <linearGradient id="ag1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#dc2626" stopOpacity="0.22"/>
          <stop offset="100%" stopColor="#dc2626" stopOpacity="0.01"/>
        </linearGradient>
      </defs>
      {yTicks.map(v => (
        <g key={v}>
          <line x1={PL} y1={yS(v)} x2={W-PR} y2={yS(v)} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,4"/>
          <text x={PL-3} y={yS(v)+3} textAnchor="end" fill="var(--text-muted)" fontSize="7.5" fontFamily="'DM Mono',monospace">{v}</text>
        </g>
      ))}
      <polygon points={area} fill="url(#ag1)"/>
      <polyline points={pts} fill="none" stroke="#dc2626" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
      {pts2 && <polyline points={pts2} fill="none" stroke="#22c55e" strokeWidth="1.2" strokeLinejoin="round" strokeDasharray="4,3"/>}
      {xLbls.map(({ i, lbl }) => (
        <text key={i} x={xS(i)} y={H-3} textAnchor="middle" fill="var(--text-muted)" fontSize="7" fontFamily="'DM Mono',monospace">{lbl}</text>
      ))}
    </svg>
  );
}

function HBarGroup({ data = [], labelKey = 'label', valKey = 'count', color = 'var(--accent)' }) {
  const max = Math.max(...data.map(d => d[valKey]||0), 1);
  if (!data.length) return <div style={{ color:'var(--text-muted)', fontSize:'0.62rem', fontFamily:'var(--font-mono)' }}>No data</div>;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
      {data.map((d,i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:9 }}>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:'0.57rem', color:'var(--text-secondary)', width:58, flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {d[labelKey]}
          </span>
          <div style={{ flex:1, height:6, background:'var(--surface-4)', borderRadius:3, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${((d[valKey]||0)/max)*100}%`, background:color, borderRadius:3, transition:'width 0.5s ease' }}/>
          </div>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:'0.6rem', color:'var(--text-primary)', width:24, textAlign:'right' }}>{d[valKey]}</span>
        </div>
      ))}
    </div>
  );
}

function VBars({ data = [], labelKey = 'label', valKey = 'count', color = '#dc2626', h = 80 }) {
  const max = Math.max(...data.map(d => d[valKey]||0), 1);
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:2, height:h }}>
      {data.map((d,i) => (
        <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', height:'100%' }}
          title={`${d[labelKey]||i}: ${d[valKey]}`}>
          <div style={{ flex:1, display:'flex', alignItems:'flex-end', width:'100%' }}>
            <div style={{
              width:'100%', borderRadius:'3px 3px 0 0',
              height:`${((d[valKey]||0)/max)*100}%`,
              minHeight: d[valKey]>0 ? 2 : 0,
              background: d[valKey]>0 ? color : 'var(--surface-4)',
              opacity: d[valKey]>0 ? (0.3+((d[valKey]||0)/max)*0.7) : 1,
              transition:'height 0.4s ease',
            }}/>
          </div>
          {d[labelKey] !== '' && d[labelKey] !== undefined && (
            <span style={{ fontFamily:'var(--font-mono)', fontSize:'0.42rem', color:'var(--text-muted)', marginTop:2 }}>{d[labelKey]}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── ANALYTICS DASHBOARD ──────────────────────────────────────────────────────
function AnalyticsDashboard({ incidents }) {
  const [range,     setRange]  = useState('30d');
  const [data,      setData]   = useState(null);
  const [busy,      setBusy]   = useState(true);
  const [fetchErr,  setFetchErr] = useState(false);
  const [tick,      setTick]   = useState(0);

  const RANGES = [
    { key:'7d',  label:'7 Days'  },
    { key:'30d', label:'30 Days' },
    { key:'90d', label:'90 Days' },
  ];

  useEffect(() => {
    let dead = false;
    setBusy(true);
    setFetchErr(false);
    authFetch(`${API_BASE}/analytics?time_range=${range}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { if (!dead) { setData(d); setBusy(false); } })
      .catch(() => { if (!dead) { setBusy(false); setFetchErr(true); } });
    return () => { dead = true; };
  }, [range, tick]);

  // Auto-refresh every 30 s so confirmed incidents appear without manual action
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const s          = data?.summary      ?? {};
  const daily      = data?.daily        ?? [];
  const hourly     = data?.hourly       ?? [];
  const camData    = data?.cameras      ?? [];
  const confData   = data?.conf_buckets ?? [];
  const weeklyData = data?.weekly       ?? [];

  const reviewed  = (s.confirmed||0) + (s.dismissed||0);
  const precision = reviewed > 0 ? Math.round(((s.confirmed||0)/reviewed)*100) : 0;
  const peakH     = hourly.length ? hourly.reduce((m,h) => h.count > m.count ? h : m, hourly[0]) : null;

  // Donut
  let dOff = 0;
  const dCirc = 219.9;
  const dTotal = Math.max(s.total||0, 1);
  const donutRows = [
    { label:'Unreviewed', v: Math.max((s.total||0)-(s.confirmed||0)-(s.dismissed||0), 0), color:'#64748b' },
    { label:'Confirmed',  v: s.confirmed||0, color:'#dc2626' },
    { label:'Dismissed',  v: s.dismissed||0, color:'#d97706' },
  ];

  const kpis = [
    { label:'TOTAL INCIDENTS',   val: s.total||0,              color:'var(--text-primary)', sub: null },
    { label:'CONFIRMED THREATS', val: s.confirmed||0,          color:'var(--red)',           sub: null },
    { label:'FALSE POSITIVES',   val: s.dismissed||0,          color:'var(--amber)',         sub: null },
    { label:'PRECISION',         val: `${precision}%`,         color:'var(--accent)',        sub: `${reviewed} reviewed` },
    { label:'AVG CONFIDENCE',    val: `${s.avg_confidence||0}%`, color:'var(--accent)',      sub: null },
    { label:'THIS WEEK',         val: s.this_week||0,
      color: (s.week_change_pct||0) > 0 ? 'var(--red)' : 'var(--accent)',
      sub: (s.week_change_pct||0) === 0 ? `${s.last_week||0} last week`
         : (s.week_change_pct||0)  > 0  ? `▲ ${s.week_change_pct}% vs last wk`
                                         : `▼ ${Math.abs(s.week_change_pct||0)}% vs last wk` },
  ];

  const exportCSV = () => {
    const rows = ['id,timestamp,camera,description,status,confidence',
      ...incidents.map(i => `${i.id},"${i.timestamp}","${i.camera||''}","${i.description}","${i.review_status||'UNREVIEWED'}","${i.confidence||0}"`)
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows], { type:'text/csv' }));
    a.download = `cityshield_report_${range}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div className="analytics-root">

      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:'0.6rem', letterSpacing:'1.6px', color:'var(--text-secondary)', fontWeight:500 }}>
          INCIDENT ANALYTICS REPORT
        </span>
        <span style={{ width:1, height:14, background:'var(--border)', display:'inline-block', margin:'0 4px' }}/>
        {RANGES.map(r => (
          <button key={r.key} onClick={() => setRange(r.key)} style={{
            padding:'3px 11px', borderRadius:4, fontSize:'0.63rem', fontFamily:'var(--font-mono)',
            cursor:'pointer', border:'1px solid',
            borderColor: range===r.key ? 'var(--accent)' : 'var(--border)',
            background:  range===r.key ? 'var(--accent)' : 'transparent',
            color:       range===r.key ? '#fff' : 'var(--text-muted)',
            transition:'all 0.15s',
          }}>{r.label}</button>
        ))}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          {fetchErr && (
            <span style={{ fontFamily:'var(--font-mono)', fontSize:'0.58rem', color:'var(--red)' }}>
              Backend unreachable — start server and retry
            </span>
          )}
          <button onClick={() => setTick(n => n + 1)} style={{
            padding:'3px 10px', borderRadius:4, fontSize:'0.6rem', fontFamily:'var(--font-mono)',
            cursor:'pointer', border:'1px solid var(--border)', background:'transparent',
            color: busy ? 'var(--text-muted)' : 'var(--accent)', transition:'all 0.15s',
          }} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>
          <span style={{ fontSize:'0.6rem', fontFamily:'var(--font-mono)', color:'var(--text-muted)' }}>
            {!busy && !fetchErr && `${s.total||0} incidents · ${new Date().toLocaleDateString()}`}
          </span>
        </div>
      </div>

      {/* ── KPI Row (6 cards) ── */}
      <div className="kpi-6">
        {kpis.map(k => (
          <div key={k.label} className="kpi-card glass-panel">
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-val" style={{ color:k.color, fontSize:'1.6rem' }}>{k.val}</div>
            {k.sub && (
              <div style={{ fontFamily:'var(--font-mono)', fontSize:'0.52rem', marginTop:5,
                color: k.sub.startsWith('▲') ? 'var(--red)' : k.sub.startsWith('▼') ? 'var(--accent)' : 'var(--text-muted)' }}>
                {k.sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Main: Daily trend area chart ── */}
      <div className="glass-panel chart-card">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div className="chart-title">
            Daily incident trend — {range==='7d' ? 'last 7 days' : range==='30d' ? 'last 30 days' : 'last 90 days'}
          </div>
          <div style={{ display:'flex', gap:14, alignItems:'center' }}>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:'0.53rem', color:'#dc2626' }}>── All incidents</span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:'0.53rem', color:'#22c55e' }}>- - Confirmed</span>
          </div>
        </div>
        {busy
          ? <div style={{ height:130, display:'flex', alignItems:'center', justifyContent:'center',
              color:'var(--text-muted)', fontSize:'0.65rem', fontFamily:'var(--font-mono)' }}>Loading chart…</div>
          : <AreaChart data={daily} xKey="day" yKey="total" y2Key="confirmed"/>
        }
      </div>

      {/* ── Row 2: Hourly | Camera breakdown | Donut ── */}
      <div className="charts-row">
        <div className="glass-panel chart-card">
          <div className="chart-title">Incidents by hour of day</div>
          <VBars
            data={hourly.map(h => ({ label: h.hour%6===0 ? `${h.hour}h` : '', count: h.count }))}
            valKey="count" labelKey="label" h={76}
          />
          {peakH && peakH.count > 0 && (
            <div style={{ fontFamily:'var(--font-mono)', fontSize:'0.53rem', color:'var(--text-muted)', marginTop:8 }}>
              Peak: <span style={{ color:'#dc2626' }}>{peakH.hour}:00 – {peakH.hour+1}:00</span> ({peakH.count} incidents)
            </div>
          )}
        </div>

        <div className="glass-panel chart-card">
          <div className="chart-title">Alerts per camera node</div>
          <HBarGroup
            data={camData.map(c => ({ label: c.camera_id, count: c.total }))}
            labelKey="label" valKey="count"
          />
          {camData.length===0 && !busy && (
            <div style={{ color:'var(--text-muted)', fontSize:'0.62rem', fontFamily:'var(--font-mono)' }}>No incidents logged yet</div>
          )}
        </div>

        <div className="glass-panel chart-card">
          <div className="chart-title">Review status</div>
          <div className="donut-row">
            <svg width="88" height="88" viewBox="0 0 90 90">
              {donutRows.map((d, idx) => {
                const dash = (d.v/dTotal)*dCirc;
                const el = (
                  <circle key={idx} cx="45" cy="45" r="35" fill="none"
                    stroke={d.color} strokeWidth="16"
                    strokeDasharray={`${dash} ${dCirc-dash}`}
                    strokeDashoffset={-dOff}
                    transform="rotate(-90 45 45)"/>
                );
                dOff += dash;
                return el;
              })}
              <circle cx="45" cy="45" r="22" fill="var(--surface)"/>
              <text x="45" y="49" textAnchor="middle" fill="var(--text-primary)"
                fontSize="11" fontFamily="'DM Mono',monospace" fontWeight="500">{s.total||0}</text>
            </svg>
            <div className="donut-legend">
              {donutRows.map(d => (
                <div key={d.label} className="legend-row">
                  <span className="leg-dot" style={{ background:d.color }}/>
                  <span className="leg-label">{d.label}</span>
                  <span className="leg-val">{d.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 3: Confidence histogram | Weekly bars ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <div className="glass-panel chart-card">
          <div className="chart-title">AI confidence score distribution</div>
          {confData.length > 0
            ? <HBarGroup data={confData.map(b => ({ label:`${b.bucket}%`, count:b.count }))} labelKey="label" valKey="count" color="#f97316"/>
            : <div style={{ color:'var(--text-muted)', fontSize:'0.62rem', fontFamily:'var(--font-mono)' }}>No confidence data recorded yet</div>
          }
        </div>

        <div className="glass-panel chart-card">
          <div className="chart-title">Weekly incident count — last 8 weeks</div>
          {weeklyData.length > 0 ? (
            <>
              <VBars
                data={weeklyData.map(w => ({ label:w.label, count:w.count }))}
                valKey="count" labelKey="label" color="#3b82f6" h={76}
              />
              <div style={{ fontFamily:'var(--font-mono)', fontSize:'0.53rem', color:'var(--text-muted)', marginTop:8 }}>
                This week: <span style={{ color:'var(--text-primary)' }}>{s.this_week||0}</span>
                {' · '}Last week: <span style={{ color:'var(--text-primary)' }}>{s.last_week||0}</span>
                {(s.avg_response_min||0) > 0 && ` · Avg review: ${s.avg_response_min}m`}
              </div>
            </>
          ) : (
            <div style={{ color:'var(--text-muted)', fontSize:'0.62rem', fontFamily:'var(--font-mono)' }}>
              {busy ? 'Loading…' : 'No data yet'}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="analytics-footer">
        <button className="btn-export" onClick={exportCSV}>⬇ Export CSV</button>
        <button className="btn-export" onClick={() => window.print()}
          style={{ background:'var(--surface-3)', borderColor:'var(--border)', color:'var(--text-secondary)' }}>
          ⎙ Print Report
        </button>
        <span className="analytics-note">
          {s.total||0} records · {range} range · Generated {new Date().toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ─── AUDIT LOGS PANEL ─────────────────────────────────────────────────────────
const ACTION_META = {
  CAMERA_ADDED:          { color: '#0284c7', icon: '⬡', label: 'Camera Added'    },
  CAMERA_UPDATED:        { color: '#0ea5e9', icon: '⬡', label: 'Camera Updated'  },
  CAMERA_DELETED:        { color: '#64748b', icon: '⬡', label: 'Camera Removed'  },
  USER_CREATED:          { color: '#a855f7', icon: '⊕', label: 'User Created'    },
  USER_DELETED:          { color: '#6b7280', icon: '⊕', label: 'User Deleted'    },
  INCIDENT_CONFIRMED:    { color: '#22c55e', icon: '✓', label: 'Confirmed'       },
  INCIDENT_DISMISSED:    { color: '#f59e0b', icon: '✕', label: 'Dismissed'       },
  INCIDENT_ESCALATED:    { color: '#a855f7', icon: '↑', label: 'Escalated'       },
  INCIDENT_DISPATCHED:   { color: '#3b82f6', icon: '🚔', label: 'Dispatched'    },
};

function AuditLogsPanel() {
  const [logs,        setLogs]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState('ALL');
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authFetch(`${API_BASE}/audit-logs`).then(r => r.json());
      setLogs(Array.isArray(data) ? data : []);
      setLastRefresh(new Date());
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const categories = ['ALL', 'INCIDENT', 'CAMERA', 'USER'];
  const filtered = filter === 'ALL'
    ? logs
    : logs.filter(l => l.action_type.startsWith(filter));

  const fmtTs = ts => {
    try { return new Date(ts).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', second:'2-digit' }); }
    catch { return ts; }
  };

  return (
    <div className="al-root">
      <div className="al-header">
        <div>
          <h2 className="al-title">System Audit Log</h2>
          <p className="al-sub">
            {logs.length} entries
            {lastRefresh && ` · refreshed ${lastRefresh.toLocaleTimeString('en-GB')}`}
          </p>
        </div>
        <button className="al-refresh-btn" onClick={fetchLogs} disabled={loading}>
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      <div className="al-filter-row">
        {categories.map(c => (
          <button key={c} className={`al-filter-btn ${filter===c ? 'al-filter-active':''}`}
            onClick={() => setFilter(c)}>{c}</button>
        ))}
      </div>

      <div className="al-list">
        {loading && <div className="al-empty"><div className="al-spinner" /><span>Loading logs…</span></div>}
        {!loading && filtered.length === 0 && (
          <div className="al-empty"><p>No audit entries in this category.</p></div>
        )}
        {!loading && filtered.map(log => {
          const meta = ACTION_META[log.action_type] || { color:'#94a3b8', icon:'·', label: log.action_type };
          return (
            <div key={log.log_id} className="al-row">
              <div className="al-icon" style={{ color: meta.color }}>{meta.icon}</div>
              <div className="al-body">
                <div className="al-action-row">
                  <span className="al-action-pill" style={{ color: meta.color, borderColor: meta.color + '44', background: meta.color + '18' }}>
                    {meta.label}
                  </span>
                  <span className="al-actor">{log.user_email || 'system'}</span>
                </div>
                <div className="al-desc">{log.event_description}</div>
              </div>
              <div className="al-ts">{fmtTs(log.timestamp)}</div>
            </div>
          );
        })}
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
  // Triage "clear" hides incidents older than this timestamp; analytics is unaffected
  const [triageClearedBefore, setTriageClearedBefore] = useState(
    () => localStorage.getItem('triageClearedBefore') || null
  );
  const [confidence,  setConfidence]  = useState(0);
  const [threshold,   setThreshold]   = useState(60);
  const [activeTab,   setActiveTab]   = useState('MATRIX');
  const [focusedCam,  setFocusedCam]  = useState(1);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [confHistory, setConfHistory] = useState([]);
  const [dbCameras,   setDbCameras]   = useState([]);
  const [camsLoaded,  setCamsLoaded]  = useState(false);
  const [camStates,   setCamStates]   = useState({});
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [soundMode,      setSoundMode]      = useState('siren');
  const [streamErrors,   setStreamErrors]   = useState({});
  const [streamRetryKeys,setStreamRetryKeys]= useState({});
  const [showFullMap,    setShowFullMap]    = useState(false);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { user, isAdmin, isOperator, fullName, role, logout, isAuthenticated, loading: authLoading } = useAuth();

  // ── Notifications ──────────────────────────────────────────────────────────
  const { toasts, dismissToast, pushEnabled, requestPushPermission } = useNotifications({
    isViolent, confidence, systemStatus, incidents, alarmsArmed,
  });

  const audioCtxRef    = useRef(null);
  const oscRef         = useRef(null);
  const gainRef        = useRef(null);
  const sirenTimerRef  = useRef(null);
  const streamRetryRef = useRef({});  // camId → pending retry timer

  // ── Audio ──────────────────────────────────────────────────────────────────
  const stopSiren = useCallback(() => {
    clearInterval(sirenTimerRef.current);
    try { oscRef.current?.stop(); oscRef.current?.disconnect(); } catch {}
    try { gainRef.current?.disconnect(); } catch {}
    oscRef.current = null; gainRef.current = null;
  }, []);

  const retryStream = useCallback((camId) => {
    clearTimeout(streamRetryRef.current[camId]);
    delete streamRetryRef.current[camId];
    setStreamErrors(prev => ({ ...prev, [camId]: false }));
    setStreamRetryKeys(prev => ({ ...prev, [camId]: (prev[camId] || 0) + 1 }));
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
    const poll = setInterval(async () => { // 1 s — was 500 ms
      try {
        const data = await authFetch(`${API_BASE}/status`).then(r => r.json());
        setSystemStatus(data.status || 'MONITORING');
        const conf = Math.round((data.confidence || 0) * 100);
        setConfidence(conf);
        setConfHistory(h => [...h.slice(-29), conf]);
        const violent = String(data.status).includes('VIOLENCE');
        if (violent && !isViolent)  { setIsViolent(true);  startSiren(); }
        if (!violent && isViolent)  { setIsViolent(false); stopSiren(); }
      } catch { setSystemStatus('CONN ERR'); }
    }, 1000);
    return () => { clearInterval(poll); stopSiren(); };
  }, [alarmsArmed, isViolent, startSiren, stopSiren]);

  // ── Camera DB Polling (starts only after Firebase auth is ready) ─────────────
  useEffect(() => {
    if (!user) return;
    const loadCams = () =>
      authFetch(`${API_BASE}/cameras`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => { setDbCameras(Array.isArray(data) ? data : []); setCamsLoaded(true); })
        .catch(() => { setCamsLoaded(true); });
    loadCams();
    const t = setInterval(loadCams, 5000);
    return () => clearInterval(t);
  }, [user]);

  // ── Incident Polling — always load when logged in, faster when armed ────────
  useEffect(() => {
    if (!user) return;
    const load = () => authFetch(`${API_BASE}/incidents`).then(r => r.json()).then(setIncidents).catch(() => {});
    load();
    const t = setInterval(load, alarmsArmed ? 2000 : 8000);
    return () => clearInterval(t);
  }, [user, alarmsArmed]);

  // ── Per-camera state poll (status bar on each card) ───────────────────────
  useEffect(() => {
    const load = () =>
      fetch(`${API_HOST}/api/camera_states`)
        .then(r => r.ok ? r.json() : {})
        .then(data => setCamStates(data))
        .catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  // ── Threshold Sync — both admin and operator can tune sensitivity ────────────
  useEffect(() => {
    if (!alarmsArmed) return;
    const t = setTimeout(() => {
      authFetch(`${API_BASE}/config/threshold`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ threshold: threshold/100 }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [threshold, alarmsArmed]);

  // ── Triage Action ──────────────────────────────────────────────────────────
  const handleTriageAction = useCallback(async (id, status) => {
    const payload = { status, reviewed_by: fullName || 'Operator', reviewed_at: new Date().toISOString() };
    setIncidents(prev => prev.map(i => i.id===id ? {...i, review_status:status, ...payload} : i));
    await authFetch(`${API_BASE}/incidents/${id}/status`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, [fullName]);

  const handleClearIncidents = useCallback(() => {
    const now = new Date().toISOString();
    localStorage.setItem('triageClearedBefore', now);
    setTriageClearedBefore(now);
  }, []);

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
    ? ['MATRIX', 'ANALYTICS', 'CAMERAS', 'USERS', 'LOGS']
    : ['MATRIX', 'ANALYTICS'];

  const tabLabels = {
    MATRIX:    '⬛ LIVE MATRIX',
    ANALYTICS: '◈ ANALYTICS',
    CAMERAS:   '⬡ CAMERAS',
    USERS:     '⊕ USERS',
    LOGS:      '≡ AUDIT LOGS',
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
          <AnalyticsDashboard incidents={incidents} cameras={dbCameras} />
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

      {/* ── LOGS TAB — admin only ── */}
      {activeTab === 'LOGS' && isAdmin && (
        <div className="tab-pane">
          <AuditLogsPanel />
        </div>
      )}

      {/* ── MATRIX TAB ── */}
      {activeTab === 'MATRIX' && (
        <div className="matrix-layout">
          <section className="col-cams">
            <div className="camera-matrix">
              {!camsLoaded && (
                <div style={{ gridColumn:'1/-1', display:'flex', alignItems:'center', justifyContent:'center', gap:10, padding:32, color:'var(--text-muted)', fontSize:'0.75rem', fontFamily:'var(--font-mono)' }}>
                  <div style={{ width:16, height:16, border:'2px solid var(--border)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
                  Loading camera network…
                </div>
              )}
              {camsLoaded && dbCameras.filter(c => c.is_active).map(cam => {
                const isHttpFeed   = !cam.is_ai && cam.rtsp_url?.startsWith('http');
                const isLive       = cam.is_ai || isHttpFeed;
                // Always route live feeds through backend — handles MJPEG, snapshot polling,
                // reconnect logic. Direct URL load was causing blank for HTTP phone cameras.
                const retryKey     = streamRetryKeys[cam.id] || 0;
                const streamUrl    = isLive
                  ? `${API_HOST}/api/video_feed/${cam.id}${retryKey ? `?r=${retryKey}` : ''}`
                  : cam.rtsp_url;

                // Per-camera AI state from backend
                const camState     = camStates[String(cam.id)];
                const camStatus    = camState?.status || '';
                const camConf      = Math.round((camState?.confidence || 0) * 100);
                const isCamViolent = camStatus.includes('VIOLENCE');
                const statusLabel  = cam.is_ai
                  ? (isCamViolent ? '⚠ VIOLENCE' : (camStatus || 'AI ACTIVE'))
                  : 'LIVE FEED';
                const isConnecting = camStatus.includes('Waiting') || camStatus.includes('Connecting') || camStatus.includes('SNAP');
                const isError      = camStatus.includes('ERROR') || camStatus.includes('failed');
                const isMonitor    = camStatus.includes('MONITORING') || camStatus.includes('VIOLENCE');
                const barColor     = isError ? '#dc2626' : isConnecting ? '#f59e0b' : isMonitor ? '#22c55e' : '#64748b';
                const barLabel     = isError ? 'STREAM ERROR' : isConnecting ? 'CONNECTING…' : isMonitor ? 'STREAMING' : camStatus || 'WAITING';

                return (
                  <div key={cam.id}
                    className={`matrix-cell glass-panel
                      ${focusedCam===cam.id ? 'cell-focused':''}
                      ${cam.is_ai&&isCamViolent ? 'cell-threat pulse-border':''}`}
                    onClick={() => setFocusedCam(cam.id)}>
                    <div className="cell-hdr">
                      <div className="cell-hdr-left">
                        <span className="cam-id">{cam.name}</span>
                        <span className="cam-loc">{cam.location}</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                        {isLive && (
                          <button
                            title="Refresh stream"
                            onClick={e => { e.stopPropagation(); retryStream(cam.id); }}
                            style={{ background:'none', border:'none', cursor:'pointer', padding:'1px 3px', color:'var(--text-muted)', fontSize:'0.85rem', lineHeight:1, borderRadius:3, transition:'color 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.color='var(--text-primary)'}
                            onMouseLeave={e => e.currentTarget.style.color='var(--text-muted)'}
                          >⟳</button>
                        )}
                        <span className={`ai-pill ${cam.is_ai&&isCamViolent ? 'pill-red' : isLive ? 'pill-green' : 'pill-gray'}`}>
                          {statusLabel}
                        </span>
                      </div>
                    </div>
                    {/* Connection status bar */}
                    {cam.is_ai && (
                      <div className="cam-status-bar">
                        <span className="cam-status-dot" style={{ background: barColor, boxShadow: isConnecting ? `0 0 6px ${barColor}` : 'none' }} />
                        <span className="cam-status-txt" style={{ color: barColor }}>{barLabel}</span>
                        {isConnecting && <span className="cam-status-spinner" />}
                      </div>
                    )}
                    <div className="cell-video">
                      {isLive ? (
                        <>
                          {streamErrors[cam.id] ? (
                            <div className="matrix-sim" style={{ background:'#0f172a', flexDirection:'column', gap:8 }}>
                              <span className="sim-txt">STREAM OFFLINE</span>
                              <button
                                onClick={e => { e.stopPropagation(); retryStream(cam.id); }}
                                style={{ fontFamily:'var(--font-mono)', fontSize:'0.58rem', letterSpacing:'1px', padding:'3px 10px', background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:4, color:'var(--text-secondary)', cursor:'pointer' }}
                              >↻ RECONNECT</button>
                            </div>
                          ) : (
                            <>
                              <img
                                src={streamUrl}
                                alt={`${cam.name} feed`}
                                className="matrix-feed"
                                onError={() => {
                                  setStreamErrors(prev => ({ ...prev, [cam.id]: true }));
                                  clearTimeout(streamRetryRef.current[cam.id]);
                                  streamRetryRef.current[cam.id] = setTimeout(() => retryStream(cam.id), 4000);
                                }}
                              />
                              {cam.is_ai && (
                                <div className="conf-overlay">
                                  <ConfidenceArc value={camConf} threshold={threshold} size={70} />
                                </div>
                              )}
                              <div className="xh xh-tl"/><div className="xh xh-tr"/>
                              <div className="xh xh-bl"/><div className="xh xh-br"/>
                              {cam.is_ai && isCamViolent && (
                                <div className="threat-overlay">
                                  <span className="threat-label">⚠ VIOLENCE DETECTED</span>
                                </div>
                              )}
                            </>
                          )}
                        </>
                      ) : (
                        <div className="matrix-sim" style={{ background:'#1e293b', flexDirection:'column', gap:6 }}>
                          <span className="sim-txt">RTSP CAMERA</span>
                          <span style={{ fontSize:'0.58rem', color:'var(--text-muted)', fontFamily:'var(--font-mono)', textAlign:'center' }}>
                            Enable AI Inference in camera settings to preview this feed
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="cell-ftr">
                      <span className="cell-zone">{cam.zone}</span>
                      {cam.is_ai && <span className="cell-thr">THR {threshold}%</span>}
                    </div>
                  </div>
                );
              })}
              {camsLoaded && dbCameras.filter(c => c.is_active).length === 0 && (
                <div style={{ gridColumn:'1/-1', textAlign:'center', padding:48, color:'var(--text-muted)', fontSize:'0.75rem', fontFamily:'var(--font-mono)' }}>
                  No active cameras · Go to CAMERAS tab to add one
                </div>
              )}
            </div>
          </section>

          <aside className="col-side">
            {/* Confidence panel */}
            <div className="glass-panel conf-panel">
              <div className="panel-header">
                <span className="panel-title">AI CONFIDENCE MONITOR</span>
                <span className="pill-mono pill-cyan">
                  {dbCameras.filter(c => c.is_ai && c.is_active).length > 1
                    ? `${dbCameras.filter(c => c.is_ai && c.is_active).length} AI CAMS`
                    : 'CAM-01'}
                </span>
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
            <CityZoneMap isViolent={isViolent} onCamSelect={setFocusedCam} focusedCam={focusedCam}
              cameras={dbCameras} onExpand={() => setShowFullMap(true)} />

            {/* Triage — both roles */}
            <IncidentTriagePanel incidents={incidents} onAction={handleTriageAction}
              alarmsArmed={alarmsArmed} isAdmin={isAdmin} onClearIncidents={handleClearIncidents}
              clearedBefore={triageClearedBefore} />
          </aside>
        </div>
      )}

      {showFullMap && (
        <FullMapOverlay cameras={dbCameras} isViolent={isViolent} onClose={() => setShowFullMap(false)} />
      )}

      <ToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        onViewIncident={() => setActiveTab('MATRIX')}
      />
    </div>
  );
}
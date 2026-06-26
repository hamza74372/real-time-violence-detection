import React, { useState, useEffect, useCallback } from 'react';
import './CameraConfigPanel.css';
import 'leaflet/dist/leaflet.css';
import { authFetch } from './authFetch';
import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet';
import { API_BASE } from './config';
const EMPTY = { name:'', location:'', zone:'ZONE-A', rtsp_url:'', is_active:true, is_ai:false, latitude:0, longitude:0 };

// ── Connection test result ─────────────────────────────────────────────────────
function ConnResult({ result }) {
  if (!result) return null;
  if (result.loading) return <div className="conn-result conn-testing">Testing connection…</div>;
  if (result.reachable) return (
    <div className="conn-result conn-ok">
      <span className="conn-dot dot-ok" /> Reachable · {result.latency_ms}ms
    </div>
  );
  return (
    <div className="conn-result conn-fail">
      <span className="conn-dot dot-fail" /> Unreachable — {result.error || 'Connection refused'}
    </div>
  );
}

// ── Toggle switch ──────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, accent }) {
  return (
    <div className={`cp-toggle ${checked ? (accent ? 'toggle-ai' : 'toggle-on') : ''}`} onClick={onChange}>
      <div className="cp-toggle-thumb" />
    </div>
  );
}

// ── Map click handler (must be a child of MapContainer) ──────────────────────
function PickerEvents({ onPick }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

// ── Full-screen map picker modal ───────────────────────────────────────────────
function MapPickerModal({ initialLat, initialLng, onConfirm, onClose }) {
  const defaultLat = (initialLat && initialLat !== 0) ? initialLat : 33.6844;
  const defaultLng = (initialLng && initialLng !== 0) ? initialLng : 73.0479;
  const [pin, setPin] = useState({ lat: defaultLat, lng: defaultLng });
  const [pinSet, setPinSet] = useState(!!(initialLat && initialLat !== 0));

  const handlePick = (lat, lng) => { setPin({ lat, lng }); setPinSet(true); };

  return (
    <div className="cp-map-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="cp-map-modal">
        <div className="cp-map-header">
          <div>
            <span className="cp-map-title">Pick Camera Location</span>
            <span className="cp-map-hint">Click anywhere on the map to place the pin</span>
          </div>
          <button className="cp-close" onClick={onClose}>✕</button>
        </div>

        <div className="cp-map-body">
          <MapContainer center={[defaultLat, defaultLng]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            />
            <PickerEvents onPick={handlePick} />
            {pinSet && (
              <CircleMarker center={[pin.lat, pin.lng]} radius={10}
                pathOptions={{ color: '#4f6ef7', fillColor: '#4f6ef7', fillOpacity: 1, weight: 3 }}>
              </CircleMarker>
            )}
          </MapContainer>
        </div>

        <div className="cp-map-footer">
          <span className="cp-map-coords">
            {pinSet
              ? <>📍 <strong>{pin.lat.toFixed(6)}</strong>, <strong>{pin.lng.toFixed(6)}</strong></>
              : <span className="cp-map-no-pin">No pin placed yet — click on the map</span>
            }
          </span>
          <div className="cp-map-actions">
            <button className="cp-btn-cancel" onClick={onClose}>Cancel</button>
            <button className="cp-btn-save" disabled={!pinSet}
              onClick={() => onConfirm(pin.lat, pin.lng)}>
              Confirm Location
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Camera form modal ──────────────────────────────────────────────────────────
function CameraForm({ initial, onSave, onCancel, isSaving }) {
  const [form,       setForm]       = useState(initial || EMPTY);
  const [connResult, setConnResult] = useState(null);
  const [errors,     setErrors]     = useState({});
  const [gpsState,   setGpsState]   = useState('idle'); // idle | fetching | ok | error
  const [showPicker, setShowPicker] = useState(false);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setGpsState('error'); return; }
    setGpsState('fetching');
    navigator.geolocation.getCurrentPosition(
      pos => {
        set('latitude',  parseFloat(pos.coords.latitude.toFixed(6)));
        set('longitude', parseFloat(pos.coords.longitude.toFixed(6)));
        setGpsState('ok');
      },
      () => setGpsState('error'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); };

  const validate = () => {
    const e = {};
    if (!form.name.trim())     e.name     = 'Camera name is required';
    if (!form.location.trim()) e.location = 'Location is required';
    if (!form.rtsp_url.trim()) e.rtsp_url = 'Stream URL is required';
    else if (!form.rtsp_url.startsWith('rtsp://') && !form.rtsp_url.startsWith('http://') && !form.rtsp_url.startsWith('https://'))
      e.rtsp_url = 'URL must start with rtsp://, http://, or https://';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleTest = async () => {
    if (!form.rtsp_url.trim()) { setErrors(e => ({ ...e, rtsp_url:'Enter a URL first' })); return; }
    setConnResult({ loading: true });
    try {
      const res = await authFetch(`${API_BASE}/cameras/test-rtsp`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url: form.rtsp_url }),
      });
      setConnResult(await res.json());
    } catch {
      setConnResult({ reachable:false, latency_ms:null, error:'API unreachable' });
    }
  };

  return (
    <>
    <div className="cp-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="cp-modal">
        <div className="cp-modal-header">
          <span className="cp-modal-title">{initial?.id ? 'Edit camera' : 'Register new camera'}</span>
          <button className="cp-close" onClick={onCancel}>✕</button>
        </div>

        <div className="cp-modal-body">
          {/* Name */}
          <div className="cp-field">
            <label className="cp-label">Camera name <span className="cp-req">*</span></label>
            <input className={`cp-input ${errors.name ? 'cp-input-err':''}`}
              placeholder="e.g. CAM-05" value={form.name}
              onChange={e => set('name', e.target.value)} />
            {errors.name && <span className="cp-err">{errors.name}</span>}
          </div>

          {/* Location */}
          <div className="cp-field">
            <label className="cp-label">Physical location <span className="cp-req">*</span></label>
            <input className={`cp-input ${errors.location ? 'cp-input-err':''}`}
              placeholder="e.g. North Gate / Parking Level 2" value={form.location}
              onChange={e => set('location', e.target.value)} />
            {errors.location && <span className="cp-err">{errors.location}</span>}
          </div>

          {/* GPS Coordinates */}
          <div className="cp-field">
            <div className="cp-gps-header">
              <label className="cp-label">GPS Coordinates <span className="cp-label-opt">(optional — shows on map)</span></label>
              <div className="cp-gps-btns">
                <button type="button" className="cp-gps-btn" onClick={() => setShowPicker(true)}>
                  🗺 View Map
                </button>
                <button type="button" className={`cp-gps-btn ${gpsState === 'fetching' ? 'gps-fetching' : ''}`}
                  onClick={useMyLocation} disabled={gpsState === 'fetching'}>
                  {gpsState === 'fetching' ? '…' : '⊕ My Location'}
                </button>
              </div>
            </div>
            <div className="cp-row-2">
              <input className="cp-input" type="number" step="0.000001"
                placeholder="Latitude (e.g. 33.6844)"
                value={form.latitude || ''}
                onChange={e => { set('latitude', parseFloat(e.target.value) || 0); setGpsState('idle'); }} />
              <input className="cp-input" type="number" step="0.000001"
                placeholder="Longitude (e.g. 73.0479)"
                value={form.longitude || ''}
                onChange={e => { set('longitude', parseFloat(e.target.value) || 0); setGpsState('idle'); }} />
            </div>
            {(gpsState === 'ok' || (form.latitude !== 0 && form.longitude !== 0)) && (
              <div className="cp-gps-feedback">
                <span className="cp-gps-ok">📍 {Number(form.latitude).toFixed(6)}, {Number(form.longitude).toFixed(6)}</span>
                <a className="cp-gps-verify"
                  href={`https://www.google.com/maps?q=${form.latitude},${form.longitude}`}
                  target="_blank" rel="noreferrer">Verify on Google Maps ↗</a>
              </div>
            )}
            {gpsState === 'error' && (
              <span className="cp-err">Could not get location — allow browser location access and retry.</span>
            )}
          </div>

          {/* URL + test */}
          <div className="cp-field">
            <label className="cp-label">Stream URL <span className="cp-req">*</span></label>
            <div className="cp-url-row">
              <input className={`cp-input cp-url-input ${errors.rtsp_url ? 'cp-input-err':''}`}
                placeholder="rtsp://192.168.1.x:554/stream  or  http://..."
                value={form.rtsp_url} onChange={e => { set('rtsp_url', e.target.value); setConnResult(null); }} />
              <button className="cp-test-btn" onClick={handleTest} disabled={connResult?.loading}>
                {connResult?.loading ? '…' : 'Test'}
              </button>
            </div>
            {errors.rtsp_url && <span className="cp-err">{errors.rtsp_url}</span>}
            <ConnResult result={connResult} />
          </div>

          {/* Toggles */}
          <div className="cp-toggles">
            <div className="cp-toggle-row">
              <div className="cp-toggle-info">
                <span className="cp-toggle-title">Enable camera</span>
                <span className="cp-toggle-sub">Camera appears in the live matrix</span>
              </div>
              <Toggle checked={form.is_active} onChange={() => set('is_active', !form.is_active)} />
            </div>
            <div className="cp-toggle-row">
              <div className="cp-toggle-info">
                <span className="cp-toggle-title">AI inference active</span>
                <span className="cp-toggle-sub">Runs CNN+LSTM model on this feed</span>
              </div>
              <Toggle checked={form.is_ai} onChange={() => set('is_ai', !form.is_ai)} accent />
            </div>
          </div>
        </div>

        <div className="cp-modal-footer">
          <button className="cp-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="cp-btn-save" onClick={() => validate() && onSave(form)} disabled={isSaving}>
            {isSaving ? 'Saving…' : initial?.id ? 'Save changes' : 'Register camera'}
          </button>
        </div>
      </div>
    </div>

    {showPicker && (
      <MapPickerModal
        initialLat={form.latitude}
        initialLng={form.longitude}
        onConfirm={(lat, lng) => {
          set('latitude', parseFloat(lat.toFixed(6)));
          set('longitude', parseFloat(lng.toFixed(6)));
          setGpsState('ok');
          setShowPicker(false);
        }}
        onClose={() => setShowPicker(false)}
      />
    )}
    </>
  );
}

// ── Camera row ─────────────────────────────────────────────────────────────────
function CameraRow({ cam, onEdit, onToggle, onDelete }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className={`cp-row ${!cam.is_active ? 'cp-row-offline':''}`}>
      <div className="cp-row-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8h12a2 2 0 012 2v4a2 2 0 01-2 2H3a2 2 0 01-2-2v-4a2 2 0 012-2z"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      <div className="cp-row-info">
        <div className="cp-row-name">
          {cam.name}
          {cam.is_ai ? <span className="cp-ai-tag">AI</span> : null}
        </div>
        <div className="cp-row-loc">{cam.location} · {cam.zone}</div>
        <div className="cp-row-url">{cam.rtsp_url}</div>
      </div>

      <span className={`cp-status-badge ${cam.is_active ? 'badge-active':'badge-offline'}`}>
        <span className="cp-badge-dot" />{cam.is_active ? 'Active' : 'Offline'}
      </span>

      <div className="cp-row-actions">
        <button className="cp-action-btn btn-edit" onClick={() => onEdit(cam)} title="Edit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button className={`cp-action-btn ${cam.is_active ? 'btn-deactivate':'btn-activate'}`}
          onClick={() => onToggle(cam)} title={cam.is_active ? 'Deactivate':'Activate'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        {!confirm
          ? <button className="cp-action-btn btn-delete" onClick={() => setConfirm(true)} title="Delete">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          : <div className="cp-confirm">
              <span>Remove?</span>
              <button className="cp-confirm-yes" onClick={() => onDelete(cam.id)}>Yes</button>
              <button className="cp-confirm-no"  onClick={() => setConfirm(false)}>No</button>
            </div>
        }
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function CameraConfigPanel({ onCamerasChange }) {
  const [cameras,    setCameras]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [isSaving,   setIsSaving]   = useState(false);
  const [toast,      setToast]      = useState(null);
  const [resetPhase, setResetPhase] = useState('idle'); // idle | confirm | clearing

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  const loadCameras = useCallback(async () => {
    try {
      const res  = await authFetch(`${API_BASE}/cameras`);
      const data = res.ok ? await res.json() : [];
      setCameras(Array.isArray(data) ? data : []);
      onCamerasChange?.(Array.isArray(data) ? data : []);
    } catch {
      showToast('Could not reach camera API', 'error');
    } finally {
      setLoading(false);
    }
  }, [onCamerasChange]);

  useEffect(() => { loadCameras(); }, [loadCameras]);

  const handleSave = async (form) => {
    setIsSaving(true);
    try {
      const isEdit = !!editTarget?.id;
      const url    = isEdit ? `${API_BASE}/cameras/${editTarget.id}` : `${API_BASE}/cameras`;
      const method = isEdit ? 'PATCH' : 'POST';
      await authFetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
      await loadCameras();
      setShowForm(false); setEditTarget(null);
      showToast(isEdit ? 'Camera updated' : 'Camera registered');
    } catch { showToast('Save failed', 'error'); }
    finally  { setIsSaving(false); }
  };

  const handleToggle = async (cam) => {
    try {
      await authFetch(`${API_BASE}/cameras/${cam.id}`, {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ is_active: !cam.is_active }),
      });
      setCameras(prev => prev.map(c => c.id===cam.id ? {...c, is_active:!cam.is_active} : c));
      showToast(`${cam.name} ${cam.is_active ? 'deactivated':'activated'}`);
    } catch { showToast('Update failed', 'error'); }
  };

  const handleDelete = async (id) => {
    try {
      await authFetch(`${API_BASE}/cameras/${id}`, { method:'DELETE' });
      await loadCameras();
      showToast('Camera decommissioned');
    } catch { showToast('Delete failed', 'error'); }
  };

  const handleReset = async () => {
    setResetPhase('clearing');
    try {
      const res = await authFetch(`${API_BASE}/admin/reset-database`, { method: 'DELETE' });
      if (res.ok) {
        await loadCameras();
        showToast('Database cleared — all cameras, incidents and logs removed');
      } else {
        showToast('Reset failed', 'error');
      }
    } catch { showToast('Reset failed', 'error'); }
    finally { setResetPhase('idle'); }
  };

  const active  = cameras.filter(c => c.is_active);
  const offline = cameras.filter(c => !c.is_active);

  return (
    <div className="cp-root">
      <div className="cp-header">
        <div>
          <h2 className="cp-title">Camera Network</h2>
          <p className="cp-sub">{cameras.length} registered · {active.length} active · {offline.length} offline</p>
        </div>
        <button className="cp-add-btn" onClick={() => { setEditTarget(null); setShowForm(true); }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Add camera
        </button>
      </div>

      {/* Stats */}
      <div className="cp-stats">
        {[
          { label:'Total',      val: cameras.length,                          color:'var(--text-primary)' },
          { label:'Active',     val: active.length,                           color:'var(--green)' },
          { label:'Offline',    val: offline.length,                          color:'var(--amber)' },
          { label:'AI enabled', val: cameras.filter(c=>c.is_ai).length,      color:'var(--accent)' },
        ].map(s => (
          <div key={s.label} className="cp-stat glass-panel">
            <div className="cp-stat-val" style={{ color:s.color }}>{s.val}</div>
            <div className="cp-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* List */}
      <div className="cp-list">
        {loading && (
          <div className="cp-empty"><div className="cp-spinner" /><span>Loading cameras…</span></div>
        )}
        {!loading && cameras.length === 0 && (
          <div className="cp-empty">
            <p>No cameras registered yet.</p>
            <button className="cp-add-btn" onClick={() => setShowForm(true)}>Register first camera</button>
          </div>
        )}

        {active.length > 0 && (
          <div className="cp-section">
            <div className="cp-section-label">Active nodes</div>
            {active.map(cam => (
              <CameraRow key={cam.id} cam={cam}
                onEdit={c => { setEditTarget(c); setShowForm(true); }}
                onToggle={handleToggle} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {offline.length > 0 && (
          <div className="cp-section">
            <div className="cp-section-label">Offline / decommissioned</div>
            {offline.map(cam => (
              <CameraRow key={cam.id} cam={cam}
                onEdit={c => { setEditTarget(c); setShowForm(true); }}
                onToggle={handleToggle} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <CameraForm
          initial={editTarget}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditTarget(null); }}
          isSaving={isSaving}
        />
      )}

      {/* Danger zone */}
      <div className="cp-danger-zone">
        <div className="cp-danger-info">
          <span className="cp-danger-title">Danger Zone</span>
          <span className="cp-danger-sub">Permanently deletes all cameras, incidents and audit logs from the database.</span>
        </div>
        {resetPhase === 'idle' && (
          <button className="cp-danger-btn" onClick={() => setResetPhase('confirm')}>
            Clear Database
          </button>
        )}
        {resetPhase === 'confirm' && (
          <div className="cp-danger-confirm">
            <span>This cannot be undone. Proceed?</span>
            <button className="cp-danger-yes" onClick={handleReset}>Yes, wipe it</button>
            <button className="cp-danger-no"  onClick={() => setResetPhase('idle')}>Cancel</button>
          </div>
        )}
        {resetPhase === 'clearing' && (
          <span className="cp-danger-working">Clearing…</span>
        )}
      </div>

      {toast && (
        <div className={`cp-toast toast-${toast.type}`}>
          {toast.type==='success' ? '✓' : '!'} {toast.msg}
        </div>
      )}
    </div>
  );
}

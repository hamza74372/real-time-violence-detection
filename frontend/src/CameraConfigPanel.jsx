import React, { useState, useEffect, useCallback } from 'react';
import './CameraConfigPanel.css';

const API_BASE = 'http://127.0.0.1:8000/api';
const ZONES    = ['ZONE-A', 'ZONE-B', 'ZONE-C', 'ZONE-D', 'ZONE-E', 'ZONE-F'];
const EMPTY    = { name:'', location:'', zone:'ZONE-A', rtsp_url:'', is_active:true, is_ai:false };

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

// ── Camera form modal ──────────────────────────────────────────────────────────
function CameraForm({ initial, onSave, onCancel, isSaving }) {
  const [form,       setForm]       = useState(initial || EMPTY);
  const [connResult, setConnResult] = useState(null);
  const [errors,     setErrors]     = useState({});

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
      const res = await fetch(`${API_BASE}/cameras/test-rtsp`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url: form.rtsp_url }),
      });
      setConnResult(await res.json());
    } catch {
      setConnResult({ reachable:false, latency_ms:null, error:'API unreachable' });
    }
  };

  return (
    <div className="cp-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="cp-modal">
        <div className="cp-modal-header">
          <span className="cp-modal-title">{initial?.id ? 'Edit camera' : 'Register new camera'}</span>
          <button className="cp-close" onClick={onCancel}>✕</button>
        </div>

        <div className="cp-modal-body">
          {/* Name + Zone */}
          <div className="cp-row-2">
            <div className="cp-field">
              <label className="cp-label">Camera name <span className="cp-req">*</span></label>
              <input className={`cp-input ${errors.name ? 'cp-input-err':''}`}
                placeholder="e.g. CAM-05" value={form.name}
                onChange={e => set('name', e.target.value)} />
              {errors.name && <span className="cp-err">{errors.name}</span>}
            </div>
            <div className="cp-field">
              <label className="cp-label">Zone</label>
              <select className="cp-select" value={form.zone} onChange={e => set('zone', e.target.value)}>
                {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
          </div>

          {/* Location */}
          <div className="cp-field">
            <label className="cp-label">Physical location <span className="cp-req">*</span></label>
            <input className={`cp-input ${errors.location ? 'cp-input-err':''}`}
              placeholder="e.g. North Gate / Parking Level 2" value={form.location}
              onChange={e => set('location', e.target.value)} />
            {errors.location && <span className="cp-err">{errors.location}</span>}
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

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  const loadCameras = useCallback(async () => {
    try {
      const data = await fetch(`${API_BASE}/cameras`).then(r => r.json());
      setCameras(data);
      onCamerasChange?.(data);
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
      await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
      await loadCameras();
      setShowForm(false); setEditTarget(null);
      showToast(isEdit ? 'Camera updated' : 'Camera registered');
    } catch { showToast('Save failed', 'error'); }
    finally  { setIsSaving(false); }
  };

  const handleToggle = async (cam) => {
    try {
      await fetch(`${API_BASE}/cameras/${cam.id}`, {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ is_active: !cam.is_active }),
      });
      setCameras(prev => prev.map(c => c.id===cam.id ? {...c, is_active:!cam.is_active} : c));
      showToast(`${cam.name} ${cam.is_active ? 'deactivated':'activated'}`);
    } catch { showToast('Update failed', 'error'); }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`${API_BASE}/cameras/${id}`, { method:'DELETE' });
      await loadCameras();
      showToast('Camera decommissioned');
    } catch { showToast('Delete failed', 'error'); }
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

      {toast && (
        <div className={`cp-toast toast-${toast.type}`}>
          {toast.type==='success' ? '✓' : '!'} {toast.msg}
        </div>
      )}
    </div>
  );
}

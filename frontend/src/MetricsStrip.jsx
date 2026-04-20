import React, { useState, useEffect, useRef } from 'react';
import './MetricsStrip.css';

const API_BASE = "http://127.0.0.1:8000/api";

// ── Uptime formatter ──────────────────────────────────────────────────────────
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Latency colour: green < 50ms, amber < 120ms, red >= 120ms ────────────────
function latencyColor(ms) {
  if (ms === 0)   return 'var(--m-muted)';
  if (ms < 50)    return 'var(--m-green)';
  if (ms < 120)   return 'var(--m-amber)';
  return 'var(--m-red)';
}

// ── FP rate colour: green < 15%, amber < 35%, red >= 35% ─────────────────────
function fpColor(fp) {
  if (fp < 15)  return 'var(--m-green)';
  if (fp < 35)  return 'var(--m-amber)';
  return 'var(--m-red)';
}

// ── Tiny sparkline (pure SVG, no deps) ───────────────────────────────────────
function Sparkline({ data, color = '#0284c7', width = 64, height = 22 }) {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} />;
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Single metric tile ────────────────────────────────────────────────────────
function MetricTile({ label, value, unit, subtext, valueColor, spark, sparkColor, status, wide }) {
  return (
    <div className={`metric-tile ${wide ? 'tile-wide' : ''}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value-row">
        <span className="tile-value" style={{ color: valueColor || 'var(--m-text)' }}>
          {value}
        </span>
        {unit && <span className="tile-unit">{unit}</span>}
        {status && <span className={`tile-status-dot dot-${status}`} />}
      </div>
      {spark && spark.length > 1 && (
        <div className="tile-spark">
          <Sparkline data={spark} color={sparkColor || '#0284c7'} />
        </div>
      )}
      {subtext && <div className="tile-sub">{subtext}</div>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MetricsStrip({ alarmsArmed }) {
  const [metrics, setMetrics]       = useState(null);
  const [latHistory, setLatHistory] = useState([]);
  const [fpHistory,  setFpHistory]  = useState([]);
  const [detHistory, setDetHistory] = useState([]);
  const [connErr,    setConnErr]    = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!alarmsArmed) return;

    const poll = async () => {
      try {
        const data = await fetch(`${API_BASE}/metrics`).then(r => r.json());
        setMetrics(data);
        setConnErr(false);
        setLatHistory(h => [...h.slice(-29), data.avg_latency_ms]);
        setFpHistory( h => [...h.slice(-29), data.fp_rate]);
        setDetHistory(h => [...h.slice(-29), data.detections_per_min]);
      } catch {
        setConnErr(true);
      }
    };

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollRef.current);
  }, [alarmsArmed]);

  // ── Not armed yet ───────────────────────────────────────────────────────────
  if (!alarmsArmed) {
    return (
      <div className="metrics-strip metrics-offline">
        <span className="metrics-offline-label">METRICS OFFLINE — ARM NETWORK TO BEGIN</span>
      </div>
    );
  }

  // ── Connection error ────────────────────────────────────────────────────────
  if (connErr || !metrics) {
    return (
      <div className="metrics-strip metrics-error">
        <span className="metrics-err-dot" />
        <span className="metrics-offline-label">
          {connErr ? 'METRICS API UNREACHABLE' : 'LOADING METRICS…'}
        </span>
      </div>
    );
  }

  const {
    avg_latency_ms, p95_latency_ms,
    fp_rate, precision,
    detections_per_min, incidents_today,
    uptime_seconds, active_cameras, total_cameras,
    inference_samples,
  } = metrics;

  // Health summary: all green if latency < 50 and fp < 15
  const systemHealth =
    avg_latency_ms === 0        ? 'initialising' :
    avg_latency_ms < 50 && fp_rate < 15  ? 'nominal' :
    avg_latency_ms < 120 && fp_rate < 35 ? 'degraded' : 'critical';

  const healthLabel = { nominal: 'NOMINAL', degraded: 'DEGRADED', critical: 'CRITICAL', initialising: 'INIT' };
  const healthColor = { nominal: 'var(--m-green)', degraded: 'var(--m-amber)', critical: 'var(--m-red)', initialising: 'var(--m-muted)' };

  return (
    <div className={`metrics-strip health-${systemHealth}`}>

      {/* Left anchor: system health pill */}
      <div className="metrics-health-pill">
        <span className={`health-pulse pulse-${systemHealth}`} />
        <span className="health-label" style={{ color: healthColor[systemHealth] }}>
          {healthLabel[systemHealth]}
        </span>
      </div>

      <div className="metrics-divider" />

      {/* Tile: Inference latency */}
      <MetricTile
        label="AVG LATENCY"
        value={avg_latency_ms}
        unit="ms"
        subtext={`p95: ${p95_latency_ms}ms`}
        valueColor={latencyColor(avg_latency_ms)}
        spark={latHistory}
        sparkColor={latencyColor(avg_latency_ms)}
      />

      <div className="metrics-divider" />

      {/* Tile: False positive rate */}
      <MetricTile
        label="FALSE POS RATE"
        value={fp_rate}
        unit="%"
        subtext={`precision: ${precision}%`}
        valueColor={fpColor(fp_rate)}
        spark={fpHistory}
        sparkColor={fpColor(fp_rate)}
      />

      <div className="metrics-divider" />

      {/* Tile: Detections per minute */}
      <MetricTile
        label="DETECTIONS/MIN"
        value={detections_per_min}
        subtext={`today: ${incidents_today}`}
        spark={detHistory}
        sparkColor="#0284c7"
      />

      <div className="metrics-divider" />

      {/* Tile: Camera nodes */}
      <MetricTile
        label="NODES ONLINE"
        value={`${active_cameras}/${total_cameras}`}
        subtext={`${inference_samples} inferences logged`}
        status={active_cameras === total_cameras ? 'green' : 'amber'}
      />

      <div className="metrics-divider" />

      {/* Right anchor: uptime */}
      <div className="metrics-uptime">
        <div className="tile-label">SESSION UPTIME</div>
        <div className="uptime-value">{formatUptime(uptime_seconds)}</div>
      </div>

    </div>
  );
}
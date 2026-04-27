import React, { useEffect, useRef } from 'react';
import './ToastStack.css';

// ── Progress bar (counts down the toast duration) ────────────────────────────
function ProgressBar({ duration }) {
  const barRef = useRef(null);
  useEffect(() => {
    if (!barRef.current || duration <= 0) return;
    const bar = barRef.current;
    bar.style.transition = 'none';
    bar.style.width      = '100%';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bar.style.transition = `width ${duration}ms linear`;
        bar.style.width      = '0%';
      });
    });
  }, [duration]);
  if (duration <= 0) return null;
  return <div className="toast-progress-track"><div ref={barRef} className="toast-progress-bar" /></div>;
}

// ── Single toast card ─────────────────────────────────────────────────────────
function ToastCard({ toast, onDismiss, onViewIncident }) {
  const icons = {
    threat:  (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    warning: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
    success: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    info: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
  };

  const timeStr = toast.timestamp.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  return (
    <div className={`toast-card toast-${toast.type}`} role="alert">

      {/* Left accent bar */}
      <div className="toast-accent-bar" />

      {/* Icon */}
      <div className="toast-icon-wrap">
        {icons[toast.type] || icons.info}
      </div>

      {/* Content */}
      <div className="toast-content">
        <div className="toast-header-row">
          <span className="toast-title">{toast.title}</span>
          <span className="toast-time">{timeStr}</span>
        </div>

        {toast.message && (
          <div className="toast-message">{toast.message}</div>
        )}

        {toast.camera && (
          <div className="toast-meta">
            <span className="toast-cam-badge">{toast.camera}</span>
            {toast.confidence != null && (
              <span className="toast-conf">{Math.round(toast.confidence)}% conf</span>
            )}
          </div>
        )}

        {/* Action row */}
        {(toast.viewIncident || toast.type === 'threat') && (
          <div className="toast-actions">
            {toast.viewIncident && (
              <button
                className="toast-action-btn btn-view"
                onClick={() => onViewIncident?.(toast.viewIncident)}
              >
                View incident
              </button>
            )}
            {toast.type === 'threat' && (
              <button
                className="toast-action-btn btn-ack"
                onClick={() => onDismiss(toast.id)}
              >
                Acknowledge
              </button>
            )}
          </div>
        )}
      </div>

      {/* Dismiss button */}
      <button className="toast-dismiss" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Progress bar */}
      <ProgressBar duration={toast.duration} />
    </div>
  );
}

// ── Toast stack ───────────────────────────────────────────────────────────────
export default function ToastStack({ toasts, onDismiss, onViewIncident }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite" aria-label="Notifications">
      {toasts.map(toast => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          onViewIncident={onViewIncident}
        />
      ))}
    </div>
  );
}

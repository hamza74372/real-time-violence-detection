import { useState, useEffect, useRef, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// useNotifications — manages toast stack + browser push notifications
//
// Usage in App.jsx:
//   const { toasts, dismissToast, requestPushPermission, pushEnabled } =
//     useNotifications({ isViolent, confidence, systemStatus, incidents, alarmsArmed });
// ─────────────────────────────────────────────────────────────────────────────

let toastIdCounter = 0;

export function useNotifications({
  isViolent,
  confidence,
  systemStatus,
  incidents,
  alarmsArmed,
}) {
  const [toasts,      setToasts]      = useState([]);
  const [pushEnabled, setPushEnabled] = useState(false);

  // Track what we've already notified about to avoid repeats
  const lastViolentRef      = useRef(false);
  const lastIncidentCountRef = useRef(0);
  const pushPermissionRef   = useRef(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  // ── Add a toast ────────────────────────────────────────────────────────────
  const addToast = useCallback((toast) => {
    const id = ++toastIdCounter;
    const entry = {
      id,
      type:       toast.type     || 'info',     // 'threat' | 'warning' | 'success' | 'info'
      title:      toast.title    || '',
      message:    toast.message  || '',
      camera:     toast.camera   || null,
      confidence: toast.confidence != null ? toast.confidence : null,
      duration:   toast.duration || 8000,
      timestamp:  new Date(),
      viewIncident: toast.viewIncident || null,
    };
    setToasts(prev => [entry, ...prev].slice(0, 5)); // max 5 toasts visible

    // Auto-dismiss
    if (entry.duration > 0) {
      setTimeout(() => dismissToast(id), entry.duration);
    }

    return id;
  }, []); // eslint-disable-line

  // ── Dismiss a toast ────────────────────────────────────────────────────────
  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Browser push notification ──────────────────────────────────────────────
  const sendPushNotification = useCallback((title, body, tag) => {
    if (pushPermissionRef.current !== 'granted') return;
    try {
      const n = new Notification(title, {
        body,
        tag:    tag || 'cityshield-alert',
        icon:   '/favicon.svg',
        badge:  '/favicon.svg',
        requireInteraction: true,  // stays until user dismisses
      });
      // Clicking the push notification focuses the tab
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) {
      console.warn('Push notification failed:', e);
    }
  }, []);

  // ── Request push permission (call on ARM) ──────────────────────────────────
  const requestPushPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') {
      pushPermissionRef.current = 'granted';
      setPushEnabled(true);
      return true;
    }
    if (Notification.permission === 'denied') return false;

    try {
      const result = await Notification.requestPermission();
      pushPermissionRef.current = result;
      const granted = result === 'granted';
      setPushEnabled(granted);
      return granted;
    } catch {
      return false;
    }
  }, []);

  // ── React to violence state changes ───────────────────────────────────────
  useEffect(() => {
    if (!alarmsArmed) return;

    const wasViolent = lastViolentRef.current;

    // Violence STARTED
    if (isViolent && !wasViolent) {
      const confPct = confidence != null ? `${Math.round(confidence)}% confidence` : '';
      addToast({
        type:       'threat',
        title:      'Violence Detected',
        message:    confPct,
        camera:     'CAM-01 · Main St',
        confidence,
        duration:   0,          // stays until manually dismissed
      });
      sendPushNotification(
        '⚠ THREAT DETECTED — CityShield AI',
        `Physical altercation detected on CAM-01 · Main St. ${confPct}`,
        'violence-alert'
      );
    }

    // Violence CLEARED
    if (!isViolent && wasViolent) {
      addToast({
        type:    'success',
        title:   'Threat Cleared',
        message: 'CAM-01 returned to normal activity',
        duration: 5000,
      });
      // Dismiss any open threat toasts
      setToasts(prev => prev.filter(t => t.type !== 'threat'));
    }

    lastViolentRef.current = isViolent;
  }, [isViolent, alarmsArmed]); // eslint-disable-line

  // ── React to new incidents in DB ───────────────────────────────────────────
  useEffect(() => {
    if (!alarmsArmed || !incidents?.length) return;

    const unreviewed = incidents.filter(
      i => !i.review_status || i.review_status === 'UNREVIEWED'
    );
    const prevCount = lastIncidentCountRef.current;
    const newCount  = incidents.length;

    // A new incident was added since last poll
    if (newCount > prevCount && prevCount > 0) {
      const newest = incidents[0];
      addToast({
        type:         'warning',
        title:        'New Incident Logged',
        message:      newest.description || 'Physical altercation detected',
        camera:       newest.camera || 'CAM-01',
        confidence:   newest.confidence,
        duration:     8000,
        viewIncident: newest.id,
      });
    }

    // Badge reminder when unreviewed pile grows
    if (unreviewed.length > 0 && unreviewed.length % 3 === 0 && newCount > prevCount) {
      addToast({
        type:    'info',
        title:   `${unreviewed.length} incidents awaiting review`,
        message: 'Open the Triage panel to action them',
        duration: 6000,
      });
    }

    lastIncidentCountRef.current = newCount;
  }, [incidents?.length, alarmsArmed]); // eslint-disable-line

  // ── System armed toast ─────────────────────────────────────────────────────
  useEffect(() => {
    if (alarmsArmed) {
      addToast({
        type:    'success',
        title:   'Network Armed',
        message: 'All nodes online · AI inference active',
        duration: 4000,
      });
    }
  }, [alarmsArmed]); // eslint-disable-line

  return {
    toasts,
    dismissToast,
    addToast,
    pushEnabled,
    requestPushPermission,
  };
}

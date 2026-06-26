"""
CityShield AI — Metrics & Config Routes
GET /metrics requires auth. POST /config/threshold requires admin.
"""
import time

from fastapi import APIRouter, Depends

from database import get_db
from ai_engine.inference import system_start_time, inference_times
from middleware.auth import verify_firebase_token, require_admin

router = APIRouter(prefix="/api", tags=["metrics"])


@router.get("/metrics")
async def get_metrics(user=Depends(verify_firebase_token)):
    uptime_seconds = int(time.time() - system_start_time)
    avg_latency_ms = round(sum(inference_times) / len(inference_times), 1) if inference_times else 0.0
    p95_latency_ms = round(sorted(inference_times)[int(len(inference_times) * 0.95)], 1) if len(inference_times) > 1 else 0.0

    conn            = get_db()
    row             = conn.execute(
        """SELECT
             SUM(CASE WHEN review_status='CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
             SUM(CASE WHEN review_status='DISMISSED' THEN 1 ELSE 0 END) AS dismissed
           FROM incidents"""
    ).fetchone()
    det_row         = conn.execute(
        "SELECT COUNT(*) AS cnt FROM incidents WHERE timestamp >= datetime('now', '-60 seconds')"
    ).fetchone()
    incidents_today = conn.execute(
        "SELECT COUNT(*) AS cnt FROM incidents WHERE DATE(timestamp) = DATE('now')"
    ).fetchone()
    cam_counts = conn.execute(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) AS active FROM cameras"
    ).fetchone()
    conn.close()

    confirmed = row["confirmed"] or 0
    dismissed = row["dismissed"] or 0
    reviewed  = confirmed + dismissed

    return {
        "avg_latency_ms":     avg_latency_ms,
        "p95_latency_ms":     p95_latency_ms,
        "fp_rate":            round((dismissed / reviewed) * 100, 1) if reviewed > 0 else 0.0,
        "precision":          round((confirmed / reviewed) * 100, 1) if reviewed > 0 else 0.0,
        "detections_per_min": det_row["cnt"] or 0,
        "incidents_today":    incidents_today["cnt"] or 0,
        "uptime_seconds":     uptime_seconds,
        "active_cameras":     int(cam_counts["active"] or 0),
        "total_cameras":      int(cam_counts["total"] or 0),
        "inference_samples":  len(inference_times),
    }


@router.post("/config/threshold")
async def set_threshold(body: dict, user=Depends(require_admin)):
    return {"threshold": body.get("threshold", 0.6), "accepted": True}

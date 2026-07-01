"""
CityShield AI — Metrics & Config Routes
GET /metrics requires auth. POST /config/threshold requires admin.
"""
import time
from datetime import date, timedelta

from fastapi import APIRouter, Depends

from database import get_db
from ai_engine.inference import system_start_time, inference_times, set_live_threshold, live_confidence_threshold
from middleware.auth import verify_firebase_token

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
        "SELECT COUNT(*) AS cnt FROM incidents WHERE timestamp >= datetime('now', 'localtime', '-60 seconds')"
    ).fetchone()
    incidents_today = conn.execute(
        "SELECT COUNT(*) AS cnt FROM incidents WHERE DATE(timestamp) = DATE('now', 'localtime')"
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
async def set_threshold(body: dict, _user=Depends(verify_firebase_token)):
    val = float(body.get("threshold", live_confidence_threshold))
    set_live_threshold(val)
    return {"threshold": live_confidence_threshold, "accepted": True}


@router.get("/analytics")
async def get_analytics(time_range: str = "30d", _user=Depends(verify_firebase_token)):
    days     = {"7d": 7, "30d": 30, "90d": 90}.get(time_range, 30)
    since    = f"-{days} days"
    conn     = get_db()

    # All datetime comparisons use 'localtime' so they match the locally-stored timestamps
    # reviewed_at arrives from JS as ISO-8601 with Z suffix; strip T and Z for julianday()
    daily_rows = conn.execute("""
        SELECT DATE(timestamp) AS day,
               COUNT(*) AS total,
               SUM(CASE WHEN review_status='CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
               SUM(CASE WHEN review_status='DISMISSED' THEN 1 ELSE 0 END) AS dismissed
        FROM incidents WHERE timestamp >= datetime('now', 'localtime', ?)
        GROUP BY DATE(timestamp) ORDER BY day ASC
    """, (since,)).fetchall()

    hourly_rows = conn.execute("""
        SELECT CAST(strftime('%H', timestamp) AS INTEGER) AS hour, COUNT(*) AS count
        FROM incidents WHERE timestamp >= datetime('now', 'localtime', ?)
        GROUP BY hour ORDER BY hour
    """, (since,)).fetchall()

    camera_rows = conn.execute("""
        SELECT camera_id,
               COUNT(*) AS total,
               SUM(CASE WHEN review_status='CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
               ROUND(AVG(confidence), 3) AS avg_confidence
        FROM incidents WHERE timestamp >= datetime('now', 'localtime', ?)
        GROUP BY camera_id ORDER BY total DESC
    """, (since,)).fetchall()

    conf_rows = conn.execute("""
        SELECT CAST(confidence * 10 AS INTEGER) * 10 AS bucket_start, COUNT(*) AS count
        FROM incidents
        WHERE timestamp >= datetime('now', 'localtime', ?) AND confidence BETWEEN 0.01 AND 0.99
        GROUP BY bucket_start ORDER BY bucket_start
    """, (since,)).fetchall()

    week_rows = conn.execute("""
        SELECT CAST((julianday('now','localtime') - julianday(timestamp)) / 7 AS INTEGER) AS weeks_ago,
               COUNT(*) AS count
        FROM incidents WHERE timestamp >= datetime('now', 'localtime', '-56 days')
        GROUP BY weeks_ago ORDER BY weeks_ago DESC
    """).fetchall()

    summary = conn.execute("""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN review_status='CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
               SUM(CASE WHEN review_status='DISMISSED' THEN 1 ELSE 0 END) AS dismissed,
               ROUND(AVG(confidence), 3) AS avg_conf
        FROM incidents WHERE timestamp >= datetime('now', 'localtime', ?)
    """, (since,)).fetchone()

    this_w  = conn.execute("SELECT COUNT(*) AS c FROM incidents WHERE timestamp >= datetime('now','localtime','-7 days')").fetchone()
    last_w  = conn.execute("SELECT COUNT(*) AS c FROM incidents WHERE timestamp >= datetime('now','localtime','-14 days') AND timestamp < datetime('now','localtime','-7 days')").fetchone()
    # Normalize reviewed_at: strip T and Z suffix so julianday() can parse it
    resp_t  = conn.execute("""
        SELECT AVG((julianday(REPLACE(REPLACE(reviewed_at,'T',' '),'Z','')) - julianday(timestamp)) * 1440) AS avg_min
        FROM incidents WHERE reviewed_at IS NOT NULL AND timestamp >= datetime('now', 'localtime', ?)
    """, (since,)).fetchone()
    conn.close()

    # Fill missing days with zeros
    daily_map  = {r["day"]: {"total": int(r["total"]), "confirmed": int(r["confirmed"] or 0), "dismissed": int(r["dismissed"] or 0)} for r in daily_rows}
    start_date = date.today() - timedelta(days=days)
    all_days, cur = [], start_date
    while cur <= date.today():
        ds = cur.isoformat()
        m  = daily_map.get(ds, {"total": 0, "confirmed": 0, "dismissed": 0})
        all_days.append({"day": ds, **m})
        cur += timedelta(days=1)

    # Fill missing hours with zeros
    hourly_map  = {r["hour"]: r["count"] for r in hourly_rows}
    hourly_full = [{"hour": h, "count": hourly_map.get(h, 0)} for h in range(24)]

    # Build weekly list oldest→newest, 8 weeks
    week_map = {r["weeks_ago"]: int(r["count"]) for r in week_rows}
    weekly   = [{"label": f"W-{wa}", "count": week_map.get(wa, 0)} for wa in range(7, -1, -1)]

    tw = int(this_w["c"] or 0)
    lw = int(last_w["c"] or 0)
    wc = round(((tw - lw) / max(lw, 1)) * 100, 1)

    return {
        "daily":        all_days,
        "hourly":       hourly_full,
        "cameras":      [dict(r) for r in camera_rows],
        "conf_buckets": [{"bucket": f"{r['bucket_start']}-{r['bucket_start']+10}", "bucket_start": int(r["bucket_start"]), "count": int(r["count"])} for r in conf_rows],
        "weekly":       weekly,
        "summary": {
            "total":              int(summary["total"]     or 0),
            "confirmed":          int(summary["confirmed"] or 0),
            "dismissed":          int(summary["dismissed"] or 0),
            "avg_confidence":     round(float(summary["avg_conf"] or 0) * 100, 1),
            "this_week":          tw,
            "last_week":          lw,
            "week_change_pct":    wc,
            "avg_response_min":   round(float(resp_t["avg_min"] or 0), 1),
        },
    }

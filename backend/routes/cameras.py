"""
CityShield AI — Camera Routes
GET requires auth. POST/PATCH/DELETE require admin.
Includes SQL injection fix via column whitelist.
"""
import re
import time
import socket
import urllib.request
import urllib.error

from fastapi import APIRouter, Depends, HTTPException

from database import get_db, log_audit
from models.schemas import CameraCreate, CameraUpdate
from middleware.auth import verify_firebase_token, require_admin

router = APIRouter(prefix="/api", tags=["cameras"])

# ── SQL injection prevention — only these columns may be updated ─────────────
ALLOWED_CAMERA_FIELDS = {"name", "location", "zone", "rtsp_url", "is_active", "is_ai", "latitude", "longitude"}


# ── HELPER — RTSP / HTTP CONNECTIVITY TEST ───────────────────────────────────
def test_rtsp_connection(url: str) -> dict:
    url = url.strip()
    if url.startswith("http"):
        try:
            t0  = time.perf_counter()
            req = urllib.request.Request(url, method="HEAD")
            urllib.request.urlopen(req, timeout=3)
            return {"reachable": True, "latency_ms": round((time.perf_counter() - t0) * 1000, 1), "error": None}
        except Exception as e:
            return {"reachable": False, "latency_ms": None, "error": str(e)[:120]}

    match = re.match(r"rtsp://([^/:@]+(?::[^/@]+)?@)?([^/:]+)(?::(\d+))?", url)
    if not match:
        return {"reachable": False, "latency_ms": None, "error": "Invalid RTSP URL format"}
    host = match.group(2)
    port = int(match.group(3)) if match.group(3) else 554
    try:
        t0   = time.perf_counter()
        sock = socket.create_connection((host, port), timeout=3)
        latency = round((time.perf_counter() - t0) * 1000, 1)
        sock.close()
        return {"reachable": True, "latency_ms": latency, "error": None}
    except Exception as e:
        return {"reachable": False, "latency_ms": None, "error": str(e)[:120]}


@router.get("/cameras")
async def list_cameras(user=Depends(verify_firebase_token)):
    conn = get_db()
    rows = conn.execute("SELECT * FROM cameras ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/cameras", status_code=201)
async def create_camera(cam: CameraCreate, user=Depends(require_admin)):
    conn   = get_db()
    cursor = conn.execute(
        "INSERT INTO cameras (name, location, zone, rtsp_url, is_active, is_ai, latitude, longitude) VALUES (?,?,?,?,?,?,?,?)",
        (cam.name, cam.location, cam.zone, cam.rtsp_url, int(cam.is_active), int(cam.is_ai), cam.latitude or 0.0, cam.longitude or 0.0)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM cameras WHERE id=?", (cursor.lastrowid,)).fetchone()
    conn.close()
    log_audit(user.get("email", "unknown"), "CAMERA_ADDED",
              f"Camera '{cam.name}' registered at {cam.location} ({cam.zone})")
    return dict(row)


@router.patch("/cameras/{camera_id}")
async def update_camera(camera_id: int, update: CameraUpdate, user=Depends(require_admin)):
    conn = get_db()
    row  = conn.execute("SELECT * FROM cameras WHERE id=?", (camera_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Camera not found")
    # Filter to allowed fields only — prevents SQL injection via column names
    fields = {k: v for k, v in update.dict().items() if v is not None and k in ALLOWED_CAMERA_FIELDS}
    if fields:
        set_clause = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE cameras SET {set_clause} WHERE id=?", (*fields.values(), camera_id))
        conn.commit()
    updated = conn.execute("SELECT * FROM cameras WHERE id=?", (camera_id,)).fetchone()
    conn.close()
    log_audit(user.get("email", "unknown"), "CAMERA_UPDATED",
              f"Camera #{camera_id} updated — fields: {', '.join(fields.keys()) if fields else 'none'}")
    return dict(updated)


@router.delete("/cameras/{camera_id}", status_code=204)
async def delete_camera(camera_id: int, user=Depends(require_admin)):
    conn = get_db()
    cam  = conn.execute("SELECT name FROM cameras WHERE id=?", (camera_id,)).fetchone()
    conn.execute("UPDATE cameras SET is_active=0 WHERE id=?", (camera_id,))
    conn.commit()
    conn.close()
    log_audit(user.get("email", "unknown"), "CAMERA_DELETED",
              f"Camera #{camera_id} ({cam['name'] if cam else '?'}) decommissioned")


@router.post("/cameras/test-rtsp")
async def test_camera_url(body: dict, user=Depends(verify_firebase_token)):
    url = body.get("url", "").strip()
    if not url:
        return {"reachable": False, "latency_ms": None, "error": "No URL provided"}
    return test_rtsp_connection(url)


@router.delete("/admin/reset-database", status_code=200)
async def reset_database(user=Depends(require_admin)):
    """Wipe all cameras, incidents, and audit logs. Irreversible."""
    conn = get_db()
    conn.execute("DELETE FROM system_audit_logs")
    conn.execute("DELETE FROM incidents")
    conn.execute("DELETE FROM cameras")
    conn.commit()
    conn.close()
    log_audit(user.get("email", "unknown"), "SYSTEM_RESET",
              "Full database reset — all cameras, incidents, and audit logs cleared")
    return {"cleared": True, "message": "Database reset successfully"}


@router.delete("/admin/clear-incidents", status_code=200)
async def clear_incidents(user=Depends(require_admin)):
    """Delete all recorded incidents and their audit trail. Cameras are untouched."""
    conn = get_db()
    conn.execute("DELETE FROM incidents")
    conn.execute("DELETE FROM system_audit_logs WHERE action_type LIKE 'INCIDENT_%'")
    conn.commit()
    conn.close()
    log_audit(user.get("email", "unknown"), "SYSTEM_RESET",
              "All incidents cleared by admin")
    return {"cleared": True}

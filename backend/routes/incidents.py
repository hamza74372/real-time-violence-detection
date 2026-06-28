"""
CityShield AI — Incident Routes
All endpoints require Firebase authentication.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime

from database import get_db, log_audit
from models.schemas import IncidentStatusUpdate
from middleware.auth import verify_firebase_token
from utils.email_alert import send_dispatch_alert

router = APIRouter(prefix="/api", tags=["incidents"])


@router.get("/admin/test-email")
async def test_email(user=Depends(verify_firebase_token)):
    """Send a test email immediately and return the result."""
    result = send_dispatch_alert({
        "id": 0,
        "camera_id": "CAM-01",
        "description": "Test alert — email integration check",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "confidence": 0.92,
        "snapshot_path": "",
        "reviewed_by": user.get("email", "admin"),
    })
    return {"email_sent": result}


@router.get("/incidents")
async def get_incidents(user=Depends(verify_firebase_token)):
    conn = get_db()
    rows = conn.execute(
        """SELECT id, timestamp, camera_id, description,
                  review_status, reviewed_by, reviewed_at, confidence,
                  snapshot_path, video_path
           FROM incidents ORDER BY id DESC LIMIT 50"""
    ).fetchall()
    conn.close()
    return [
        {
            "id":            r["id"],
            "timestamp":     r["timestamp"],
            "camera":        r["camera_id"],
            "description":   r["description"],
            "review_status": r["review_status"] or "UNREVIEWED",
            "reviewed_by":   r["reviewed_by"],
            "reviewed_at":   r["reviewed_at"],
            "confidence":    round((r["confidence"] or 0) * 100),
            "snapshot_path": r["snapshot_path"],
            "video_path":    r["video_path"],
        }
        for r in rows
    ]


@router.patch("/incidents/{incident_id}/status")
async def update_incident_status(incident_id: int, body: IncidentStatusUpdate, user=Depends(verify_firebase_token)):
    conn = get_db()
    row  = conn.execute("SELECT id FROM incidents WHERE id=?", (incident_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Incident not found")
    reviewed_at = body.reviewed_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "UPDATE incidents SET review_status=?, reviewed_by=?, reviewed_at=? WHERE id=?",
        (body.status, body.reviewed_by, reviewed_at, incident_id)
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
    conn.close()

    actor = user.get("email", "unknown")
    log_audit(actor, f"INCIDENT_{body.status}",
              f"Incident #{incident_id} marked {body.status} by {body.reviewed_by or actor}")

    email_sent = False
    if body.status == "DISPATCHED":
        email_sent = send_dispatch_alert(dict(updated))

    result = dict(updated)
    result["email_sent"] = email_sent
    return result

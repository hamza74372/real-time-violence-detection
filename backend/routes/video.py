"""
CityShield AI — Video Feed Routes
Public endpoints (no auth) — browser <img> tags cannot send Authorization headers.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from database import get_db
from ai_engine.inference import generate_frames_for_camera, camera_states, global_system_status, global_confidence

router = APIRouter(prefix="/api", tags=["video"])


@router.get("/video_feed")
async def video_feed():
    """Legacy endpoint — always streams CAM-01 (webcam)."""
    return StreamingResponse(
        generate_frames_for_camera(1, 0),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


@router.get("/video_feed/{cam_id}")
async def video_feed_by_id(cam_id: int):
    """Per-camera stream endpoint. AI inference runs on is_ai cameras."""
    conn = get_db()
    cam = conn.execute("SELECT * FROM cameras WHERE id=? AND is_active=1", (cam_id,)).fetchone()
    conn.close()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found or inactive")
    source = 0 if cam_id == 1 else cam["rtsp_url"]
    return StreamingResponse(
        generate_frames_for_camera(cam_id, source),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


@router.get("/status")
async def get_status():
    """Returns the most critical status across all active camera streams. Public."""
    from ai_engine.inference import global_system_status, global_confidence, camera_states

    if not camera_states:
        return {"status": global_system_status, "confidence": round(global_confidence, 4)}
    # Surface violence from any camera first
    for state in camera_states.values():
        if "VIOLENCE" in state["status"]:
            return {"status": state["status"], "confidence": round(state["confidence"], 4)}
    # Otherwise return CAM-01 status (or first available)
    state = camera_states.get(1) or next(iter(camera_states.values()))
    return {"status": state["status"], "confidence": round(state["confidence"], 4)}

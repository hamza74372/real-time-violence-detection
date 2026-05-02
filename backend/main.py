import cv2
import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms
import numpy as np
from collections import deque
from ultralytics import YOLO
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import uvicorn
import sqlite3
import time
import re
import os
import socket
import urllib.request
import urllib.error
from datetime import datetime

# ── Firebase Admin ─────────────────────────────────────────────────────────────
import firebase_admin
from firebase_admin import credentials, auth as fb_auth, firestore as fb_firestore

if not firebase_admin._apps:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)

admin_db = fb_firestore.client()

# ─────────────────────────────────────────────────────────────────────────────
# METRICS TRACKING
# ─────────────────────────────────────────────────────────────────────────────
system_start_time = time.time()
inference_times   = deque(maxlen=60)

# ─────────────────────────────────────────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────────────────────────────────────────
DB_PATH       = "smart_city.db"

# ─────────────────────────────────────────────────────────────────────────────
# CENTRAL CONFIG — change values here, affects all camera streams
# ─────────────────────────────────────────────────────────────────────────────
YOLO_MODEL_PATH    = 'yolov8n.pt'
WEIGHTS_PATH       = 'ai_engine/weights/violence_model_v2_high_acc.pth'
SNAPSHOTS_DIR      = 'snapshots'

# AI detection thresholds
CONFIDENCE_THRESHOLD = 0.75   # raise to 0.80 for fewer false positives
VOTES_NEEDED         = 3      # consecutive hits before alerting (raise for stricter)
SMOOTHING_ALPHA      = 0.3    # 0.3 = smooth display, 0.7 = more responsive
LOG_COOLDOWN         = 10     # seconds between DB writes per camera
INFERENCE_STRIDE     = 5      # run model every N frames (lower = faster response)
SEQUENCE_LEN         = 30     # LSTM frame window length

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    print("Checking Database Integrity...")
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS incidents (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp     TEXT,
            camera_id     TEXT,
            description   TEXT,
            review_status TEXT DEFAULT 'UNREVIEWED',
            reviewed_by   TEXT,
            reviewed_at   TEXT,
            confidence    REAL DEFAULT 0.0
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cameras (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            location   TEXT    NOT NULL,
            zone       TEXT    NOT NULL,
            rtsp_url   TEXT    NOT NULL,
            is_active  INTEGER NOT NULL DEFAULT 1,
            is_ai      INTEGER NOT NULL DEFAULT 0,
            created_at TEXT    DEFAULT (datetime('now'))
        )
    ''')

    # Seed cameras on first run
    cursor.execute("INSERT OR IGNORE INTO cameras (id,name,location,zone,rtsp_url,is_active,is_ai) VALUES (1,'CAM-01','Main St / Central','ZONE-A','http://127.0.0.1:8000/api/video_feed',1,1)")
    cursor.execute("INSERT OR IGNORE INTO cameras (id,name,location,zone,rtsp_url,is_active,is_ai) VALUES (2,'CAM-02','Subway Entrance','ZONE-B','rtsp://placeholder/cam2',1,0)")
    cursor.execute("INSERT OR IGNORE INTO cameras (id,name,location,zone,rtsp_url,is_active,is_ai) VALUES (3,'CAM-03','Riverside Park','ZONE-C','rtsp://placeholder/cam3',0,0)")
    cursor.execute("INSERT OR IGNORE INTO cameras (id,name,location,zone,rtsp_url,is_active,is_ai) VALUES (4,'CAM-04','Financial District','ZONE-D','rtsp://placeholder/cam4',1,0)")

    # Safe migrations for existing databases
    for col_sql in [
        "ALTER TABLE incidents ADD COLUMN review_status TEXT DEFAULT 'UNREVIEWED'",
        "ALTER TABLE incidents ADD COLUMN reviewed_by TEXT",
        "ALTER TABLE incidents ADD COLUMN reviewed_at TEXT",
        "ALTER TABLE incidents ADD COLUMN confidence REAL DEFAULT 0.0",
        "ALTER TABLE incidents ADD COLUMN snapshot_path TEXT",
    ]:
        try:
            cursor.execute(col_sql)
        except Exception:
            pass

    conn.commit()
    conn.close()

    # ── Performance indexes ─────────────────────────────────────────────────────
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_incidents_timestamp ON incidents(timestamp DESC)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_incidents_camera_id ON incidents(camera_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_incidents_status    ON incidents(review_status)")
    conn.commit()
    conn.close()
    print("Database OK.")


init_db()

os.makedirs(SNAPSHOTS_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# FASTAPI SETUP
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Smart City AI Video API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://127.0.0.1:5173",  # alternative local address
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

# Serve snapshot evidence images at /snapshots/<filename>
app.mount("/snapshots", StaticFiles(directory=SNAPSHOTS_DIR), name="snapshots")

# ─────────────────────────────────────────────────────────────────────────────
# AI MODEL ARCHITECTURE
# ─────────────────────────────────────────────────────────────────────────────
class ViolenceClassifier(nn.Module):
    def __init__(self, hidden_size=256, num_layers=2, num_classes=2):
        super(ViolenceClassifier, self).__init__()
        mobilenet = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.DEFAULT)
        self.cnn  = nn.Sequential(*list(mobilenet.children())[:-1])
        self.lstm = nn.LSTM(
            input_size=1280, hidden_size=hidden_size,
            num_layers=num_layers, batch_first=True,
            bidirectional=True, dropout=0.5
        )
        self.dropout = nn.Dropout(0.5)
        self.fc      = nn.Linear(hidden_size * 2, num_classes)

    def forward(self, x):
        batch_size, seq_length, c, h, w = x.size()
        x        = x.view(batch_size * seq_length, c, h, w)
        c_out    = self.cnn(x).mean([2, 3])
        r_in     = c_out.view(batch_size, seq_length, -1)
        lstm_out, _ = self.lstm(r_in)
        final    = self.dropout(lstm_out[:, -1, :])
        return self.fc(final)

# ─────────────────────────────────────────────────────────────────────────────
# LOAD AI MODELS
# ─────────────────────────────────────────────────────────────────────────────
print("Loading AI Models... Please wait.")
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

yolo_model   = YOLO(YOLO_MODEL_PATH)
action_model = ViolenceClassifier().to(device)

try:
    action_model.load_state_dict(torch.load(WEIGHTS_PATH, map_location=device))
    print("Model weights loaded successfully.")
except FileNotFoundError:
    print("Warning: Weights not found. Running with uninitialized weights for UI testing.")

action_model.eval()

transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])
print("AI Core Online.")

# Shared state between video thread and API routes
global_system_status = "Waiting for time buffer..."
global_confidence    = 0.0

# Per-camera AI state — populated as each stream opens
# {cam_id: {"status": str, "confidence": float}}
camera_states: dict = {}

# ─────────────────────────────────────────────────────────────────────────────
# AI VIDEO GENERATOR — works for any camera source
# source: 0 = laptop webcam, or an http:// URL string for IP cameras
# ─────────────────────────────────────────────────────────────────────────────
def generate_frames_for_camera(cam_id: int, source):
    global global_system_status, global_confidence, camera_states

    camera_states[cam_id] = {"status": "Waiting for time buffer...", "confidence": 0.0}
    cam_label = f"CAM-{cam_id:02d}"

    cap             = cv2.VideoCapture(source)
    sequence_buffer = deque(maxlen=SEQUENCE_LEN)
    box_color       = (0, 255, 0)

    frame_count    = 0
    last_log_time  = 0
    violence_votes = 0
    smoothed_conf  = 0.0

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            break

        frame_count    += 1
        results         = yolo_model(frame, classes=[0], verbose=False)
        annotated_frame = frame.copy()

        if len(results[0].boxes) > 0:
            box = results[0].boxes[0].xyxy[0].cpu().numpy()
            x1, y1, x2, y2 = map(int, box)
            y1, y2 = max(0, y1), min(frame.shape[0], y2)
            x1, x2 = max(0, x1), min(frame.shape[1], x2)

            if y2 > y1 and x2 > x1:
                if frame_count % 1 == 0:
                    cropped_human = frame[y1:y2, x1:x2]
                    resized_crop  = cv2.resize(cropped_human, (224, 224))
                    rgb_frame     = cv2.cvtColor(resized_crop, cv2.COLOR_BGR2RGB)
                    sequence_buffer.append(transform(rgb_frame))

                if len(sequence_buffer) == SEQUENCE_LEN and frame_count % INFERENCE_STRIDE == 0:
                    input_tensor = torch.stack(list(sequence_buffer)).unsqueeze(0).to(device)

                    t0 = time.perf_counter()
                    with torch.no_grad():
                        output    = action_model(input_tensor)
                        probs     = torch.nn.functional.softmax(output.data, dim=1)
                        _, pred   = torch.max(probs, 1)
                        label_idx = pred.item()
                        raw_conf  = float(probs[0][1].item())

                    inference_times.append((time.perf_counter() - t0) * 1000)

                    smoothed_conf = SMOOTHING_ALPHA * raw_conf + (1 - SMOOTHING_ALPHA) * smoothed_conf
                    camera_states[cam_id]["confidence"] = smoothed_conf
                    # Keep legacy globals updated for CAM-01
                    if cam_id == 1:
                        global_confidence = smoothed_conf

                    if label_idx == 1 and raw_conf >= CONFIDENCE_THRESHOLD:
                        violence_votes += 1
                    elif label_idx == 1 and raw_conf >= CONFIDENCE_THRESHOLD * 0.8:
                        violence_votes = max(violence_votes, 1)
                    else:
                        violence_votes = 0

                    if violence_votes >= VOTES_NEEDED:
                        camera_states[cam_id]["status"] = 'VIOLENCE DETECTED!'
                        if cam_id == 1:
                            global_system_status = 'VIOLENCE DETECTED!'
                        box_color = (0, 0, 255)

                        current_time = time.time()
                        if current_time - last_log_time > LOG_COOLDOWN:
                            dt_string = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                            # Save evidence snapshot
                            snap_name = f"{cam_label}_{int(current_time)}.jpg"
                            snap_path = os.path.join(SNAPSHOTS_DIR, snap_name)
                            cv2.imwrite(snap_path, annotated_frame)
                            conn = sqlite3.connect(DB_PATH)
                            conn.execute(
                                "INSERT INTO incidents (timestamp, camera_id, description, confidence, snapshot_path) VALUES (?,?,?,?,?)",
                                (dt_string, cam_label, "Physical Altercation Detected", round(raw_conf, 4), f"/snapshots/{snap_name}")
                            )
                            conn.commit()
                            conn.close()
                            print(f"[{cam_label}] INCIDENT @ {dt_string} | conf={raw_conf:.2f} | snap={snap_name}")
                            last_log_time = current_time

                    elif violence_votes > 0:
                        camera_states[cam_id]["status"] = 'Analysing...'
                        if cam_id == 1:
                            global_system_status = 'Analysing...'
                        box_color = (0, 165, 255)
                    else:
                        camera_states[cam_id]["status"] = 'Normal Activity'
                        if cam_id == 1:
                            global_system_status = 'Normal Activity'
                        box_color = (0, 255, 0)

            conf_text = f"{camera_states[cam_id]['status']} ({smoothed_conf * 100:.0f}%)"
            cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), box_color, 2)
            cv2.putText(annotated_frame, conf_text, (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, box_color, 2)
            if 0 < violence_votes < VOTES_NEEDED:
                cv2.putText(annotated_frame, f"Votes: {violence_votes}/{VOTES_NEEDED}",
                            (x1, y2 + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 165, 255), 1)

        ret, buffer = cv2.imencode('.jpg', annotated_frame)
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')

def generate_ai_frames():
    """Legacy wrapper — streams webcam as CAM-01."""
    yield from generate_frames_for_camera(1, 0)

# ─────────────────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ─────────────────────────────────────────────────────────────────────────────
class IncidentStatusUpdate(BaseModel):
    status:      str
    reviewed_by: Optional[str] = "Operator"
    reviewed_at: Optional[str] = None

class CameraCreate(BaseModel):
    name:      str
    location:  str
    zone:      str
    rtsp_url:  str
    is_active: Optional[bool] = True
    is_ai:     Optional[bool] = False

class CameraUpdate(BaseModel):
    name:      Optional[str]  = None
    location:  Optional[str]  = None
    zone:      Optional[str]  = None
    rtsp_url:  Optional[str]  = None
    is_active: Optional[bool] = None
    is_ai:     Optional[bool] = None

class UserCreate(BaseModel):
    email:     str
    password:  str
    full_name: str
    role:      str  # 'admin' or 'operator'

# ─────────────────────────────────────────────────────────────────────────────
# HELPER — RTSP / HTTP CONNECTIVITY TEST
# ─────────────────────────────────────────────────────────────────────────────
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

# ─────────────────────────────────────────────────────────────────────────────
# ROUTES — VIDEO
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/video_feed")
async def video_feed():
    """Legacy endpoint — always streams CAM-01 (webcam)."""
    return StreamingResponse(
        generate_frames_for_camera(1, 0),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.get("/api/video_feed/{cam_id}")
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

# ─────────────────────────────────────────────────────────────────────────────
# ROUTES — AI STATUS
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/status")
async def get_status():
    """Returns the most critical status across all active camera streams."""
    if not camera_states:
        return {"status": global_system_status, "confidence": round(global_confidence, 4)}
    # Surface violence from any camera first
    for state in camera_states.values():
        if "VIOLENCE" in state["status"]:
            return {"status": state["status"], "confidence": round(state["confidence"], 4)}
    # Otherwise return CAM-01 status (or first available)
    state = camera_states.get(1) or next(iter(camera_states.values()))
    return {"status": state["status"], "confidence": round(state["confidence"], 4)}

# ─────────────────────────────────────────────────────────────────────────────
# ROUTES — INCIDENTS
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/incidents")
async def get_incidents():
    conn = get_db()
    rows = conn.execute(
        """SELECT id, timestamp, camera_id, description,
                  review_status, reviewed_by, reviewed_at, confidence, snapshot_path
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
        }
        for r in rows
    ]

@app.patch("/api/incidents/{incident_id}/status")
async def update_incident_status(incident_id: int, body: IncidentStatusUpdate):
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
    return dict(updated)

# ─────────────────────────────────────────────────────────────────────────────
# ROUTES — METRICS
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/metrics")
async def get_metrics():
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

# ─────────────────────────────────────────────────────────────────────────────
# ROUTES — CAMERAS
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/cameras")
async def list_cameras():
    conn = get_db()
    rows = conn.execute("SELECT * FROM cameras ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/cameras", status_code=201)
async def create_camera(cam: CameraCreate):
    conn   = get_db()
    cursor = conn.execute(
        "INSERT INTO cameras (name, location, zone, rtsp_url, is_active, is_ai) VALUES (?,?,?,?,?,?)",
        (cam.name, cam.location, cam.zone, cam.rtsp_url, int(cam.is_active), int(cam.is_ai))
    )
    conn.commit()
    row = conn.execute("SELECT * FROM cameras WHERE id=?", (cursor.lastrowid,)).fetchone()
    conn.close()
    return dict(row)

@app.patch("/api/cameras/{camera_id}")
async def update_camera(camera_id: int, update: CameraUpdate):
    conn = get_db()
    row  = conn.execute("SELECT * FROM cameras WHERE id=?", (camera_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Camera not found")
    fields = {k: v for k, v in update.dict().items() if v is not None}
    if fields:
        set_clause = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE cameras SET {set_clause} WHERE id=?", (*fields.values(), camera_id))
        conn.commit()
    updated = conn.execute("SELECT * FROM cameras WHERE id=?", (camera_id,)).fetchone()
    conn.close()
    return dict(updated)

@app.delete("/api/cameras/{camera_id}", status_code=204)
async def delete_camera(camera_id: int):
    conn = get_db()
    conn.execute("UPDATE cameras SET is_active=0 WHERE id=?", (camera_id,))
    conn.commit()
    conn.close()

@app.post("/api/cameras/test-rtsp")
async def test_camera_url(body: dict):
    url = body.get("url", "").strip()
    if not url:
        return {"reachable": False, "latency_ms": None, "error": "No URL provided"}
    return test_rtsp_connection(url)

@app.post("/api/config/threshold")
async def set_threshold(body: dict):
    return {"threshold": body.get("threshold", 0.6), "accepted": True}

# ─────────────────────────────────────────────────────────────────────────────
# ROUTES — USER MANAGEMENT (Firebase Admin SDK)
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/users")
async def list_users():
    try:
        docs = admin_db.collection("users").stream()
        return [
            {
                "email":      doc.id,
                "full_name":  doc.to_dict().get("full_name", ""),
                "role":       doc.to_dict().get("role", "operator"),
                "created_at": doc.to_dict().get("created_at", ""),
                "created_by": doc.to_dict().get("created_by", ""),
            }
            for doc in docs
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/users", status_code=201)
async def create_user(body: UserCreate):
    if body.role not in ("admin", "operator"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'operator'")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    try:
        fb_user = fb_auth.create_user(
            email=body.email,
            password=body.password,
            display_name=body.full_name,
        )
        admin_db.collection("users").document(body.email).set({
            "full_name":  body.full_name,
            "role":       body.role,
            "uid":        fb_user.uid,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "created_by": "admin",
        })
        return {
            "uid":       fb_user.uid,
            "email":     body.email,
            "full_name": body.full_name,
            "role":      body.role,
        }
    except fb_auth.EmailAlreadyExistsError:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/users/{email}", status_code=204)
async def delete_user(email: str):
    try:
        admins   = [d for d in admin_db.collection("users").where("role", "==", "admin").stream()]
        doc_ref  = admin_db.collection("users").document(email)
        doc_snap = doc_ref.get()

        if doc_snap.exists and doc_snap.to_dict().get("role") == "admin" and len(admins) <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin account")

        if doc_snap.exists:
            uid = doc_snap.to_dict().get("uid")
            if uid:
                try:
                    fb_auth.delete_user(uid)
                except fb_auth.UserNotFoundError:
                    pass
            doc_ref.delete()
        else:
            try:
                fb_auth.delete_user(fb_auth.get_user_by_email(email).uid)
            except fb_auth.UserNotFoundError:
                raise HTTPException(status_code=404, detail="User not found")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
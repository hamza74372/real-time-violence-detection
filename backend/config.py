"""
CityShield AI — Central Configuration
All tuneable values live here. Override via backend/.env file.
"""
import os
from dotenv import load_dotenv

load_dotenv()  # loads backend/.env if present

# ─────────────────────────────────────────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────────────────────────────────────────
DB_PATH = os.getenv("DB_PATH", "smart_city.db")

# ─────────────────────────────────────────────────────────────────────────────
# AI MODELS
# ─────────────────────────────────────────────────────────────────────────────
YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")
WEIGHTS_PATH    = os.getenv("WEIGHTS_PATH", "ai_engine/weights/violence_model_v2_high_acc.pth")
SNAPSHOTS_DIR   = os.getenv("SNAPSHOTS_DIR", "snapshots")
VIDEOS_DIR      = os.getenv("VIDEOS_DIR", "videos")

# Evidence video recording
VIDEO_BUFFER_SECONDS = int(os.getenv("VIDEO_BUFFER_SECONDS", "5"))
VIDEO_FPS            = int(os.getenv("VIDEO_FPS", "30"))

# AI detection thresholds
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.75"))
VOTES_NEEDED         = int(os.getenv("VOTES_NEEDED", "3"))
SMOOTHING_ALPHA      = float(os.getenv("SMOOTHING_ALPHA", "0.3"))
LOG_COOLDOWN         = int(os.getenv("LOG_COOLDOWN", "10"))
INFERENCE_STRIDE     = int(os.getenv("INFERENCE_STRIDE", "5"))
SEQUENCE_LEN         = int(os.getenv("SEQUENCE_LEN", "30"))

# ─────────────────────────────────────────────────────────────────────────────
# SERVER / CORS
# ─────────────────────────────────────────────────────────────────────────────
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
]

# ─────────────────────────────────────────────────────────────────────────────
# FIREBASE
# ─────────────────────────────────────────────────────────────────────────────
FIREBASE_SERVICE_ACCOUNT = os.getenv("FIREBASE_SERVICE_ACCOUNT", "serviceAccountKey.json")

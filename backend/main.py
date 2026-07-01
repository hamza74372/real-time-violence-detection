"""
CityShield AI — Smart City Surveillance System
Entry point: FastAPI app setup, Firebase init, router registration.
"""
import os
import uvicorn
import firebase_admin
from firebase_admin import credentials, firestore as fb_firestore
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import CORS_ORIGINS, SNAPSHOTS_DIR, VIDEOS_DIR, HOST, PORT, FIREBASE_SERVICE_ACCOUNT
from database import init_db

# ─────────────────────────────────────────────────────────────────────────────
# FIREBASE ADMIN
# ─────────────────────────────────────────────────────────────────────────────
if not firebase_admin._apps:
    cred = credentials.Certificate(FIREBASE_SERVICE_ACCOUNT)
    firebase_admin.initialize_app(cred)

admin_db = fb_firestore.client()

# ─────────────────────────────────────────────────────────────────────────────
# DATABASE INIT
# ─────────────────────────────────────────────────────────────────────────────
init_db()
os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
os.makedirs(VIDEOS_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# FASTAPI APP
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Smart City AI Video API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

# Serve snapshot evidence images at /snapshots/<filename>
app.mount("/snapshots", StaticFiles(directory=SNAPSHOTS_DIR), name="snapshots")

# Serve evidence video clips at /videos/<filename>
app.mount("/videos", StaticFiles(directory=VIDEOS_DIR), name="videos")

# ─────────────────────────────────────────────────────────────────────────────
# REGISTER ROUTERS
# ─────────────────────────────────────────────────────────────────────────────
from routes.video     import router as video_router
from routes.incidents import router as incidents_router
from routes.cameras   import router as cameras_router
from routes.users     import router as users_router
from routes.metrics   import router as metrics_router
from routes.audit     import router as audit_router

app.include_router(video_router)
app.include_router(incidents_router)
app.include_router(cameras_router)
app.include_router(users_router)
app.include_router(metrics_router)
app.include_router(audit_router)

# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
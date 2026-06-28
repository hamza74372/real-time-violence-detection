"""
CityShield AI — Video Frame Generation & Inference Pipeline
Per-camera MJPEG generators with YOLO detection + LSTM violence classification.
Includes evidence video recording: a rolling buffer of raw frames is saved as
an MP4 clip when violence is confirmed.
"""
import cv2
import torch
import sqlite3
import time
import os
import threading
import numpy as np
import requests
from collections import deque
from datetime import datetime
from urllib.parse import urlparse

from config import (
    DB_PATH, SNAPSHOTS_DIR, VIDEOS_DIR, CONFIDENCE_THRESHOLD, VOTES_NEEDED,
    SMOOTHING_ALPHA, LOG_COOLDOWN, INFERENCE_STRIDE, SEQUENCE_LEN,
    VIDEO_BUFFER_SECONDS, VIDEO_FPS,
)
from ai_engine.classifier import yolo_model, action_model, transform, device

# ─────────────────────────────────────────────────────────────────────────────
# METRICS TRACKING
# ─────────────────────────────────────────────────────────────────────────────
system_start_time = time.time()
inference_times   = deque(maxlen=60)

# ─────────────────────────────────────────────────────────────────────────────
# SHARED STATE — used by status endpoint and video generators
# ─────────────────────────────────────────────────────────────────────────────
global_system_status = "Waiting for time buffer..."
global_confidence    = 0.0

# Per-camera AI state — populated as each stream opens
# {cam_id: {"status": str, "confidence": float}}
camera_states: dict = {}


def _save_evidence_video(frames: list, filepath: str, fps: int, size: tuple):
    """Write a list of raw BGR frames to an MP4 file (runs in a background thread)."""
    try:
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        writer = cv2.VideoWriter(filepath, fourcc, fps, size)
        for f in frames:
            writer.write(f)
        writer.release()
        print(f"  ✓ Evidence video saved: {filepath} ({len(frames)} frames)")
    except Exception as e:
        print(f"  ✗ Evidence video failed: {e}")


def _make_error_frame(message: str):
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(frame, "STREAM ERROR", (160, 210), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 200), 2)
    cv2.putText(frame, message[:70],   (30,  270), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)
    return frame


def _iter_http_snapshot(base_url: str):
    """
    Low-latency frame source for IP Webcam and similar apps.
    Polls /shot.jpg instead of streaming /video — always fetches the CURRENT
    frame so there is no buffer buildup regardless of inference speed.
    Automatically reconnects on failure.
    """
    parsed = urlparse(base_url)
    base      = f"{parsed.scheme}://{parsed.netloc}"
    shot_url  = base + '/shot.jpg'
    fail_count = 0

    print(f"[HTTP-SNAP] Starting snapshot poll → {shot_url}")
    while True:
        try:
            resp  = requests.get(shot_url, timeout=(3, 3))
            resp.raise_for_status()
            arr   = np.frombuffer(resp.content, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is not None:
                fail_count = 0
                yield frame
                continue
        except Exception as e:
            fail_count += 1
            if fail_count == 1:
                print(f"[HTTP-SNAP] Error: {e}")
            delay = min(fail_count * 0.5, 5)
            time.sleep(delay)


def _cap_iter(cap):
    """Yield frames from an open cv2.VideoCapture until it fails or closes."""
    failures = 0
    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            failures += 1
            if failures >= 30:
                break
            time.sleep(0.05)
            continue
        failures = 0
        yield frame
    cap.release()


# ─────────────────────────────────────────────────────────────────────────────
# AI VIDEO GENERATOR — works for any camera source
# source: 0 = laptop webcam, http:// for IP cameras, rtsp:// for RTSP cameras
# ─────────────────────────────────────────────────────────────────────────────
def generate_frames_for_camera(cam_id: int, source):
    global global_system_status, global_confidence, camera_states

    camera_states[cam_id] = {"status": "Waiting for time buffer...", "confidence": 0.0}
    cam_label = f"CAM-{cam_id:02d}"

    is_http = isinstance(source, str) and source.startswith("http")

    if is_http:
        frame_iter = _iter_http_snapshot(source)
    else:
        cap = cv2.VideoCapture(source)
        if not cap.isOpened():
            camera_states[cam_id] = {"status": "ERROR: Cannot open stream", "confidence": 0.0}
            print(f"[{cam_label}] ERROR: cv2.VideoCapture failed to open source: {source}")
            err_frame = _make_error_frame(f"Cannot open: {source}")
            ret, buf = cv2.imencode('.jpg', err_frame)
            if ret:
                yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
            return
        frame_iter = iter(_cap_iter(cap))

    sequence_buffer = deque(maxlen=SEQUENCE_LEN)
    box_color       = (0, 255, 0)

    video_buffer_len = VIDEO_BUFFER_SECONDS * VIDEO_FPS
    raw_frame_buffer = deque(maxlen=video_buffer_len)

    frame_count    = 0
    last_log_time  = 0
    violence_votes = 0
    smoothed_conf  = 0.0

    for frame in frame_iter:

        frame_count    += 1
        # Store raw frame for evidence video BEFORE any annotation
        raw_frame_buffer.append(frame.copy())

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
                            ts_int    = int(current_time)

                            # Save evidence snapshot
                            snap_name = f"{cam_label}_{ts_int}.jpg"
                            snap_path = os.path.join(SNAPSHOTS_DIR, snap_name)
                            cv2.imwrite(snap_path, annotated_frame)

                            # Save evidence video clip from rolling buffer
                            video_name     = f"{cam_label}_{ts_int}.mp4"
                            video_filepath = os.path.join(VIDEOS_DIR, video_name)
                            video_url      = f"/videos/{video_name}"
                            if len(raw_frame_buffer) > 0:
                                h, w = raw_frame_buffer[0].shape[:2]
                                # Copy frames and write in background thread to avoid blocking the stream
                                frames_snapshot = list(raw_frame_buffer)
                                threading.Thread(
                                    target=_save_evidence_video,
                                    args=(frames_snapshot, video_filepath, VIDEO_FPS, (w, h)),
                                    daemon=True,
                                ).start()
                            else:
                                video_url = None

                            conn = sqlite3.connect(DB_PATH)
                            conn.execute(
                                "INSERT INTO incidents (timestamp, camera_id, description, confidence, snapshot_path, video_path) VALUES (?,?,?,?,?,?)",
                                (dt_string, cam_label, "Physical Altercation Detected", round(raw_conf, 4), f"/snapshots/{snap_name}", video_url)
                            )
                            conn.commit()
                            conn.close()
                            print(f"[{cam_label}] INCIDENT @ {dt_string} | conf={raw_conf:.2f} | snap={snap_name} | video={video_name}")
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

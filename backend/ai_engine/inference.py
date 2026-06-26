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
from collections import deque
from datetime import datetime

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

    # Rolling evidence buffer — stores raw (unannotated) frames for video clips
    video_buffer_len = VIDEO_BUFFER_SECONDS * VIDEO_FPS
    raw_frame_buffer = deque(maxlen=video_buffer_len)

    frame_count    = 0
    last_log_time  = 0
    violence_votes = 0
    smoothed_conf  = 0.0

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            break

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

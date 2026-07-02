"""
CityShield AI — Optimized Video Inference Pipeline

Architecture:
  - Per-camera BACKGROUND INFERENCE THREAD runs AI at its own pace (~8-15 fps)
  - Main stream loop captures + overlays last-known result + encodes at full
    camera FPS — display is never blocked waiting for AI
  - Single model: pose_model (YOLOv8n-pose) replaces separate YOLO + pose,
    halving inference work per cycle
  - Frame queue (maxsize=1) ensures inference always sees the LATEST frame

Violence detection:
  - Pose-based (PRIMARY):  proximity + arm-raise + wrist-velocity heuristic
  - BiLSTM     (SECONDARY): temporal CNN-LSTM on merged-person crop
  - Both gates require 2+ people — single-person never triggers
"""
import cv2
import queue
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
    VIDEO_BUFFER_SECONDS, VIDEO_FPS, POSE_FIGHT_THRESHOLD, VELOCITY_GATE,
)

live_confidence_threshold = CONFIDENCE_THRESHOLD

def set_live_threshold(val: float):
    global live_confidence_threshold
    live_confidence_threshold = max(0.1, min(1.0, val))

from ai_engine.classifier import action_model, transform, device, pose_model

# ─────────────────────────────────────────────────────────────────────────────
# METRICS
# ─────────────────────────────────────────────────────────────────────────────
system_start_time = time.time()
inference_times   = deque(maxlen=60)

# ─────────────────────────────────────────────────────────────────────────────
# SHARED STATE
# ─────────────────────────────────────────────────────────────────────────────
global_system_status = "MONITORING"
global_confidence    = 0.0
camera_states: dict  = {}


# ─────────────────────────────────────────────────────────────────────────────
# POSE-BASED FIGHT DETECTOR
# ─────────────────────────────────────────────────────────────────────────────
def _pose_fight_score(pose_results, prev_kpts_list: list) -> tuple:
    """
    Geometric fight detector. Returns (score 0-1, updated_kpts_list).

    Key design decisions to avoid false positives in crowds:
    - Per-person velocity tracked individually (not global max)
    - 3+ people in frame: require at least 2 people actively moving
    - Proximity only counted between pairs where at least one person is moving
    - Velocity score uses average of top-2 people, not single max
    """
    kpts_data = pose_results[0].keypoints
    boxes_obj = pose_results[0].boxes
    if kpts_data is None or boxes_obj is None or len(boxes_obj) < 2:
        return 0.0, []

    boxes_np = boxes_obj.xyxy.cpu().numpy()
    kpts_np  = kpts_data.xy.cpu().numpy()
    if len(kpts_np) < 2:
        return 0.0, []

    # ── Per-person wrist velocity ─────────────────────────────────────────────
    per_vel = [0.0] * len(kpts_np)
    if prev_kpts_list:
        try:
            prev = np.array(prev_kpts_list)
            for i in range(min(len(kpts_np), len(prev))):
                if prev[i].shape[0] < 11:
                    continue
                for idx in [9, 10]:   # left wrist, right wrist
                    px, py = prev[i][idx][0], prev[i][idx][1]
                    cx, cy = kpts_np[i][idx][0], kpts_np[i][idx][1]
                    if cx > 1 and cy > 1 and px > 1 and py > 1:
                        per_vel[i] = max(per_vel[i],
                                         ((cx-px)**2 + (cy-py)**2)**0.5)
        except Exception:
            pass

    max_vel = max(per_vel) if per_vel else 0.0

    # Gate 1: fastest wrist must exceed threshold
    if max_vel < VELOCITY_GATE:
        return 0.0, kpts_np.tolist()

    # Gate 2: with 3+ people, require at least 2 actively moving
    # (prevents one person gesturing/walking from triggering in a crowd)
    if len(kpts_np) >= 3:
        active_movers = sum(1 for v in per_vel if v >= VELOCITY_GATE * 0.5)
        if active_movers < 2:
            return 0.0, kpts_np.tolist()

    score = 0.0

    # ── Proximity (max 0.20) — only between pairs involving a moving person ───
    best_prox = 0.0
    for i in range(len(boxes_np)):
        for j in range(i + 1, len(boxes_np)):
            # Skip pairs where neither person is moving
            if per_vel[i] < VELOCITY_GATE * 0.3 and per_vel[j] < VELOCITY_GATE * 0.3:
                continue
            b1, b2 = boxes_np[i], boxes_np[j]
            c1x = (b1[0]+b1[2])/2;  c1y = (b1[1]+b1[3])/2
            c2x = (b2[0]+b2[2])/2;  c2y = (b2[1]+b2[3])/2
            dist  = ((c1x-c2x)**2 + (c1y-c2y)**2)**0.5
            avg_h = ((b1[3]-b1[1]) + (b2[3]-b2[1])) / 2
            norm  = dist / max(avg_h, 1.0)
            best_prox = max(best_prox, max(0.0, 1.0 - norm))
    score += best_prox * 0.20

    # ── Arm raise (max 0.20) ──────────────────────────────────────────────────
    raised = 0.0
    for kp in kpts_np:
        if kp.shape[0] < 11:
            continue
        ls, rs = kp[5], kp[6]
        le, re = kp[7], kp[8]
        lw, rw = kp[9], kp[10]
        if (lw[1] > 1 and lw[1] < ls[1]) or (rw[1] > 1 and rw[1] < rs[1]):
            raised += 1.0
        elif (le[1] > 1 and le[1] < ls[1]) or (re[1] > 1 and re[1] < rs[1]):
            raised += 0.5
    if len(kpts_np) > 0:
        score += min(raised / len(kpts_np), 1.0) * 0.20

    # ── Velocity score: average of top-2 people (max 0.60) ───────────────────
    # Using top-2 average instead of single max prevents one fast person
    # from driving the entire 60% weight in a crowd
    top2 = sorted(per_vel, reverse=True)[:2]
    avg_top2 = sum(top2) / len(top2)
    score += min(avg_top2 / 50.0, 1.0) * 0.60

    return min(score, 1.0), kpts_np.tolist()


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def _save_evidence_video(frames: list, filepath: str, fps: int, size: tuple):
    try:
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        w = cv2.VideoWriter(filepath, fourcc, fps, size)
        for f in frames:
            w.write(f)
        w.release()
        print(f"  ✓ Evidence saved: {filepath}")
    except Exception as e:
        print(f"  ✗ Evidence failed: {e}")


def _make_error_frame(msg: str):
    f = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(f, "STREAM ERROR", (160,210), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0,0,200), 2)
    cv2.putText(f, msg[:70],       (30, 270), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180,180,180), 1)
    return f


def _make_connecting_frame(label: str):
    f = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(f, "CONNECTING...",  (175, 220), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 165, 255), 2)
    cv2.putText(f, label,            (int(320 - len(label)*4.5), 262), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (130, 130, 130), 1)
    return f


def _iter_http_snapshot(base_url: str):
    parsed   = urlparse(base_url)
    shot_url = f"{parsed.scheme}://{parsed.netloc}/shot.jpg"
    fails    = 0
    print(f"[HTTP-SNAP] → {shot_url}")
    while True:
        try:
            resp  = requests.get(shot_url, timeout=(3,3))
            resp.raise_for_status()
            arr   = np.frombuffer(resp.content, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is not None:
                fails = 0
                yield frame
                time.sleep(0.1)   # ~10 fps ceiling — don't flood the phone
                continue
        except Exception as e:
            fails += 1
            if fails == 1:
                print(f"[HTTP-SNAP] {e}")
            time.sleep(min(fails*0.5, 5))


def _cap_iter(cap):
    fails = 0
    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            fails += 1
            if fails >= 30:
                break
            time.sleep(0.05)
            continue
        fails = 0
        yield frame
    cap.release()


# ─────────────────────────────────────────────────────────────────────────────
# BACKGROUND INFERENCE WORKER
# ─────────────────────────────────────────────────────────────────────────────
def _infer_worker(cam_id: int, frame_q: queue.Queue,
                  overlay: dict, overlay_lock: threading.Lock,
                  raw_frame_buffer: deque):
    """
    Runs in a daemon thread. Pulls latest frames from queue, runs AI,
    writes detection results into the shared overlay dict.
    The stream loop reads overlay without waiting for inference.
    """
    global global_system_status, global_confidence

    cam_label      = f"CAM-{cam_id:02d}"
    sequence_buffer = deque(maxlen=SEQUENCE_LEN)
    prev_kpts_list  = []
    label_idx       = 0
    raw_conf        = 0.0
    violence_votes  = 0
    smoothed_conf   = 0.0
    last_log_time   = 0
    frame_count     = 0

    while True:
        try:
            frame = frame_q.get(timeout=3.0)
        except queue.Empty:
            continue
        if frame is None:
            break

        frame_count += 1

        # ── Pose detection (replaces separate yolo_model call) ────────────────
        if pose_model is not None:
            try:
                pose_res           = pose_model(frame, classes=[0], verbose=False)
                pose_score, prev_kpts_list = _pose_fight_score(pose_res, prev_kpts_list)
                boxes_np           = pose_res[0].boxes.xyxy.cpu().numpy() \
                                     if len(pose_res[0].boxes) > 0 else []
                num_people         = len(boxes_np)
                boxes_int          = [[int(b[0]),int(b[1]),int(b[2]),int(b[3])] for b in boxes_np]
            except Exception:
                pose_score = 0.0
                num_people = 0
                boxes_int  = []
        else:
            pose_score = 0.0
            num_people = 0
            boxes_int  = []

        # ── BiLSTM on merged crop (every INFERENCE_STRIDE frames) ────────────
        if num_people > 0 and frame_count % INFERENCE_STRIDE == 0:
            try:
                mx1 = int(min(b[0] for b in boxes_np))
                my1 = int(min(b[1] for b in boxes_np))
                mx2 = int(max(b[2] for b in boxes_np))
                my2 = int(max(b[3] for b in boxes_np))
                mx1 = max(0,mx1); my1 = max(0,my1)
                mx2 = min(frame.shape[1],mx2); my2 = min(frame.shape[0],my2)
                if my2>my1 and mx2>mx1:
                    crop    = cv2.resize(frame[my1:my2, mx1:mx2], (224,224))
                    rgb     = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
                    sequence_buffer.append(transform(rgb))
                    if len(sequence_buffer) == SEQUENCE_LEN:
                        inp = torch.stack(list(sequence_buffer)).unsqueeze(0).to(device)
                        t0  = time.perf_counter()
                        with torch.no_grad():
                            probs     = torch.nn.functional.softmax(action_model(inp), dim=1)
                            label_idx = int(torch.argmax(probs, 1).item())
                            raw_conf  = float(probs[0][1].item())
                        inference_times.append((time.perf_counter()-t0)*1000)
            except Exception:
                pass

        # ── Combined confidence & votes ───────────────────────────────────────
        combined      = max(pose_score, raw_conf if label_idx==1 else 0.0)
        smoothed_conf = SMOOTHING_ALPHA*combined + (1-SMOOTHING_ALPHA)*smoothed_conf
        camera_states[cam_id]["confidence"] = smoothed_conf
        if cam_id == 1:
            global_confidence = smoothed_conf

        pose_hit  = pose_score >= POSE_FIGHT_THRESHOLD and num_people >= 2
        # LSTM requires meaningful pose evidence — blocks classifier firing
        # on hugs/gentle contact where velocity gate was barely passed
        lstm_hit  = (label_idx == 1 and raw_conf >= live_confidence_threshold
                     and num_people >= 2 and pose_score >= 0.30)
        if pose_hit or lstm_hit:
            violence_votes += 1
        else:
            violence_votes = max(0, violence_votes - 1)  # decay not hard-reset

        # ── Status ────────────────────────────────────────────────────────────
        if violence_votes >= VOTES_NEEDED:
            status    = 'VIOLENCE DETECTED!'
            box_color = (0, 0, 255)
        elif violence_votes > 0:
            status    = 'Analysing...'
            box_color = (0, 165, 255)
        else:
            status    = 'MONITORING'
            box_color = (0, 255, 0)

        camera_states[cam_id]["status"] = status
        if cam_id == 1:
            global_system_status = status

        # ── Incident logging ──────────────────────────────────────────────────
        if violence_votes >= VOTES_NEEDED:
            now = time.time()
            if now - last_log_time > LOG_COOLDOWN:
                last_log_time = now
                ts_int    = int(now)
                dt_string = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                snap_name = f"{cam_label}_{ts_int}.jpg"
                snap_path = os.path.join(SNAPSHOTS_DIR, snap_name)
                cv2.imwrite(snap_path, frame)

                video_url = None
                if len(raw_frame_buffer) > 0:
                    video_name = f"{cam_label}_{ts_int}.mp4"
                    vpath      = os.path.join(VIDEOS_DIR, video_name)
                    video_url  = f"/videos/{video_name}"
                    h, w       = raw_frame_buffer[0].shape[:2]
                    threading.Thread(
                        target=_save_evidence_video,
                        args=(list(raw_frame_buffer), vpath, VIDEO_FPS, (w,h)),
                        daemon=True,
                    ).start()

                log_conf = round(max(pose_score, raw_conf), 4)
                conn = None
                try:
                    conn = sqlite3.connect(DB_PATH)
                    conn.execute("PRAGMA journal_mode=WAL")
                    conn.execute(
                        "INSERT INTO incidents (timestamp,camera_id,description,"
                        "confidence,snapshot_path,video_path) VALUES (?,?,?,?,?,?)",
                        (dt_string, cam_label, "Physical Altercation Detected",
                         log_conf, f"/snapshots/{snap_name}", video_url)
                    )
                    conn.commit()
                    print(f"[{cam_label}] INCIDENT @ {dt_string} | "
                          f"pose={pose_score:.2f} lstm={raw_conf:.2f}")
                except Exception as e:
                    print(f"[{cam_label}] DB error: {e}")
                finally:
                    if conn:
                        conn.close()

        # ── Write overlay (lock is held only for the dict swap) ───────────────
        text_lines = [
            (f"{status} ({smoothed_conf*100:.0f}%)", (10,30), 0.7, box_color),
            (f"Pose:{pose_score:.2f}  LSTM:{raw_conf:.2f}", (10,58), 0.5, (200,200,0)),
        ]
        if 0 < violence_votes < VOTES_NEEDED:
            text_lines.append((f"Votes:{violence_votes}/{VOTES_NEEDED}", (10,80), 0.5, (0,165,255)))

        with overlay_lock:
            overlay["box_color"]  = box_color
            overlay["boxes"]      = boxes_int
            overlay["text_lines"] = text_lines


# ─────────────────────────────────────────────────────────────────────────────
# CAMERA SESSION MANAGER
# One CameraSession per physical source — shared by all browser viewers.
# Multiple clients connecting to the same camera reuse ONE capture thread and
# ONE inference thread instead of spawning duplicates.
# ─────────────────────────────────────────────────────────────────────────────
_sessions: dict      = {}
_sessions_lock       = threading.Lock()


class CameraSession:
    """
    Encapsulates one camera source: a single capture loop + inference thread.
    All browser connections call .stream() which yields from a shared latest JPEG.
    """

    def __init__(self, cam_id: int, source):
        self.cam_id           = cam_id
        self.source           = source
        self._active          = True
        self._jpg_lock        = threading.Lock()
        # Pre-populate with a connecting frame so <img> never shows blank while RTSP is opening
        _init_frame = _make_connecting_frame(f"CAM-{cam_id:02d}")
        _ret, _buf  = cv2.imencode('.jpg', _init_frame)
        self._latest_jpg: bytes = _buf.tobytes() if _ret else b''
        self.overlay          = {"box_color": (0, 255, 0), "boxes": [], "text_lines": []}
        self.overlay_lock     = threading.Lock()
        self.raw_frame_buffer = deque(maxlen=VIDEO_BUFFER_SECONDS * VIDEO_FPS)
        self._frame_q         = queue.Queue(maxsize=1)
        self.viewer_count     = 0
        camera_states[cam_id] = {"status": "MONITORING", "confidence": 0.0}

        threading.Thread(target=self._capture_loop, daemon=True,
                         name=f"cap-{cam_id}").start()
        threading.Thread(target=_infer_worker,
                         args=(cam_id, self._frame_q, self.overlay,
                               self.overlay_lock, self.raw_frame_buffer),
                         daemon=True, name=f"infer-{cam_id}").start()

    # ── Single capture + encode loop ─────────────────────────────────────────
    def _capture_loop(self):
        is_http = isinstance(self.source, str) and self.source.startswith("http")

        if is_http:
            # HTTP cameras retry forever — never kill the session
            self._http_capture_loop()
            return

        # ── RTSP / webcam path ────────────────────────────────────────────────
        cap = cv2.VideoCapture(self.source)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        if not cap.isOpened():
            camera_states[self.cam_id]["status"] = "ERROR: Cannot open stream"
            err = _make_error_frame(f"Cannot open: {self.source}")
            ret, buf = cv2.imencode('.jpg', err)
            if ret:
                with self._jpg_lock:
                    self._latest_jpg = buf.tobytes()
            self._active = False
            return

        for frame in _cap_iter(cap):
            self._encode_and_store(frame)

        # RTSP dropped — write error frame, stop
        err = _make_error_frame(f"CAM-{self.cam_id:02d} stream lost")
        ret, buf = cv2.imencode('.jpg', err)
        if ret:
            with self._jpg_lock:
                self._latest_jpg = buf.tobytes()
        camera_states[self.cam_id]["status"] = "STREAM LOST"
        self._active = False
        try:
            self._frame_q.get_nowait()
        except queue.Empty:
            pass
        self._frame_q.put(None)

    def _http_capture_loop(self):
        """HTTP phone camera loop — tries MJPEG via requests, falls back to snapshot."""
        base      = self.source.rstrip('/')
        video_url = base if base.endswith('/video') else base + '/video'

        while True:
            # ── Attempt 1: requests-based MJPEG (/video) ────────────────────
            # cv2.VideoCapture is unreliable for HTTP MJPEG on Windows —
            # it reports isOpened()=True but decodes 0 frames silently.
            # Direct byte-stream parsing with requests is always reliable.
            got_any = False
            camera_states[self.cam_id]["status"] = "Connecting..."
            try:
                resp = requests.get(video_url, stream=True, timeout=(5, 15))
                resp.raise_for_status()
                camera_states[self.cam_id]["status"] = "MONITORING"
                buf = b''
                for chunk in resp.iter_content(chunk_size=8192):
                    if not chunk:
                        continue
                    buf += chunk
                    # Parse complete JPEGs by SOI/EOI byte markers
                    while True:
                        start = buf.find(b'\xff\xd8')
                        end   = buf.find(b'\xff\xd9', start + 2) if start != -1 else -1
                        if start == -1 or end == -1:
                            break
                        jpg_bytes = buf[start:end + 2]
                        buf       = buf[end + 2:]
                        arr   = np.frombuffer(jpg_bytes, dtype=np.uint8)
                        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                        if frame is not None:
                            got_any = True
                            self._encode_and_store(frame)
            except Exception as e:
                if not got_any:
                    print(f"[HTTP-{self.cam_id}] MJPEG failed: {e}")

            if got_any:
                # Stream was working then dropped — show reconnecting, retry
                camera_states[self.cam_id]["status"] = "Reconnecting..."
                f = _make_connecting_frame(f"CAM-{self.cam_id:02d}")
                ret, buf2 = cv2.imencode('.jpg', f)
                if ret:
                    with self._jpg_lock:
                        self._latest_jpg = buf2.tobytes()
                time.sleep(2)
                continue

            # ── Attempt 2: snapshot polling (/shot.jpg) ──────────────────────
            camera_states[self.cam_id]["status"] = "SNAP"
            for frame in _iter_http_snapshot(self.source):
                self._encode_and_store(frame)
            time.sleep(3)

    def _encode_and_store(self, frame):
        """Apply overlay, resize to ≤640px wide, encode JPEG, store in _latest_jpg."""
        self.raw_frame_buffer.append(frame.copy())
        try:
            self._frame_q.put_nowait(frame.copy())
        except queue.Full:
            try:   self._frame_q.get_nowait()
            except queue.Empty: pass
            try:   self._frame_q.put_nowait(frame.copy())
            except queue.Full:  pass

        annotated = frame.copy()
        with self.overlay_lock:
            box_color  = self.overlay["box_color"]
            boxes      = list(self.overlay["boxes"])
            text_lines = list(self.overlay["text_lines"])
        for b in boxes:
            cv2.rectangle(annotated, (b[0], b[1]), (b[2], b[3]), box_color, 2)
        for (txt, pos, scale, col) in text_lines:
            cv2.putText(annotated, txt, pos, cv2.FONT_HERSHEY_SIMPLEX, scale, col, 2)
        dh, dw = annotated.shape[:2]
        if dw > 640:
            annotated = cv2.resize(annotated, (640, int(dh * 640 / dw)),
                                   interpolation=cv2.INTER_LINEAR)
        ret, buf = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if ret:
            with self._jpg_lock:
                self._latest_jpg = buf.tobytes()

    # ── Viewer generator (one per browser connection) ─────────────────────────
    def stream(self):
        self.viewer_count += 1
        try:
            while True:
                with self._jpg_lock:
                    jpg = self._latest_jpg
                if jpg:
                    yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n'
                           + jpg + b'\r\n')
                if not self._active:
                    break            # camera dead — stop after sending final error frame
                time.sleep(0.03)     # ~30 fps ceiling per viewer
        finally:
            self.viewer_count -= 1
            # Remove dead session so the next connection recreates it cleanly
            if not self._active:
                with _sessions_lock:
                    if _sessions.get(self.cam_id) is self:
                        _sessions.pop(self.cam_id, None)


def _get_or_create_session(cam_id: int, source) -> CameraSession:
    """Return the existing live session for cam_id, or create a new one."""
    with _sessions_lock:
        sess = _sessions.get(cam_id)
        if sess is None or not sess._active:
            sess = CameraSession(cam_id, source)
            _sessions[cam_id] = sess
        return sess


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC API (unchanged signature — video.py calls these)
# ─────────────────────────────────────────────────────────────────────────────
def generate_frames_for_camera(cam_id: int, source):
    yield from _get_or_create_session(cam_id, source).stream()


def generate_ai_frames():
    yield from generate_frames_for_camera(1, 0)

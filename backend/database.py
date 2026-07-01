"""
CityShield AI — Database Initialization & Helpers
"""
import sqlite3
from config import DB_PATH


def get_db():
    """Return a connection with Row factory enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def log_audit(user_email: str, action_type: str, event_description: str):
    """Insert one row into system_audit_logs. Fire-and-forget — never raises."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            "INSERT INTO system_audit_logs (user_email, action_type, event_description) VALUES (?,?,?)",
            (user_email, action_type, event_description)
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def init_db():
    """Create tables, seed data, run migrations, and build indexes."""
    print("Checking Database Integrity...")
    conn   = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS system_audit_logs (
            log_id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email        TEXT    DEFAULT '',
            action_type       TEXT    NOT NULL,
            event_description TEXT    NOT NULL,
            timestamp         TEXT    DEFAULT (datetime('now'))
        )
    ''')

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

    # Seed the single real camera (laptop webcam / AI feed) on first run only
    cursor.execute(
        "INSERT OR IGNORE INTO cameras (id,name,location,zone,rtsp_url,is_active,is_ai) "
        "VALUES (1,'CAM-01','Webcam / AI Feed','ZONE-A','http://127.0.0.1:8000/api/video_feed',1,1)"
    )

    # Remove legacy placeholder cameras (2-4) from existing databases
    cursor.execute("DELETE FROM cameras WHERE id IN (2,3,4)")

    # Safe migrations for existing databases
    for col_sql in [
        "ALTER TABLE incidents ADD COLUMN review_status TEXT DEFAULT 'UNREVIEWED'",
        "ALTER TABLE incidents ADD COLUMN reviewed_by TEXT",
        "ALTER TABLE incidents ADD COLUMN reviewed_at TEXT",
        "ALTER TABLE incidents ADD COLUMN confidence REAL DEFAULT 0.0",
        "ALTER TABLE incidents ADD COLUMN snapshot_path TEXT",
        "ALTER TABLE incidents ADD COLUMN video_path TEXT",
        "ALTER TABLE cameras ADD COLUMN latitude  REAL DEFAULT 0.0",
        "ALTER TABLE cameras ADD COLUMN longitude REAL DEFAULT 0.0",
    ]:
        try:
            cursor.execute(col_sql)
        except Exception:
            pass

    conn.commit()
    conn.close()

    # ── Performance indexes ──────────────────────────────────────────────────
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_incidents_timestamp  ON incidents(timestamp DESC)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_incidents_camera_id  ON incidents(camera_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_incidents_status     ON incidents(review_status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_timestamp      ON system_audit_logs(timestamp DESC)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_action_type    ON system_audit_logs(action_type)")
    conn.commit()
    conn.close()
    print("Database OK.")

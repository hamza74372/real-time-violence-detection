"""
CityShield AI — System Audit Log Routes
Admin-only: returns the full activity audit trail stored in SQLite.
"""
from fastapi import APIRouter, Depends

from database import get_db
from middleware.auth import require_admin

router = APIRouter(prefix="/api", tags=["audit"])


@router.get("/audit-logs")
async def get_audit_logs(limit: int = 200, user=Depends(require_admin)):
    conn  = get_db()
    rows  = conn.execute(
        """SELECT log_id, user_email, action_type, event_description, timestamp
           FROM system_audit_logs
           ORDER BY log_id DESC
           LIMIT ?""",
        (min(limit, 500),)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

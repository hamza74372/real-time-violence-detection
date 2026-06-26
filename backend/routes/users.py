"""
CityShield AI — User Management Routes (Firebase Admin SDK)
GET requires auth. POST/DELETE require admin.
"""
from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import auth as fb_auth
from datetime import datetime

from database import log_audit
from models.schemas import UserCreate
from middleware.auth import verify_firebase_token, require_admin

router = APIRouter(prefix="/api", tags=["users"])


def _get_admin_db():
    """Lazy import to avoid circular dependency."""
    from main import admin_db
    return admin_db


@router.get("/users")
async def list_users(user=Depends(verify_firebase_token)):
    try:
        admin_db = _get_admin_db()
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


@router.post("/users", status_code=201)
async def create_user(body: UserCreate, user=Depends(require_admin)):
    if body.role not in ("admin", "operator"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'operator'")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    try:
        admin_db = _get_admin_db()
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
        log_audit(user.get("email", "unknown"), "USER_CREATED",
                  f"New {body.role} account created for {body.email} ({body.full_name})")
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


@router.delete("/users/{email}", status_code=204)
async def delete_user(email: str, user=Depends(require_admin)):
    try:
        admin_db = _get_admin_db()
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

        log_audit(user.get("email", "unknown"), "USER_DELETED",
                  f"Account {email} removed from the system")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

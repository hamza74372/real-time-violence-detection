"""
CityShield AI — Firebase Authentication Middleware
Verifies Firebase ID tokens and enforces role-based access control.
"""
from fastapi import Depends, HTTPException, Request
from firebase_admin import auth as fb_auth


async def verify_firebase_token(request: Request) -> dict:
    """
    FastAPI dependency: extracts and verifies the Firebase ID token
    from the Authorization header. Returns the decoded token claims.

    Usage:
        @router.get("/endpoint")
        async def my_route(user=Depends(verify_firebase_token)):
            print(user["uid"], user["email"])
    """
    auth_header = request.headers.get("Authorization", "")

    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header. Expected 'Bearer <token>'."
        )

    token = auth_header[7:]  # strip "Bearer "

    try:
        decoded = fb_auth.verify_id_token(token)
        return decoded
    except fb_auth.InvalidIdTokenError:
        raise HTTPException(status_code=401, detail="Invalid Firebase ID token.")
    except fb_auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Firebase ID token has expired.")
    except fb_auth.RevokedIdTokenError:
        raise HTTPException(status_code=401, detail="Firebase ID token has been revoked.")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")


async def require_admin(request: Request, user: dict = Depends(verify_firebase_token)) -> dict:
    """
    FastAPI dependency: chains on verify_firebase_token and checks
    the user's Firestore role. Raises 403 if not admin.

    Imports admin_db lazily to avoid circular imports.
    """
    from main import admin_db  # lazy import to break circular dependency

    email = user.get("email", "")
    try:
        doc = admin_db.collection("users").document(email).get()
        if doc.exists and doc.to_dict().get("role") == "admin":
            return user
    except Exception:
        pass

    raise HTTPException(
        status_code=403,
        detail="Admin privileges required for this action."
    )

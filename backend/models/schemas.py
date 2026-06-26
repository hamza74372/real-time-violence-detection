"""
CityShield AI — Pydantic Request / Response Schemas
"""
from pydantic import BaseModel
from typing import Literal, Optional


class IncidentStatusUpdate(BaseModel):
    status:      Literal['CONFIRMED', 'DISMISSED', 'ESCALATED', 'DISPATCHED']
    reviewed_by: Optional[str] = "Operator"
    reviewed_at: Optional[str] = None


class CameraCreate(BaseModel):
    name:      str
    location:  str
    zone:      str
    rtsp_url:  str
    is_active: Optional[bool]  = True
    is_ai:     Optional[bool]  = False
    latitude:  Optional[float] = 0.0
    longitude: Optional[float] = 0.0


class CameraUpdate(BaseModel):
    name:      Optional[str]   = None
    location:  Optional[str]   = None
    zone:      Optional[str]   = None
    rtsp_url:  Optional[str]   = None
    is_active: Optional[bool]  = None
    is_ai:     Optional[bool]  = None
    latitude:  Optional[float] = None
    longitude: Optional[float] = None


class UserCreate(BaseModel):
    email:     str
    password:  str
    full_name: str
    role:      str  # 'admin' or 'operator'

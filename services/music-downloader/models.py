from typing import List, Optional
from pydantic import BaseModel, Field


class DownloadItem(BaseModel):
    id: Optional[str] = None
    query: str = Field(..., description="Song name or YouTube URL")
    artist: Optional[str] = None
    title: Optional[str] = None
    filename: Optional[str] = None


class BatchDownloadRequest(BaseModel):
    items: List[DownloadItem]


class TaskProgress(BaseModel):
    task_id: str
    query: str
    title: Optional[str] = None
    artist: Optional[str] = None
    filename: Optional[str] = None
    status: str = "queued"  # queued, searching, downloading, converting, completed, failed, cancelled
    progress_percent: float = 0.0
    speed_str: Optional[str] = None
    eta_str: Optional[str] = None
    downloaded_bytes: Optional[int] = 0
    total_bytes: Optional[int] = 0
    error: Optional[str] = None
    created_at: float
    updated_at: float

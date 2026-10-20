import concurrent.futures
import logging
import os
import time
import uuid
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from downloader import MUSIC_DIR, download_song_sync, sanitize_filename
from models import BatchDownloadRequest, DownloadItem, TaskProgress

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("muse.music.downloader")

app = FastAPI(title="Muse Music Downloader")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

tasks: Dict[str, TaskProgress] = {}
executor = concurrent.futures.ThreadPoolExecutor(max_workers=3)


def execute_download(task_id: str):
    task = tasks.get(task_id)
    if not task:
        return

    clean_name = sanitize_filename(task.filename) if task.filename else None
    if clean_name:
        target_file = MUSIC_DIR / clean_name
        if target_file.is_file() and target_file.stat().st_size > 50000:
            logger.info("Task %s: file '%s' already exists in library (%d bytes). Skipping duplicate download.", task_id, clean_name, target_file.stat().st_size)
            task.status = "completed"
            task.progress_percent = 100.0
            task.filename = clean_name
            task.downloaded_bytes = target_file.stat().st_size
            task.total_bytes = target_file.stat().st_size
            task.updated_at = time.time()
            return

    logger.info("Starting download task %s: query='%s', file='%s'", task_id, task.query, task.filename)
    task.status = "searching"
    task.updated_at = time.time()

    def on_progress(d):
        if d.get("status") == "downloading":
            downloaded = d.get("downloaded_bytes", 0)
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            task.downloaded_bytes = downloaded
            task.total_bytes = total
            if total > 0:
                pct = (downloaded / total) * 100
                task.progress_percent = round(min(pct, 95.0), 1)
            else:
                task.progress_percent = 30.0
            
            task.speed_str = d.get("_speed_str")
            task.eta_str = d.get("_eta_str")
            task.status = "downloading"
            task.updated_at = time.time()
        elif d.get("status") == "finished":
            task.status = "converting"
            task.progress_percent = 96.0
            task.updated_at = time.time()

    def on_postprocess(d):
        if d.get("status") == "started":
            task.status = "converting"
            task.progress_percent = 97.0
            task.updated_at = time.time()
        elif d.get("status") == "finished":
            task.status = "converting"
            task.progress_percent = 99.0
            task.updated_at = time.time()

    try:
        final_file = download_song_sync(
            query=task.query,
            target_filename=task.filename,
            on_progress=on_progress,
            on_postprocess=on_postprocess,
        )
        task.status = "completed"
        task.progress_percent = 100.0
        task.filename = os.path.basename(final_file)
        task.updated_at = time.time()
        logger.info("Completed task %s -> %s", task_id, final_file)
    except Exception as e:
        logger.exception("Failed download task %s: %s", task_id, e)
        task.status = "failed"
        task.error = str(e)
        task.updated_at = time.time()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "muse-music-downloader",
        "music_dir": str(MUSIC_DIR),
        "tasks_count": len(tasks),
    }


@app.post("/api/download/batch")
def download_batch(req: BatchDownloadRequest):
    if not req.items:
        raise HTTPException(status_code=400, detail="No items provided in batch request.")

    created: List[TaskProgress] = []
    now = time.time()

    for item in req.items:
        task_id = item.id or f"task_{uuid.uuid4().hex[:8]}"
        clean_name = sanitize_filename(item.filename) if item.filename else None
        
        task = TaskProgress(
            task_id=task_id,
            query=item.query,
            artist=item.artist,
            title=item.title,
            filename=clean_name,
            status="queued",
            progress_percent=0.0,
            created_at=now,
            updated_at=now,
        )
        tasks[task_id] = task
        created.append(task)
        executor.submit(execute_download, task_id)

    return {"tasks": [t.model_dump() for t in created]}


@app.get("/api/tasks")
def list_tasks():
    # Return all tasks sorted by creation time descending
    sorted_tasks = sorted(tasks.values(), key=lambda t: t.created_at, reverse=True)
    return {"tasks": [t.model_dump() for t in sorted_tasks]}


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task.model_dump()


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str):
    if task_id in tasks:
        del tasks[task_id]
        return {"success": True, "message": f"Task {task_id} removed"}
    raise HTTPException(status_code=404, detail="Task not found")

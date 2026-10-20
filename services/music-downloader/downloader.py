import logging
import os
import re
import shutil
import time
from pathlib import Path
from typing import Callable, Optional
import yt_dlp

logger = logging.getLogger("muse.music.downloader")

MUSIC_DIR = Path(os.getenv("MUSIC_DIR", "/music")).resolve()


def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent directory traversal and illegal characters."""
    filename = re.sub(r'[\\/*?:"<>|]', "", filename)
    filename = filename.strip()
    if not filename.lower().endswith(".mp3"):
        filename += ".mp3"
    return filename


def get_ydl_base_options(progress_hook: Optional[Callable] = None, postprocessor_hook: Optional[Callable] = None) -> dict:
    ffmpeg_path = shutil.which("ffmpeg")
    node_path = shutil.which("node")

    options = {
        "ffmpeg_location": ffmpeg_path,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": False,
        "retries": 5,
        "fragment_retries": 10,
        "source_address": "0.0.0.0",
        "legacy_server_connect": True,
        "http_chunk_size": 1048576,
        "extractor_args": {
            "youtube": {
                "player_client": ["web", "android", "ios"],
            }
        },
        "progress_hooks": [progress_hook] if progress_hook else [],
        "postprocessor_hooks": [postprocessor_hook] if postprocessor_hook else [],
    }

    cookie_file = os.getenv("YT_DLP_COOKIES")
    cookie_candidates = [
        Path(cookie_file) if cookie_file else None,
        MUSIC_DIR / "cookies.txt",
        Path("/app/cookies.txt"),
        Path("/etc/muse/cookies.txt"),
    ]
    for cpath in cookie_candidates:
        if cpath and cpath.is_file() and cpath.stat().st_size > 0:
            options["cookiefile"] = str(cpath)
            logger.info("Using yt-dlp cookie file from %s", cpath)
            break

    if node_path:
        options["js_runtimes"] = {"node": {"path": node_path}}

    return options


def download_song_sync(
    query: str,
    target_filename: Optional[str],
    on_progress: Optional[Callable[[dict], None]] = None,
    on_postprocess: Optional[Callable[[dict], None]] = None,
) -> str:
    """
    Downloads audio for query and converts to MP3 in MUSIC_DIR.
    Returns the resolved output file path.
    """
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)

    query_str = query.strip()
    clean_name = sanitize_filename(target_filename) if target_filename else None
    if clean_name:
        final_path = MUSIC_DIR / clean_name
        if final_path.is_file() and final_path.stat().st_size > 50000:
            logger.info("File '%s' already exists (%d bytes). Skipping duplicate download.", clean_name, final_path.stat().st_size)
            if on_progress:
                on_progress({
                    "status": "downloading",
                    "downloaded_bytes": final_path.stat().st_size,
                    "total_bytes": final_path.stat().st_size,
                })
                on_progress({"status": "finished"})
            if on_postprocess:
                on_postprocess({"status": "finished"})
            return str(final_path)

    ydl_opts = get_ydl_base_options(
        progress_hook=on_progress,
        postprocessor_hook=on_postprocess,
    )

    # Determine candidate URLs to try
    candidates: list[str] = []
    if query_str.startswith("http://") or query_str.startswith("https://"):
        candidates = [query_str]
    else:
        # Search for multiple candidates so age-restricted or blocked videos can fall back to clean releases
        search_opts = dict(ydl_opts)
        search_opts["extract_flat"] = True
        search_opts["quiet"] = True
        try:
            with yt_dlp.YoutubeDL(search_opts) as ydl:
                search_res = ydl.extract_info(f"ytsearch5:{query_str}", download=False)
                for entry in (search_res.get("entries") or []):
                    if not entry:
                        continue
                    eid = entry.get("id")
                    if eid:
                        candidates.append(f"https://www.youtube.com/watch?v={eid}")
                    elif entry.get("url"):
                        candidates.append(entry.get("url"))
        except Exception as e:
            logger.warning("Search query '%s' flat search failed: %s. Falling back to ytsearch1.", query_str, e)
            candidates = [f"ytsearch1:{query_str}"]

    if not candidates:
        candidates = [f"ytsearch1:{query_str}"]

    last_error: Optional[Exception] = None
    download_success = False

    for idx, candidate in enumerate(candidates, 1):
        try:
            logger.info("Attempting download candidate %d/%d (%s) for '%s'", idx, len(candidates), candidate, query_str)
            
            # Setup output template for this attempt
            if clean_name:
                base_name = clean_name[:-4]
                attempt_outtmpl = str(MUSIC_DIR / f"{base_name}.%(ext)s")
            else:
                attempt_outtmpl = str(MUSIC_DIR / "%(title).200B.%(ext)s")

            current_opts = dict(ydl_opts)
            current_opts.update({
                "outtmpl": attempt_outtmpl,
                "format": "bestaudio/best",
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "0",
                    }
                ],
            })

            with yt_dlp.YoutubeDL(current_opts) as ydl:
                info = ydl.extract_info(candidate, download=True)
                if info and "entries" in info and info["entries"]:
                    info = info["entries"][0]

                if not clean_name and info:
                    artist = info.get("artist") or info.get("creator") or info.get("uploader") or ""
                    track = info.get("track") or info.get("title") or "unknown"
                    if artist and artist.lower() not in track.lower():
                        clean_name = sanitize_filename(f"{artist} - {track}.mp3")
                    else:
                        clean_name = sanitize_filename(f"{track}.mp3")

            download_success = True
            break
        except (yt_dlp.utils.DownloadError, Exception) as e:
            err_msg = str(e)
            logger.warning("Candidate %d (%s) failed: %s", idx, candidate, err_msg)
            last_error = e
            # Clean up any leftover partial file for this base_name before next candidate
            if idx < len(candidates) and clean_name:
                base_name = clean_name[:-4]
                for leftover in MUSIC_DIR.glob(f"{base_name}.*"):
                    if leftover.suffix.lower() != ".mp3":
                        try:
                            leftover.unlink(missing_ok=True)
                        except Exception:
                            pass
            continue

    if not download_success:
        if last_error:
            raise last_error
        raise RuntimeError(f"Failed to download audio for query '{query_str}'")

    if not clean_name:
        raise RuntimeError("Download completed but filename could not be determined.")

    final_path = MUSIC_DIR / clean_name
    return str(final_path)

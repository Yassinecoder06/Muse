FROM python:3.11-slim

# Install system dependencies: ffmpeg for audio conversion, nodejs for yt-dlp JS deciphering, curl for tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg nodejs curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/music-downloader/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/music-downloader/ ./

ENV PYTHONUNBUFFERED=1
ENV MUSIC_DIR=/music
ENV PORT=8001

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health')" || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]

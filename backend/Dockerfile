# ── Stage 1: Build the React frontend ────────────────────────────────────────
FROM node:22-alpine AS node-builder

WORKDIR /build

# Copy only manifests first so npm ci is cached when source hasn't changed.
COPY frontend-react/package.json frontend-react/package-lock.json ./
RUN npm ci --ignore-scripts

# Copy the full React source and build.
COPY frontend-react/ ./
RUN npm run build
# Output is at /build/dist

# ── Stage 2: Python / Gunicorn application image ──────────────────────────────
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libjpeg62-turbo-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install -r /app/backend/requirements.txt

COPY backend /app/backend
# React production build — compiled in Stage 1, no node_modules in image.
COPY --from=node-builder /build/dist /app/frontend-react/dist

RUN useradd --create-home --shell /bin/bash appuser \
    && mkdir -p /data /app/backend/evidence \
    && chown -R appuser:appuser /app /data

WORKDIR /app/backend

USER appuser

EXPOSE 5000

CMD ["gunicorn", "app:create_app()", "--bind", "0.0.0.0:5000", "--workers", "4", "--timeout", "120"]

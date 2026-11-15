# Prometheus 375 Backend — Deployment & Keep-Warm Guide

This document describes the production deployment configuration on Render and the keep-warm monitoring setup via an external uptime monitor (such as UptimeRobot) for the Prometheus 375 backend.

---

## 1. Render Deployment Configuration

The FastAPI backend is deployed as a Render Web Service running Python 3.11+.

### Service Settings
| Parameter | Value | Notes |
|---|---|---|
| **Service Type** | Web Service | Python environment |
| **Name** | `prometheus-375` | Production backend |
| **Region** | Oregon (or closest to team) | Free tier or standard instance |
| **Root Directory** | `.` (repository root) | Contains `backend/` and `data/processed/` |
| **Build Command** | `pip install -r backend/requirements.txt` | Installs DuckDB, FastAPI, Shapely, etc. |
| **Start Command** | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` | Binds to Render's allocated `$PORT` |
| **Health Check Path** | `/health` | **Critical**: Tells Render when container is healthy |

### Environment Variables
Configure these in the Render Dashboard (**Environment** tab):
- `FIRMS_MAP_KEY`: NASA FIRMS MAP_KEY for real-time VIIRS NOAA-20 and NOAA-21 NRT active fire data. *(Optional: if omitted, the backend automatically serves the pre-packaged static snapshot fallback without failing).*
- `PARQUET_PATH`: Path to the harmonized parquet dataset. Defaults automatically to `data/processed/harmonized.parquet` or `backend/data/harmonized.parquet`.

---

## 2. Health Check Endpoint (`GET /health`)

The `/health` endpoint is specifically designed for high-frequency uptime monitoring:
- **Fast and lightweight**: Executes in `< 2 ms`.
- **No heavy database operations**: Avoids opening DuckDB spatial scans or downloading data.
- **Verification**: Confirms the ASGI server is responsive and checks whether the required parquet dataset exists on disk.

### Sample Response
```json
{
  "status": "ok",
  "parquet_exists": true
}
```

---

## 3. Keep-Warm Setup (UptimeRobot)

Render free instances spin down into a sleep state after **15 minutes** of inbound HTTP inactivity. The first request after spindown encounters a cold-start delay of ~30–50 seconds.

> **Architecture Decision**: To ensure zero cold-start delay during evaluations and user demos without violating platform terms, Prometheus 375 utilizes an **external HTTP pinging monitor** rather than an internal background loop (an in-process thread inside the container is suspended when Render puts the container to sleep).

### Step-by-Step UptimeRobot Setup
1. Log in to [UptimeRobot](https://uptimerobot.com/) (free tier supports up to 50 monitors).
2. Click **+ Add New Monitor**.
3. Configure the monitor parameters:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `Prometheus 375 Backend Keep-Warm`
   - **URL (or IP)**: `https://prometheus-375.onrender.com/health`
   - **Monitoring Interval**: `Every 5 minutes` *(Render sleeps after 15 minutes; a 5-minute ping keeps the instance warm)*
   - **Monitor Timeout**: `30 seconds` *(accommodates cold start on initial configuration)*
4. Select alert contacts for notifications if an outage occurs.
5. Click **Create Monitor**.

### Security & Privacy
- **Do NOT store uptime monitor credentials or API keys in git repositories.**
- External uptime monitoring requires only the public HTTPS URL of the `/health` endpoint.

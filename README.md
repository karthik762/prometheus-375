# Prometheus 375 — MODIS + VIIRS Fire Hotspot Harmonization
NASA Space Apps Challenge 2026 (Hyderabad). One consistent burning-activity calendar (2000 → today) for any area, so the sensor of origin no longer matters.

> "Satellites keep retiring. Our record doesn't break when they do."

## Repo layout
| Folder | What | Owner |
|---|---|---|
| `pipeline/` | Offline Python: clean → grid → satellite fix → MODIS→VIIRS fit → validate | Rishitha, Poojitha |
| `backend/` | FastAPI + DuckDB over parquet, live FIRMS feed | Snehitha, Karthik, Poojitha |
| `frontend/` | React + Vite + MapLibre | Rishitha, Snehitha |
| `data-sample/` | Small sample in the shared contract format | Rishitha |
| `docs/` | AGENTS.md, roles, tasks, decisions, handoffs, tracker | all |

Start here: **`AGENTS.md`** (paste it into your AI tool) and **`docs/Prometheus375_Task_Tracker.xlsx`**.

## Data
Source: [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov). Raw downloads are not committed (too large) — get them from the team Drive into `data/raw/`.
Copy `.env.example` to `.env` and add your FIRMS MAP_KEY. Never commit `.env`.

## Deploy
Repo and all deploys owned by Karthik: backend → Render, frontend → Vercel.

## License
MIT, see LICENSE. Data: NASA FIRMS.

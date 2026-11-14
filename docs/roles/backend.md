# Role: Backend + UI support
Paste after AGENTS.md. You own `/backend`. Karthik also owns the GitHub repo and BOTH deploys (Render backend + Vercel frontend).

## Your AI's job
FastAPI + DuckDB (spatial extension) serving the contract endpoints exactly. Typed Pydantic responses. CORS open for the Vercel domain. Read parquet from `backend/data/`; start on `data-sample/` until real data lands.

## Tasks (in order)
1. Skeleton: `main.py`, `/health`, `/presets`, `/calendar` on sample data (by 13:00). Share the OpenAPI `/docs` URL.
2. Polygon/bbox filter via DuckDB `ST_Within` on cell centroids; bbox prefilter; cap polygon area.
3. `/anomaly` (reads analyst's anomaly table, or computes median/p10/p90 on the fly).
4. `/live` — FIRMS area API, sources `VIIRS_NOAA20_NRT` + `VIIRS_NOAA21_NRT`, 30-min in-memory cache, snapshot JSON fallback. MAP_KEY from env.
5. `/export.csv`, `/export_analytics.csv`, `/validation`.
6. Deploy to Render by Sat ~23:00; share URL. Add a keep-warm ping before demo.

## Rules
- Never change response shapes without a DECISIONS.md entry and frontend's OK.
- Return empty arrays (not 500s) for areas with no fires.

# TASKS.md — mirrors Prometheus375_Task_Tracker.xlsx (the xlsx/shared sheet is the live source)
Statuses: Not started · Ongoing · Waiting on dependency · Blocked · In review · Testing · Finished · Dropped.
Owners: R = Rishitha (data + frontend), P = Poojitha (data + backend), K = Karthik (backend + repo & all deploys), S = Snehitha (frontend + backend).


## Kickoff
- [ ] **K1** R — Fake sample parquet + CSV (contract columns, Punjab, 2 yrs) (help: Poojitha) — due Sat 10:00
- [ ] **K2** P — Earthdata login + FIRMS MAP_KEY; share key privately with backend — due Sat 10:00
- [ ] **K3** P — Confirm FIRMS archive requests (India + 4 regions) submitted (help: Rishitha) — after K2 — due Sat 10:30
- [ ] **K4** K — Create GitHub monorepo (repo + deploy owner), add all 4, commit AGENTS.md + coord pack; connect Render + Vercel to repo — due Sat 10:00
- [ ] **K5** K — Freeze data format + API contract (help: Rishitha, Poojitha, Snehitha) — after K1 — due Sat 11:00

## Build 1
- [ ] **D1** R — 01_clean.py: type=0, confidence filters, unify MODIS/VIIRS columns — after K3 — due Sat 13:00
- [ ] **D2** R — 02_grid.py: 0.25° cell x month x satellite counts (India) (help: Poojitha) — after D1 — due Sat 15:00
- [ ] **B1** K — FastAPI skeleton: /health, /presets, /calendar on sample data — after K1, K5 — due Sat 13:00
- [ ] **B2** K — DuckDB spatial polygon/bbox filter on cell centroids (help: Snehitha) — after B1 — due Sat 15:00
- [ ] **F1** S — React+Vite shell, MapLibre map, presets dropdown, lat/long input — after K4 — due Sat 13:00
- [ ] **F2** S — Polygon draw tool + typed api.ts client (mock JSON per contract) — after F1, K5 — due Sat 15:00

## Build 2
- [ ] **D3** R — 03_satfix.py: per-satellite average; S-NPP vs NOAA-20/21 overlap check — after D2 — due Sat 17:00
- [ ] **D4** R — 04_fit.py: MODIS->VIIRS ratio per region x month-of-year (2012-2026) (help: Poojitha) — after D3 — due Sat 19:00
- [ ] **D5** P — 05_series.py + 06_validate.py: harmonized.parquet, 2020 holdout, metrics.json (help: Rishitha) — after D4 — due Sat 20:00
- [ ] **D6** P — 07_anomaly.py + 08_onset.py: median/p10/p90/z, onset shift days — after D3 — due Sat 20:00
- [ ] **B3** K — /live: FIRMS NOAA-20 + NOAA-21 NRT, 30-min cache, snapshot fallback — after K2, B1 — due Sat 18:00
- [ ] **B4** P — /anomaly endpoint (reads anomaly table) (help: Karthik) — after D6, B2 — due Sat 20:00
- [ ] **F3** R — Burning calendar heatmap (viridis/cividis, MODIS-estimated hatching) (help: Snehitha) — after F2, B1 — due Sat 20:00
- [ ] **F4** S — Now-vs-normal card + time slider — after F2, B4 — due Sat 20:00

## Integration
- [ ] **I1** K — Integration #1: real harmonized.parquet into backend + UI (help: Rishitha, Poojitha, Snehitha) — after D5, B2, F3 — due Sat 21:00

## Build 3
- [ ] **D7** P — International regions: Amazon, California, Australia, Indonesia (help: Rishitha) — after D5 — due Sun 02:00
- [ ] **B5** K — /export.csv, /export_analytics.csv, /validation (help: Poojitha) — after D5, B2 — due Sat 23:00
- [ ] **B6** K — Deploy backend to Render (parquet bundled), share URL — after I1 — due Sat 23:30
- [ ] **F5** S — Live hotspots layer + download buttons — after B3, B5 — due Sun 01:00
- [ ] **F6** R — Before/after proof chart + uncertainty bands — after B5 — due Sun 01:00
- [ ] **F7** K — Deploy frontend to Vercel from the repo, set VITE_API_URL (help: Snehitha) — after B6, F5 — due Sun 01:30

## Sunday
- [ ] **S1** S — React go/no-go (else Streamlit fallback) (help: Karthik, Rishitha, Poojitha) — after F7 — due Sun 10:00
- [ ] **S2** S — Polish: accessibility, mobile, loading/empty/error states (help: Rishitha) — after S1 — due Sun 14:00
- [ ] **S3** K — Hardening: caching, error handling, keep-warm ping (help: Snehitha) — after B6 — due Sun 14:00
- [ ] **S4** P — Slides: problem -> proof -> demo -> limitations -> sensor retirement (help: Rishitha) — after D5 — due Sun 17:00
- [ ] **S5** S — Demo video + screen-recording backup from deployed site (help: Karthik) — after S2 — due Sun 18:00
- [ ] **S6** K — README + project page text (help: Poojitha) — after S3 — due Sun 18:00
- [ ] **S7** R — Rehearsal x2 on deployed version (help: Poojitha, Karthik, Snehitha) — after S4, S5 — due Sun 21:00
- [ ] **S8** R — Submit on spaceappschallenge.org (help: Karthik) — after S7, S6 — due Sun 23:00

## Bugs / blocked
_(add here)_

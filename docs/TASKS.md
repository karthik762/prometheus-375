# TASKS.md — mirrors Prometheus375_Task_Tracker.xlsx (the xlsx/shared sheet is the live source)
Statuses: Not started · Ongoing · Waiting on dependency · Blocked · In review · Testing · Finished · Dropped.
Owners: R = Rishitha (data + frontend), P = Poojitha (data + backend), K = Karthik (backend + repo & all deploys), S = Snehitha (frontend + backend).


## Kickoff
- [x] **K1** R — Fake sample parquet + CSV (contract columns, Punjab, 2 yrs) (help: Poojitha) — due Sat 10:00 — done (228366e)
- [x] **K2** P — Earthdata login + FIRMS MAP_KEY; share key privately with backend — due Sat 10:00 — done (covered by Rishitha)
- [x] **K3** P — Confirm FIRMS archive requests (India + 4 regions) submitted (help: Rishitha) — after K2 — due Sat 10:30 — done (covered by Rishitha; India + Brazil, Greece, Australia, California)
- [x] **K4** K — Create GitHub monorepo (repo + deploy owner), add all 4, commit AGENTS.md + coord pack; connect Render + Vercel to repo — due Sat 10:00
- [x] **K5** K — Freeze data format + API contract (help: Rishitha, Poojitha, Snehitha) — after K1 — due Sat 11:00

## Build 1
- [x] **D1** R — 01_clean.py: type=0, confidence filters, unify MODIS/VIIRS columns — after K3 — due Sat 13:00 — done (42ec022), all 5 regions
- [x] **D2** R — 02_grid.py: 0.25° cell x month x satellite counts (help: Poojitha) — after D1 — due Sat 15:00 — done 12:28 (a194171), all 5 regions, totals asserted. Non-India regions have no NOAA-20/21 (not downloaded, no zero rows) → SNPP is their only VIIRS.
- [x] **B1** K — FastAPI skeleton: /health, /presets, /calendar on sample data — after K1, K5 — due Sat 13:00 — done (147b37a)
- [x] **B2** K — DuckDB spatial polygon/bbox filter on cell centroids (help: Snehitha) — after B1 — due Sat 15:00 — done (346c0f9)
- [x] **F1** S — React+Vite shell, MapLibre map, presets dropdown, lat/long input — after K4 — due Sat 13:00 — done (0b9fbc6)
- [x] **F2** S — Polygon draw tool + typed api.ts client (mock JSON per contract) — after F1, K5 — due Sat 15:00 — done (0b9fbc6); mock used only when VITE_API_URL is empty

## Build 2
- [x] **D3** R — 03_satfix.py: per-satellite average; S-NPP vs NOAA-20/21 overlap check — after D2 — due Sat 17:00 — done 13:08 (e69d4e8). India overlap: SNPP/N20 median 0.976 r=0.998; N21/N20 0.941 r=0.999.
- [x] **D4** R — 04_fit.py: MODIS->VIIRS ratio per region x month-of-year (2012-2026) (help: Poojitha) — after D3 — due Sat 19:00 — done 14:06 (0de51d1). 2.5° zones + pb_hr zone, pooled ratio, 2020 excluded, bootstrap lo/hi. India pooled 11.4; pb_hr Oct 8.35, Nov 9.52. Outputs data/interim/fit_<region>.parquet + cell_zone_<region>.parquet. Needs numpy in requirements.txt.
- [x] **D5** P — 05_series.py + 06_validate.py: harmonized.parquet, 2020 holdout, metrics.json (help: Rishitha) — after D4 — due Sat 20:00 — done 14:53 (c762b1a), all 5 regions. harmonized.parquet 8.7M rows / 9.4 MB (zero rows kept, no nonzero version needed); before_after.parquet cell-level for /validation. Outputs in data/processed/ (gitignored — share via Drive / bundle for Render).
- [x] **D6** P — 07_anomaly.py + 08_onset.py: median/p10/p90/z, onset shift days — after D3 — due Sat 20:00 — done 15:30 by Rishitha (96a0709); outputs anomaly_<region>.parquet, onset_<region>.parquet, onset_daily_<region>.parquet in data/processed/
- [ ] **B3** K — /live: FIRMS NOAA-20 + NOAA-21 NRT, 30-min cache, snapshot fallback — after K2, B1 — due Sat 18:00
- [ ] **B4** P — /anomaly endpoint (reads anomaly table) (help: Karthik) — after D6, B2 — due Sat 20:00 — reassigned to Karthik 15:43, **Ongoing**
- [ ] **F3** R — Burning calendar heatmap (viridis/cividis, MODIS-estimated hatching) (help: Snehitha) — after F2, B1 — due Sat 20:00 — **Testing → ready for R to mark Finished**: checklist 11/11 pass on the real backend (I1 data), incl. #11 hatching 2001–2011 + Jan 2012 via /calendar; Brazil preset returns real data
- [x] **F4** S — Now-vs-normal card + time slider — after F2, B4 — due Sat 20:00 — done (6b417df): mock 6/6 + verified on Karthik's live /anomaly (cb92eb6) — slider, milestones, card follows month, badge hides off-mock, cell→slider, phone. Open backend issue: anomaly.py max(std, 1.0) gives z = −1262/−4823 with 1 prior year (sample data) → K

## Integration
- [x] **I1** K — Integration #1: real harmonized.parquet into backend + UI (help: Rishitha, Poojitha, Snehitha) — after D5, B2, F3 — due Sat 21:00 — done: real outputs in backend/data (ceece41, Rishitha) + backend wiring (fbe2e76, Karthik); UI verified on real data (F3 11/11, F4 6/6)

## Build 3
- [x] **D7** P — International regions: Amazon, California, Australia, Indonesia (help: Rishitha) — after D5 — due Sun 02:00 — done 15:46 via D1–D6 runs: Brazil (incl. Amazon), Australia, California, Greece; Indonesia dropped (never downloaded)
- [ ] **B5** K — /export.csv, /export_analytics.csv, /validation (help: Poojitha) — after D5, B2 — due Sat 23:00
- [ ] **B6** K — Deploy backend to Render (parquet bundled), share URL — after I1 — due Sat 23:30
- [ ] **F5** S — Live hotspots layer + download buttons — after B3, B5 — due Sun 01:00 — **Waiting on dependency**: live layer + CSV links built (0b9fbc6); test /live against B3, downloads wait on B5
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

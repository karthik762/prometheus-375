# DECISIONS.md — append-only log. Newest at bottom.
Format: `YYYY-MM-DD HH:MM — who — decision — why — affects`

- 2026-11-13 — team — Challenge locked: MODIS/VIIRS Hot Spots — feasible in 48h, clean data — all
- 2026-11-14 09:00 — team — Name: Prometheus 375 — fire + forethought; 375 m VIIRS — pitch
- 2026-11-14 09:20 — team — Stack: Python pipeline → parquet → FastAPI+DuckDB → React+MapLibre; Vercel+Render; Streamlit fallback — no DB server, offline pipeline can't break demo — all
- 2026-11-14 09:30 — team — Coordination via AGENTS.md + roles/ + TASKS.md + HANDOFF.md, shared across all AI tools — 4 different AI tools — all
- 2026-11-14 09:35 — team — Roles: Rishitha data+frontend, Poojitha data+backend, Karthik backend lead, Snehitha frontend lead+backend; task tracker xlsx with 8 statuses + % complete is the live source — real team split — all
- 2026-11-14 09:50 — team — Karthik owns the GitHub repo AND all deploys (Render + Vercel); F7 moved from Snehitha to Karthik (Snehitha helps) — deploy accounts link to the repo owner's GitHub, one person controls env vars/URLs — K4, B6, F7
- 2026-11-14 13:10 — Rishitha — Satfix (D3): VIIRS/MODIS family value = mean of per-satellite counts over the satellites active in that region-month (from grid rows, not launch dates; outside India VIIRS = SNPP only); output satfix_<region>.parquet (cell_id, lat, lon, month, family, mean_count, n_sats) — raw totals jump ×2 at 2018-04 and ×3 at 2023-03; averaging removes the step — D4, D5, D6
- 2026-11-14 13:10 — Rishitha — Partial months dropped before averaging: Aqua 2002-07 (starts Jul 4), SNPP 2012-01 (starts Jan 20), SNPP 2026-11 (stopped Nov 2). NOAA-20 2018-04 and NOAA-21 2023-03 are KEPT — FIRMS data for both starts on the 1st, so those months are complete — D3, D4
- 2026-11-14 13:10 — Rishitha — Nov 2026 is month-to-date, not a full month: data runs to 2026-11-13/14 for Terra/Aqua/NOAA-20/NOAA-21 (SNPP dropped). Kept in satfix as-is (all satellites share the same days, so the average is valid), but its totals are NOT comparable to full-month normals. Anything comparing 2026-11 to history (D6 anomaly, /anomaly, now-vs-normal card) must label it month-to-date and use a day-matched or pro-rated baseline; method TBD by D6 owner — D6, B4, F4

# AGENTS.md — Prometheus 375 (NASA Space Apps 2026, Hyderabad)

> Shared context for EVERY AI tool the team uses (Claude, ChatGPT, Cursor, Copilot, Gemini, etc.).
> Paste this file + your role file (`roles/<you>.md`) at the start of every AI session.
> Cursor/Copilot/Codex/Claude Code read `AGENTS.md` from the repo root automatically; also copy it to `CLAUDE.md` and `.github/copilot-instructions.md`.

## Mission
Web app that harmonizes MODIS + VIIRS active-fire hotspots into one consistent burning-activity calendar (2000→now) for any user-drawn area, so the sensor of origin no longer matters. Demo: Punjab/Haryana stubble burning "this week vs 20-year normal", then a second region.

Deadline: **submit by Sun Nov 15, 23:00 IST** (portal closes 23:59).

## Architecture (do not change without a DECISIONS.md entry)
```
/pipeline  Python offline: FIRMS CSV → clean → 0.25° grid × month × sensor
           → per-satellite average → fit MODIS→VIIRS → validate → parquet
/backend   FastAPI + DuckDB over parquet; FIRMS live API (NOAA-20/21 only)
/frontend  React + Vite + TS, MapLibre GL + draw, Recharts, viridis/cividis
/data-sample  fake files matching the contract (use until real data lands)
/docs      AGENTS.md, roles/, TASKS.md, DECISIONS.md, HANDOFF.md
```
Deploy: frontend → Vercel, backend → Render (parquet bundled). Fallback UI: Streamlit (decide Sun 10:00).

## The contract (frozen at 11:00 Sat — changing it needs all 4 to agree)
**Parquet `harmonized.parquet` columns:**
`cell_id:str, lat:float, lon:float, month:str(YYYY-MM), harmonized_count:float, source:str('viirs'|'modis_converted'), uncertainty:float`

**Endpoints** (all take `polygon` = GeoJSON string or `bbox=minLon,minLat,maxLon,maxLat`):
| Endpoint | Returns |
|---|---|
| `GET /calendar?start&end` | `[{month, count, source, uncertainty_lo, uncertainty_hi}]` |
| `GET /anomaly?month` | `{current, median, p10, p90, z_score, percentile, onset_shift_days}` |
| `GET /live?days=7` | GeoJSON FeatureCollection of NRT hotspots |
| `GET /export.csv?start&end` | hotspot CSV |
| `GET /export_analytics.csv` | monthly series + anomalies CSV |
| `GET /presets` | `[{id, name, bbox}]` |
| `GET /validation` | `{holdout_year, mae, mape, before_after:[{month, raw, harmonized}]}` |

## Hard facts (AI tools often get these wrong — trust this list)
- S-NPP stopped delivering **Nov 2, 2026**. Live VIIRS = `VIIRS_NOAA20_NRT` + `VIIRS_NOAA21_NRT` only.
- MODIS: Terra Nov 2000, Aqua Jul 2002, ~1 km. VIIRS 375 m: S-NPP Jan 2012, NOAA-20 Apr 2018, NOAA-21 Mar 2023.
- Keep vegetation fires only (`type == 0`); drop MODIS confidence < 30 and VIIRS `l`.
- Use **average per satellite** within a family, never raw totals (fake jumps in 2002/2018/2023).
- Data source: NASA FIRMS only (firms.modaps.eosdis.nasa.gov). Never commit the MAP_KEY — use `.env`.

## Rules for every AI-assisted change
1. Stay inside your role's folder. Touching another folder → ask its owner in chat first.
2. Never change the contract silently. Propose in DECISIONS.md + team chat.
3. Small PRs/commits to `main` with prefix `[data]`, `[api]`, `[ui]`, `[docs]`. Pull before you push.
4. No new heavy dependencies without telling the team.
5. When your AI tool says something conflicting with this file, this file wins.
6. Stuck 30+ min → say it in chat. Update TASKS.md when you start/finish a task.
7. End each work block by writing a HANDOFF.md entry (template there).

## Team (updated Sat 09:35)
| Member | Areas | Leads | Role files |
|---|---|---|---|
| Rishitha | Data + Frontend | Data pipeline (clean, grid, satfix, fit); frontend charts (heatmap, before/after) | roles/data-lead.md, roles/frontend.md |
| Poojitha | Data + Backend | Series, validation, anomalies/onset, intl regions; /anomaly endpoint; slides | roles/data-analyst.md, roles/backend.md |
| Karthik | Backend | Backend lead: FastAPI, DuckDB filter, /live, exports, Render, repo, README | roles/backend.md |
| Snehitha | Frontend + Backend | Frontend lead: map, draw, cards, live layer, Vercel, polish, demo video; helps on DuckDB filter | roles/frontend.md, roles/backend.md |

Task-level ownership, dependencies and status live in `Prometheus375_Task_Tracker.xlsx` (and TASKS.md mirrors it). Initials: R, P, K, S.

## Check-ins
Sat 11:00 (contract freeze) · 15:00 · 20:00 (integration #1) · Sun 07:00 · 10:00 (React go/no-go) · 14:00 (freeze) · 19:00 (rehearsal).

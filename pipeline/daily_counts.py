"""Shared helper for 07_anomaly.py and 08_onset.py: daily satellite-averaged counts.

Builds TEMP TABLE `daily` for one region:

  area_id, d (DATE), n_viirs, n_modis, viirs, modis_conv, modis_raw

  * Each hotspot from clean_<region>.parquet goes to its 0.25 deg cell (same
    centre / cell_id formula as 02_grid) and that cell's zone (cell_zone from 04_fit).
  * A satellite is active on day d if d is inside its global data window (first ->
    last acq_date over all regions' clean files) and the satellite appears in this
    region's clean file at all (outside India: no NOAA-20/21). A satellite with no
    fires on an active day counts as 0, as in 03_satfix's zero-filled average.
    Windows come from data, not launch dates: Aqua starts 2002-07-04, SNPP runs
    2012-01-20..2026-11-02.
  * viirs      = sum(VIIRS hotspots) / n_viirs                (NULL if n_viirs = 0)
    modis_raw  = sum(MODIS hotspots) / n_modis
    modis_conv = sum(MODIS hotspots * ratio(zone, month of d)) / n_modis   (D4 ratio)
  * Summed over a full month with no partial-satellite days this equals the
    05_series monthly total exactly (07_anomaly asserts it).

Areas (cell centre inside the box, as 04_fit's pb_hr zone): the whole region,
plus pb_hr for India.

Known gap: outages inside a satellite's window (e.g. a few safe-mode days) are
treated as active-with-zero-fires, as 03_satfix does at month level.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parents[1]
INTERIM = REPO_ROOT / "data" / "interim"
PROCESSED = REPO_ROOT / "data" / "processed"

CELL_DEG = 0.25
RETIRED = {"SNPP"}  # S-NPP stopped delivering 2026-11-02 (AGENTS.md hard facts)
PB_HR = {"lat": (27.5, 32.5), "lon": (73.5, 77.5)}  # same box as 04_fit


def q(path: Path) -> str:
    return "'" + str(path).replace("\\", "/").replace("'", "''") + "'"


def areas(region: str) -> list[tuple[str, str]]:
    """(area_id, SQL predicate on cell-centre columns clat/clon)."""
    out = [(region, "TRUE")]
    if region == "india":
        (a, b), (c, d) = PB_HR["lat"], PB_HR["lon"]
        out.append(("pb_hr", f"clat BETWEEN {a} AND {b} AND clon BETWEEN {c} AND {d}"))
    return out


def sat_windows(con: duckdb.DuckDBPyConnection) -> dict[str, tuple[str, dt.date, dt.date]]:
    """satellite -> (family, first date, last date), pooled over all regions' clean files."""
    files = sorted(INTERIM.glob("clean_*.parquet"))
    assert files, f"no clean_*.parquet in {INTERIM}"
    rows = con.execute(f"""
        SELECT satellite, lower(any_value(sensor_family)), min(acq_date), max(acq_date)
        FROM read_parquet([{', '.join(q(f) for f in files)}]) GROUP BY 1
    """).fetchall()
    return {s: (f, a, b) for s, f, a, b in rows}


def data_end(windows: dict) -> dt.date:
    """Last day every still-delivering satellite has data (excludes retired SNPP)."""
    return min(b for s, (_, _, b) in windows.items() if s not in RETIRED)


def build_daily(con: duckdb.DuckDBPyConnection, region: str, windows: dict, end: dt.date) -> None:
    clean = INTERIM / f"clean_{region}.parquet"
    cz = INTERIM / f"cell_zone_{region}.parquet"
    fit = INTERIM / f"fit_{region}.parquet"

    present = {r[0] for r in con.execute(
        f"SELECT DISTINCT satellite FROM read_parquet({q(clean)})").fetchall()}
    con.execute("CREATE OR REPLACE TEMP TABLE sw (satellite VARCHAR, family VARCHAR, d0 DATE, d1 DATE)")
    con.executemany("INSERT INTO sw VALUES (?, ?, ?, ?)",
                    [(s, f, a, b) for s, (f, a, b) in windows.items() if s in present])

    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE pts AS
        WITH p AS (
            SELECT floor(lat / {CELL_DEG}) * {CELL_DEG} + {CELL_DEG / 2} AS clat,
                   floor(lon / {CELL_DEG}) * {CELL_DEG} + {CELL_DEG / 2} AS clon,
                   acq_date AS d, lower(sensor_family) AS family
            FROM read_parquet({q(clean)}) WHERE acq_date <= DATE '{end}')
        SELECT p.*, printf('%.3f_%.3f', clat, clon) AS cell_id FROM p
    """)
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE pz AS
        SELECT p.clat, p.clon, p.d, p.family,
               CASE WHEN p.family = 'modis' THEN f.ratio ELSE 1.0 END AS w,
               z.zone_id
        FROM pts p
        LEFT JOIN read_parquet({q(cz)}) z USING (cell_id)
        LEFT JOIN read_parquet({q(fit)}) f
               ON f.zone_id = z.zone_id AND f.moy = month(p.d)
    """)
    no_zone, no_ratio = con.execute("""
        SELECT count(*) FILTER (WHERE zone_id IS NULL), count(*) FILTER (WHERE w IS NULL) FROM pz
    """).fetchone()
    assert no_zone == 0, f"[{region}] {no_zone:,} hotspots in cells missing from cell_zone"
    assert no_ratio == 0, f"[{region}] {no_ratio:,} MODIS hotspots without a D4 ratio"

    area_sql = " UNION ALL ".join(
        f"SELECT '{a}' AS area_id, d, family, count(*)::DOUBLE AS n, sum(w)::DOUBLE AS nw "
        f"FROM pz WHERE {pred} GROUP BY ALL" for a, pred in areas(region))
    area_ids = ", ".join(f"('{a}')" for a, _ in areas(region))
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE daily AS
        WITH agg AS ({area_sql}),
             days AS (SELECT unnest(generate_series((SELECT min(d0) FROM sw), DATE '{end}',
                                                    INTERVAL 1 DAY))::DATE AS d),
             act AS (SELECT days.d,
                            count(*) FILTER (WHERE sw.family = 'viirs')::INTEGER AS n_viirs,
                            count(*) FILTER (WHERE sw.family = 'modis')::INTEGER AS n_modis
                     FROM days LEFT JOIN sw ON days.d BETWEEN sw.d0 AND sw.d1 GROUP BY 1),
             ar AS (SELECT * FROM (VALUES {area_ids}) t(area_id))
        SELECT ar.area_id, act.d, act.n_viirs, act.n_modis,
               CASE WHEN act.n_viirs > 0 THEN coalesce(v.n, 0) / act.n_viirs END AS viirs,
               CASE WHEN act.n_modis > 0 THEN coalesce(m.nw, 0) / act.n_modis END AS modis_conv,
               CASE WHEN act.n_modis > 0 THEN coalesce(m.n, 0) / act.n_modis END AS modis_raw
        FROM ar CROSS JOIN act
        LEFT JOIN agg v ON v.area_id = ar.area_id AND v.d = act.d AND v.family = 'viirs'
        LEFT JOIN agg m ON m.area_id = ar.area_id AND m.d = act.d AND m.family = 'modis'
        ORDER BY ar.area_id, act.d
    """)
    # Every hotspot must land on a day with its family active.
    lost = con.execute("""
        SELECT count(*) FROM pz p WHERE NOT EXISTS (
            SELECT 1 FROM sw WHERE sw.family = p.family AND p.d BETWEEN sw.d0 AND sw.d1)
    """).fetchone()[0]
    assert lost == 0, f"[{region}] {lost:,} hotspots outside every window of their family"

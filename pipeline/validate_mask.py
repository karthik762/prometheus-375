"""Validate 01_clean.py's static-source mask variants for India.

Usage: python pipeline/validate_mask.py [--raw-dir PATH]

False positives: mask built from archive <= 2024, tested on VIIRS archive rows
2025-08-01..2025-11-30 (conf != 'l'). % NRT dropped: mask built from the full
archive (production setting) applied to India NRT rows after conf filtering.
"""
import argparse
import importlib.util
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("clean", REPO / "pipeline" / "01_clean.py")
clean = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clean)

PH = (73.8, 27.6, 77.6, 32.6)  # Punjab+Haryana bbox minLon,minLat,maxLon,maxLat
CONFIGS = [  # label, min_years, min_ratio, cell_deg
    ("no ratio (3y, 0.01)", 3, 0.0, 0.01),
    ("ratio 0.5 (default)", 3, 0.5, 0.01),
    ("+ratio 0.5 & 5y", 5, 0.5, 0.01),
    ("+ratio 0.5 & 0.005", 3, 0.5, 0.005),
]

ap = argparse.ArgumentParser()
ap.add_argument("--raw-dir", type=Path, default=clean.DEFAULT_RAW_DIR)
args = ap.parse_args()

jobs = [j for j in clean.discover(args.raw_dir) if j["region"] == "india"]
con = duckdb.connect()
con.execute("CREATE TABLE arch (lat DOUBLE, lon DOUBLE, yr INT, is_static BOOLEAN)")
con.execute("CREATE TABLE test (lat DOUBLE, lon DOUBLE, fire_type INT, in_ph BOOLEAN)")
con.execute("CREATE TABLE nrt (lat DOUBLE, lon DOUBLE)")
for j in jobs:
    src = clean.read_expr(j["path"])
    viirs = clean.PREFIX_SENSOR[j["prefix"]][0] == "VIIRS"
    conf_ok = ("lower(trim(confidence)) <> 'l'" if viirs
               else "TRY_CAST(confidence AS INTEGER) >= 30")
    if j["source"] == "archive":
        con.execute(f"""INSERT INTO arch SELECT latitude, longitude,
            year(CAST(acq_date AS DATE)), type IN (2, 3) FROM {src}""")
        if viirs:
            con.execute(f"""INSERT INTO test
                SELECT latitude, longitude, type,
                       longitude BETWEEN {PH[0]} AND {PH[2]} AND latitude BETWEEN {PH[1]} AND {PH[3]}
                FROM {src}
                WHERE CAST(acq_date AS DATE) BETWEEN DATE '2025-08-01' AND DATE '2025-11-30'
                  AND {conf_ok}""")
    else:
        con.execute(f"INSERT INTO nrt SELECT latitude, longitude FROM {src} WHERE {conf_ok}")


def mask_sql(min_years, min_ratio, cell, max_year):
    return f"""
        SELECT round(lat / {cell})::BIGINT AS i, round(lon / {cell})::BIGINT AS k
        FROM arch WHERE yr <= {max_year}
        GROUP BY 1, 2
        HAVING count(DISTINCT yr) FILTER (WHERE is_static) >= {min_years}
           AND count(*) FILTER (WHERE is_static) / count(*) >= {min_ratio}"""


def join(tbl, cell):
    return f"""SELECT t.*, (m.i IS NOT NULL) AS masked FROM {tbl} t
               LEFT JOIN m ON m.i = round(t.lat / {cell})::BIGINT
                          AND m.k = round(t.lon / {cell})::BIGINT"""


rows = []
for label, y, r, c in CONFIGS:
    hold = con.execute(f"""
        WITH m AS ({mask_sql(y, r, c, 2024)}), t AS ({join('test', c)})
        SELECT (SELECT count(*) FROM m),
               avg(masked::INT) FILTER (WHERE fire_type IN (2, 3)),
               count(*) FILTER (WHERE fire_type = 0 AND masked),
               avg(masked::INT) FILTER (WHERE fire_type = 0),
               count(*) FILTER (WHERE fire_type = 0 AND masked AND in_ph),
               avg(masked::INT) FILTER (WHERE fire_type = 0 AND in_ph)
        FROM t""").fetchone()
    prod = con.execute(f"""
        WITH m AS ({mask_sql(y, r, c, 9999)}), t AS ({join('nrt', c)})
        SELECT (SELECT count(*) FROM m), avg(masked::INT) FROM t""").fetchone()
    rows.append((label,) + prod + hold)

n_test, n_ph, n_nrt = con.execute("""SELECT (SELECT count(*) FROM test),
    (SELECT count(*) FROM test WHERE fire_type = 0 AND in_ph), (SELECT count(*) FROM nrt)""").fetchone()
print(f"\nHoldout: {n_test:,} India VIIRS archive rows 2025-08..11 (Punjab/Haryana type-0: {n_ph:,}); "
      f"NRT rows: {n_nrt:,}")
hdr = (f"{'config':<20}{'prod cells':>11}{'NRT drop':>9}{'2/3 caught':>11}"
       f"{'FP n':>7}{'FP %':>7}{'PH FP n':>8}{'PH FP %':>8}")
print(hdr + "\n" + "-" * len(hdr))
for (lab, pcells, nrtd, hcells, rec, fpn, fpp, phn, php) in rows:
    print(f"{lab:<20}{pcells:>11,}{nrtd*100:>8.1f}%{rec*100:>10.1f}%"
          f"{fpn:>7,}{fpp*100:>6.2f}%{phn:>8,}{php*100:>7.2f}%")

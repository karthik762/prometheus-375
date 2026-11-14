"""D1 - Clean raw NASA FIRMS active-fire CSVs into one parquet per region.

Reads DL_FIRE_<prefix>_<id>/fire_archive_*.csv and fire_nrt_*.csv from --raw-dir
(raw data stays OUTSIDE the repo), applies the AGENTS.md hard-fact filters, and
writes data/interim/clean_<region>.parquet + data/interim/clean_summary.csv.

Rules:
  * archive files: keep vegetation fires only (type == 0)
  * NRT files: no `type` column -> keep all, is_veg_filtered = False
  * MODIS: drop confidence < 30 (numeric 0-100)
  * VIIRS: drop confidence 'l' (values l/n/h)
  * drop exact duplicate rows
  * drop NRT rows dated on/before the last archive date of the same satellite
    (prevents double counting where archive and NRT overlap)
  * static-source mask: 0.01 deg locations where archive type 2/3 appears in
    >= 3 distinct years AND is >= 50% of all archive detections there
    -> data/interim/static_mask_<region>.parquet; NRT rows in a masked
    location are dropped (NRT has no `type` column)

Usage:
  python pipeline/01_clean.py                    # all regions
  python pipeline/01_clean.py --region india     # one region
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from pathlib import Path

import duckdb

DEFAULT_RAW_DIR = Path(r"C:\Users\sairi\Desktop\Prometheus_375")
REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = REPO_ROOT / "data" / "interim"

# FIRMS request id -> region
REQUEST_REGION = {
    "846539": "india", "846324": "india", "846540": "india", "846541": "india",
    "846572": "brazil", "846578": "brazil",
    "846576": "greece", "846577": "greece",
    "846589": "australia", "846593": "australia",
    "846639": "california", "846640": "california",
}
IGNORED_REQUESTS = {"846273"}  # old short MODIS NRT test download

# file prefix -> (sensor_family, satellite or None = take from `satellite` column)
PREFIX_SENSOR = {
    "M-C61": ("MODIS", None),
    "SV-C2": ("VIIRS", "SNPP"),
    "J1V-C2": ("VIIRS", "NOAA20"),
    "J2V-C2": ("VIIRS", "NOAA21"),
}
# raw `satellite` values seen in each prefix (checked, not assumed)
EXPECTED_RAW_SAT = {
    "M-C61": {"Terra", "Aqua"},
    "SV-C2": {"SNPP", "N"},
    "J1V-C2": {"N20", "1"},
    "J2V-C2": {"N21"},
}
REQUIRED_COLS = {"latitude", "longitude", "acq_date", "acq_time", "satellite",
                 "confidence", "frp", "daynight"}

# static-source mask: a MASK_CELL_DEG location is masked when archive type 2/3
# detections occur there in at least MASK_MIN_YEARS distinct calendar years AND
# make up at least MASK_MIN_RATIO of all archive detections at that location
MASK_CELL_DEG = 0.01
MASK_MIN_YEARS = 3
MASK_MIN_RATIO = 0.5

DIR_RE = re.compile(r"^DL_FIRE_(?P<prefix>[A-Z0-9]+-C\d+)_(?P<rid>\d+)$")


def q(path: Path) -> str:
    return "'" + str(path).replace("\\", "/").replace("'", "''") + "'"


def discover(raw_dir: Path) -> list[dict]:
    """List every CSV to process: region, prefix, source, path."""
    jobs = []
    for d in sorted(raw_dir.iterdir()):
        if not d.is_dir():
            continue
        m = DIR_RE.match(d.name)
        if not m:
            continue  # raw/, repo-update/, ... are not FIRMS downloads
        prefix, rid = m["prefix"], m["rid"]
        if rid in IGNORED_REQUESTS:
            print(f"skip {d.name} (ignored request id)")
            continue
        if rid not in REQUEST_REGION:
            print(f"WARNING: unknown request id {rid} in {d.name}; skipping")
            continue
        if prefix not in PREFIX_SENSOR:
            print(f"WARNING: unknown prefix {prefix} in {d.name}; skipping")
            continue
        for kind in ("archive", "nrt"):
            for f in sorted(d.glob(f"fire_{kind}_*.csv")):
                jobs.append({"region": REQUEST_REGION[rid], "prefix": prefix,
                             "source": kind, "path": f})
    return jobs


def read_expr(path: Path) -> str:
    # acq_time is zero-padded HHMM, confidence is numeric (MODIS) or l/n/h
    # (VIIRS): force both to text so nothing is silently re-typed.
    return (f"read_csv({q(path)}, header=true, auto_detect=true, "
            f"types={{'acq_time': 'VARCHAR', 'confidence': 'VARCHAR', "
            f"'version': 'VARCHAR', 'satellite': 'VARCHAR', 'daynight': 'VARCHAR'}})")


def inspect_file(con, job) -> set[str]:
    """Print real columns and value distributions; return the column set."""
    src = read_expr(job["path"])
    cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()]
    print(f"\n-- {job['path'].name}  [{job['region']} / {job['prefix']} / {job['source']}]")
    print(f"   columns: {cols}")
    missing = REQUIRED_COLS - set(cols)
    if missing:
        sys.exit(f"ERROR: {job['path']} missing columns {sorted(missing)}")
    if job["source"] == "archive" and "type" not in cols:
        sys.exit(f"ERROR: archive file {job['path']} has no `type` column")

    sats = con.execute(
        f"SELECT satellite, count(*) FROM {src} GROUP BY 1 ORDER BY 1").fetchall()
    print(f"   satellite values: {sats}")
    unexpected = {s for s, _ in sats} - EXPECTED_RAW_SAT[job["prefix"]]
    if unexpected:
        sys.exit(f"ERROR: unexpected satellite values {unexpected} in {job['path']}")

    if PREFIX_SENSOR[job["prefix"]][0] == "VIIRS":
        conf = con.execute(
            f"SELECT confidence, count(*) FROM {src} GROUP BY 1 ORDER BY 1").fetchall()
        print(f"   confidence values: {conf}")
    else:
        conf = con.execute(
            f"SELECT min(TRY_CAST(confidence AS INTEGER)), max(TRY_CAST(confidence AS INTEGER)), "
            f"count(*) FILTER (WHERE TRY_CAST(confidence AS INTEGER) IS NULL) FROM {src}").fetchone()
        print(f"   confidence min/max/non-numeric: {conf}")
    if "type" in cols:
        types = con.execute(f"SELECT type, count(*) FROM {src} GROUP BY 1 ORDER BY 1").fetchall()
        print(f"   type values: {types}")
    return set(cols)


def stage_file(con, job, cols: set[str]) -> None:
    """Append every raw row (normalized) to the staging table, with filter flags."""
    family, fixed_sat = PREFIX_SENSOR[job["prefix"]]
    sat_expr = (f"'{fixed_sat}'" if fixed_sat else
                "CASE satellite WHEN 'Terra' THEN 'Terra' WHEN 'Aqua' THEN 'Aqua' END")
    type_expr = "TRY_CAST(type AS INTEGER)" if "type" in cols else "NULL::INTEGER"
    if family == "MODIS":
        conf_ok = "coalesce(TRY_CAST(confidence AS INTEGER) >= 30, false)"
    else:
        conf_ok = "coalesce(lower(trim(confidence)) <> 'l', false)"
    con.execute(f"""
        INSERT INTO staged
        SELECT
            '{job['region']}'                    AS region,
            CAST(latitude AS DOUBLE)             AS lat,
            CAST(longitude AS DOUBLE)            AS lon,
            CAST(acq_date AS DATE)               AS acq_date,
            lpad(trim(acq_time), 4, '0')         AS acq_time,
            '{family}'                           AS sensor_family,
            {sat_expr}                           AS satellite,
            trim(confidence)                     AS confidence_raw,
            CAST(frp AS DOUBLE)                  AS frp,
            daynight,
            {'true' if job['source'] == 'archive' else 'false'} AS is_veg_filtered,
            '{job['source']}'                    AS source,
            {type_expr}                          AS fire_type,
            {conf_ok}                            AS conf_ok
        FROM {read_expr(job['path'])}
    """)


def clean_region(con, region: str, jobs: list[dict]) -> list[dict]:
    t0 = time.time()
    print(f"\n================ {region.upper()} ================")
    con.execute("DROP TABLE IF EXISTS staged")
    con.execute("""
        CREATE TABLE staged (
            region VARCHAR, lat DOUBLE, lon DOUBLE, acq_date DATE, acq_time VARCHAR,
            sensor_family VARCHAR, satellite VARCHAR, confidence_raw VARCHAR,
            frp DOUBLE, daynight VARCHAR, is_veg_filtered BOOLEAN, source VARCHAR,
            fire_type INTEGER, conf_ok BOOLEAN)
    """)
    for job in jobs:
        cols = inspect_file(con, job)
        stage_file(con, job, cols)

    # Step-wise filtering so every drop is counted.
    con.execute("""
        CREATE OR REPLACE TEMP TABLE f1 AS
        SELECT * FROM staged WHERE source = 'nrt' OR fire_type = 0
    """)
    con.execute("CREATE OR REPLACE TEMP TABLE f2 AS SELECT * FROM f1 WHERE conf_ok")
    con.execute("""
        CREATE OR REPLACE TEMP TABLE f3 AS
        SELECT DISTINCT region, lat, lon, acq_date, acq_time, sensor_family, satellite,
               confidence_raw, frp, daynight, is_veg_filtered, source
        FROM f2
    """)
    # Archive is authoritative: drop NRT rows inside the archive's date range.
    con.execute("""
        CREATE OR REPLACE TEMP TABLE arch_end AS
        SELECT satellite, max(acq_date) AS last_archive
        FROM f3 WHERE source = 'archive' GROUP BY 1
    """)
    con.execute("""
        CREATE OR REPLACE TEMP TABLE f4 AS
        SELECT f.* FROM f3 f LEFT JOIN arch_end a USING (satellite)
        WHERE f.source = 'archive' OR a.last_archive IS NULL OR f.acq_date > a.last_archive
    """)

    # Static-source mask: locations where archive type 2 (other static land
    # source) or 3 (offshore) shows up in >= MASK_MIN_YEARS distinct years and
    # is >= MASK_MIN_RATIO of all archive detections there. NRT has no `type`,
    # so this is how we keep industrial/gas-flare hotspots out of recent data.
    # Cells are integer keys round(coord / MASK_CELL_DEG); lat_r/lon_r = centre.
    cell = MASK_CELL_DEG
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE static_mask AS
        SELECT '{region}' AS region,
               round(lat / {cell})::BIGINT AS cell_i, round(lon / {cell})::BIGINT AS cell_k,
               round(cell_i * {cell}, 6) AS lat_r, round(cell_k * {cell}, 6) AS lon_r,
               count(DISTINCT year(acq_date)) FILTER (WHERE fire_type IN (2, 3)) AS n_years,
               count(*) FILTER (WHERE fire_type IN (2, 3)) AS n_static_detections,
               count(*) AS n_all_detections,
               n_static_detections / n_all_detections AS static_ratio,
               min(acq_date) FILTER (WHERE fire_type IN (2, 3)) AS first_seen,
               max(acq_date) FILTER (WHERE fire_type IN (2, 3)) AS last_seen
        FROM staged
        WHERE source = 'archive'
        GROUP BY cell_i, cell_k
        HAVING n_years >= {MASK_MIN_YEARS} AND static_ratio >= {MASK_MIN_RATIO}
        ORDER BY lat_r, lon_r
    """)
    mask_out = OUT_DIR / f"static_mask_{region}.parquet"
    con.execute(f"COPY static_mask TO {q(mask_out)} (FORMAT PARQUET, COMPRESSION ZSTD)")
    n_mask = con.execute("SELECT count(*) FROM static_mask").fetchone()[0]
    print(f"\nwrote {mask_out}  ({n_mask:,} masked {cell}-deg locations; "
          f"min_years={MASK_MIN_YEARS}, min_ratio={MASK_MIN_RATIO})")

    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE final AS
        SELECT f.* FROM f4 f
        WHERE f.source = 'archive' OR NOT EXISTS (
            SELECT 1 FROM static_mask m
            WHERE m.cell_i = round(f.lat / {cell})::BIGINT
              AND m.cell_k = round(f.lon / {cell})::BIGINT)
        ORDER BY acq_date, acq_time, satellite
    """)

    out = OUT_DIR / f"clean_{region}.parquet"
    con.execute(f"COPY final TO {q(out)} (FORMAT PARQUET, COMPRESSION ZSTD)")

    rows = con.execute("""
        WITH s AS (SELECT satellite, sensor_family, count(*) AS rows_in FROM staged GROUP BY ALL),
             a AS (SELECT satellite, count(*) AS n FROM f1 GROUP BY 1),
             b AS (SELECT satellite, count(*) AS n FROM f2 GROUP BY 1),
             c AS (SELECT satellite, count(*) AS n FROM f3 GROUP BY 1),
             d AS (SELECT satellite, count(*) AS n FROM f4 GROUP BY 1),
             k AS (SELECT satellite, count(*) AS n, min(acq_date) AS mn, max(acq_date) AS mx,
                          count(*) FILTER (WHERE source = 'nrt') AS nrt_kept
                   FROM final GROUP BY 1)
        SELECT s.satellite, s.sensor_family, s.rows_in,
               coalesce(k.n, 0)                         AS rows_kept,
               s.rows_in - coalesce(a.n, 0)             AS dropped_nonveg,
               coalesce(a.n, 0) - coalesce(b.n, 0)      AS dropped_lowconf,
               coalesce(b.n, 0) - coalesce(c.n, 0)      AS dropped_dupes,
               coalesce(c.n, 0) - coalesce(d.n, 0)      AS dropped_nrt_overlap,
               coalesce(d.n, 0) - coalesce(k.n, 0)      AS nrt_static_dropped,
               coalesce(k.nrt_kept, 0)                  AS nrt_rows_kept,
               k.mn AS min_date, k.mx AS max_date
        FROM s LEFT JOIN a USING (satellite) LEFT JOIN b USING (satellite)
               LEFT JOIN c USING (satellite) LEFT JOIN d USING (satellite)
               LEFT JOIN k USING (satellite)
        ORDER BY s.sensor_family, CASE s.satellite WHEN 'Terra' THEN 1 WHEN 'Aqua' THEN 2
                 WHEN 'SNPP' THEN 3 WHEN 'NOAA20' THEN 4 ELSE 5 END
    """).fetchall()
    cols = ["satellite", "sensor_family", "rows_in", "rows_kept", "dropped_nonveg",
            "dropped_lowconf", "dropped_dupes", "dropped_nrt_overlap", "nrt_static_dropped",
            "nrt_rows_kept",
            "min_date", "max_date"]
    summary = [{"region": region, **dict(zip(cols, r))} for r in rows]

    total = con.execute("SELECT count(*) FROM final").fetchone()[0]
    con.execute("DROP TABLE staged")
    print(f"\nwrote {out}  ({total:,} rows, {time.time() - t0:.0f}s)")
    return summary


def print_summary(summary: list[dict]) -> None:
    hdr = (f"{'region':<11}{'satellite':<9}{'rows_in':>12}{'rows_kept':>12}"
           f"{'nonveg':>11}{'lowconf':>10}{'dupes':>8}{'nrt_ovl':>9}{'nrt_static':>12}"
           f"  {'min_date':<11}{'max_date':<11}")
    print("\n" + hdr + "\n" + "-" * len(hdr))
    for s in summary:
        print(f"{s['region']:<11}{s['satellite']:<9}{s['rows_in']:>12,}{s['rows_kept']:>12,}"
              f"{s['dropped_nonveg']:>11,}{s['dropped_lowconf']:>10,}{s['dropped_dupes']:>8,}"
              f"{s['dropped_nrt_overlap']:>9,}{s['nrt_static_dropped']:>12,}"
              f"  {str(s['min_date']):<11}{str(s['max_date']):<11}")


def write_summary(summary: list[dict]) -> Path:
    """Merge into clean_summary.csv so single-region runs don't erase others."""
    path = OUT_DIR / "clean_summary.csv"
    done = {s["region"] for s in summary}
    old = []
    if path.exists():
        with path.open(newline="") as fh:
            old = [r for r in csv.DictReader(fh) if r["region"] not in done]
    fields = list(summary[0].keys())
    with path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(old + summary)
    return path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR,
                    help="folder containing the DL_FIRE_* download folders")
    ap.add_argument("--region", choices=sorted(set(REQUEST_REGION.values())),
                    help="clean only this region (default: all)")
    ap.add_argument("--threads", type=int, default=None, help="DuckDB threads")
    args = ap.parse_args()

    if not args.raw_dir.is_dir():
        sys.exit(f"ERROR: raw dir not found: {args.raw_dir}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    jobs = discover(args.raw_dir)
    regions = [args.region] if args.region else sorted({j["region"] for j in jobs})

    con = duckdb.connect()
    con.execute(f"SET temp_directory = {q(OUT_DIR / '.duckdb_tmp')}")
    con.execute("SET preserve_insertion_order = false")
    if args.threads:
        con.execute(f"SET threads = {args.threads}")

    summary = []
    for region in regions:
        rjobs = [j for j in jobs if j["region"] == region]
        if not rjobs:
            print(f"WARNING: no files found for region {region}")
            continue
        summary += clean_region(con, region, rjobs)

    if summary:
        print_summary(summary)
        print(f"\nsummary -> {write_summary(summary)}")


if __name__ == "__main__":
    main()

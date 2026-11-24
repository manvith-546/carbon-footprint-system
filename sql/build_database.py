"""
Builds sql/carbon.db (SQLite) from the CSV files and runs sql/queries.sql.
(The website's saved history uses a separate database, data/history.db - see sql/history.sql.)
SQLite ships with Python, so nothing extra has to be installed.

Run:  python sql/build_database.py
"""
import sqlite3
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def main():
    db = sqlite3.connect(HERE / "carbon.db")
    db.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))

    clustered = ROOT / "data" / "processed" / "bmw_mercedes_models_clustered.csv"
    plain = ROOT / "data" / "processed" / "bmw_mercedes_models.csv"
    vehicles = pd.read_csv(clustered if clustered.exists() else plain)
    vehicles.to_sql("vehicles", db, if_exists="append", index=False)
    pd.read_csv(ROOT / "data" / "processed" / "bmw_mercedes_evs.csv").to_sql("electric_vehicles", db, if_exists="append", index=False)
    pd.read_csv(ROOT / "data" / "eu_obfcm_bmw_mercedes_2021_2024.csv").to_sql("eu_fleet", db, if_exists="append", index=False)
    db.commit()
    print(f"Built {HERE / 'carbon.db'}")

    for block in (HERE / "queries.sql").read_text(encoding="utf-8").split("-- name:")[1:]:
        title, sql = block.split("\n", 1)
        print(f"\n== {title.strip()} ==")
        print(pd.read_sql_query(sql, db).to_string(index=False))
    db.close()


if __name__ == "__main__":
    main()

"""
Step 1 - Prepare the data.

Combines two sources of official Canadian CO2 ratings and keeps only BMW and
Mercedes-Benz:

  data/CO2_Emissions_Canada.csv               main dataset (Kaggle), model years 2014-2020
  data/canada_2021_2026_bmw_mercedes.csv      Government of Canada, model years 2021-2026

and the electric cars:

  data/canada_ev_2012_2026_bmw_mercedes.csv   Government of Canada, battery-electric

Cleaning: unify names and vehicle classes, remove duplicates, merge different
spellings of the same model, and drop ratings that break physics (CO2 is
proportional to the fuel burned, so CO2 / fuel must be about the same for
every car using the same fuel).

Writes:
  data/processed/bmw_mercedes_clean.csv   one row per rating (used for machine learning)
  data/processed/bmw_mercedes_models.csv  one row per model variant (estimator, website, Java)
  data/processed/bmw_mercedes_evs.csv     one row per electric model (latest model year)

Run:  python python/1_prepare_data.py
"""
from pathlib import Path

import re

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "processed"

KAGGLE_RENAME = {
    "Make": "make", "Model": "model", "Vehicle Class": "vehicle_class",
    "Engine Size(L)": "engine_l", "Cylinders": "cylinders", "Transmission": "transmission",
    "Fuel Type": "fuel_type", "Fuel Consumption City (L/100 km)": "fuel_city",
    "Fuel Consumption Hwy (L/100 km)": "fuel_hwy", "Fuel Consumption Comb (L/100 km)": "fuel_comb",
    "CO2 Emissions(g/km)": "co2_g_km",
}
CANADA_RENAME = {
    "Model year": "model_year", "Make": "make", "Model": "model", "Vehicle class": "vehicle_class",
    "Engine size (L)": "engine_l", "Cylinders": "cylinders", "Transmission": "transmission",
    "Fuel type": "fuel_type", "City (L/100 km)": "fuel_city", "Highway (L/100 km)": "fuel_hwy",
    "Combined (L/100 km)": "fuel_comb", "CO2 emissions (g/km)": "co2_g_km",
}
EV_RENAME = {
    "Model year": "model_year", "Make": "make", "Model": "model", "Vehicle class": "vehicle_class",
    "Motor (kW)": "motor_kw", "City (kWh/100 km)": "kwh_city", "Highway (kWh/100 km)": "kwh_hwy",
    "Combined (kWh/100 km)": "kwh_comb", "Range (km)": "range_km", "Recharge time (h)": "recharge_h",
}
COLUMNS = ["make", "model", "vehicle_class", "engine_l", "cylinders", "transmission", "fuel_type",
           "fuel_city", "fuel_hwy", "fuel_comb", "co2_g_km"]
FUEL_NAMES = {"Z": "Premium petrol", "X": "Regular petrol", "D": "Diesel",
              "E": "Ethanol (E85)", "N": "Natural gas"}
BRANDS = {"BMW": "BMW", "MERCEDES-BENZ": "Mercedes-Benz"}
KAGGLE_YEARS = (2014, 2020)


def vehicle_class(name):
    """'Sport utility vehicle: Small' (newer files) -> 'SUV - SMALL' (Kaggle style)."""
    name = str(name).strip().upper().replace("SPORT UTILITY VEHICLE", "SUV")
    return name.replace(": ", " - ")


def transmission_name(code):
    """'AS8' -> '8-speed automatic', 'M6' -> '6-speed manual', 'AV' -> 'CVT'."""
    code = str(code)
    kind = code.rstrip("0123456789")
    gears = code[len(kind):]
    if kind == "AV":
        return "CVT" if not gears else f"{gears}-speed CVT"
    label = {"A": "automatic", "AS": "automatic", "AM": "automated manual", "M": "manual"}.get(kind, code)
    return f"{gears}-speed {label}" if gears else label


PERFORMANCE = re.compile(
    r"\bAMG\b|\bMaybach\b|\bALPINA\b|\bCompetition\b"   # Mercedes-AMG, Maybach, ALPINA, M Competition
    r"|^M\d|\bM\d{1,3}[id]?\b|\bX\d M\b|^Z4 M",          # BMW M cars: M3, M240i, X5 M50i, X3 M, Z4 M40i
    re.IGNORECASE)
ALL_WHEEL_DRIVE = re.compile(r"xDrive|4MATIC|4x4", re.IGNORECASE)


def performance(model):
    """'yes' for performance versions (AMG, M, ALPINA, Maybach), read from the model name."""
    return "yes" if PERFORMANCE.search(model) else "no"


def all_wheel_drive(model):
    """'yes' for xDrive / 4MATIC / 4x4 models, read from the model name."""
    return "yes" if ALL_WHEEL_DRIVE.search(model) else "no"


def year_label(first, last):
    return str(int(first)) if first == last else f"{int(first)}–{int(last)}"


def load_combustion():
    kaggle = pd.read_csv(DATA / "CO2_Emissions_Canada.csv")
    print(f"Kaggle dataset: {len(kaggle)} rows, {kaggle['Make'].nunique()} makes")
    kaggle = kaggle[kaggle["Make"].isin(BRANDS)].rename(columns=KAGGLE_RENAME)[COLUMNS]
    kaggle["make"] = kaggle["make"].map(BRANDS)
    kaggle["model_year"] = pd.NA
    kaggle["source"] = "Kaggle 2014-2020"
    print(f"  BMW + Mercedes-Benz rows: {len(kaggle)}")

    newer = pd.read_csv(DATA / "canada_2021_2026_bmw_mercedes.csv").rename(columns=CANADA_RENAME)
    newer = newer[["model_year"] + COLUMNS]
    newer["make"] = newer["make"].str.upper().map(BRANDS)
    newer["vehicle_class"] = newer["vehicle_class"].map(vehicle_class)
    newer["source"] = "Canada 2021-2026"
    print(f"Government of Canada 2021-2026: {len(newer)} BMW + Mercedes-Benz rows")

    df = pd.concat([kaggle, newer], ignore_index=True)
    df["model"] = df["model"].str.strip().str.replace(r"\s+", " ", regex=True)
    print(f"Missing values in the ratings: {int(df[COLUMNS].isna().sum().sum())}")
    return df


def quality_check(df):
    """Drop ratings whose CO2 does not match the fuel burned (data-entry errors)."""
    ratio = df["co2_g_km"] / df["fuel_comb"]
    typical = ratio.groupby(df["fuel_type"]).transform("median")
    bad = (ratio / typical - 1).abs() > 0.08
    for _, r in df[bad].iterrows():
        print(f"  Dropped impossible rating: {r['model_year'] if pd.notna(r['model_year']) else 'Kaggle'} "
              f"{r['make']} {r['model']}: {r['co2_g_km']} g/km with {r['fuel_comb']} L/100 km "
              f"(expected about {typical[_] * r['fuel_comb']:.0f} g/km)")
    return df[~bad].reset_index(drop=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    df = load_combustion()

    # The same model is sometimes spelled with different capitals
    # ("X5 xDRIVE50i" / "X5 xDrive50i"): keep the most common spelling.
    df["model"] = df.groupby(df["model"].str.upper())["model"].transform(lambda s: s.mode().iloc[0])
    df = quality_check(df)
    df["fuel_name"] = df["fuel_type"].map(FUEL_NAMES)
    df["transmission_name"] = df["transmission"].map(transmission_name)
    # two features engineered from the model name, used by the machine-learning models
    df["performance"] = df["model"].map(performance)
    df["awd"] = df["model"].map(all_wheel_drive)

    # ---- rows for machine learning: one per distinct rating ------------------
    # Identical ratings repeated over several model years are the same car, so
    # they are kept once (otherwise the test set would contain copies of the
    # training rows).
    clean = df.drop_duplicates(subset=COLUMNS).reset_index(drop=True)
    print(f"Distinct ratings after removing duplicates: {len(clean)} "
          f"(Kaggle {int((clean['source'] == 'Kaggle 2014-2020').sum())}, "
          f"2021-2026 {int((clean['source'] == 'Canada 2021-2026').sum())})")
    clean.to_csv(OUT / "bmw_mercedes_clean.csv", index=False)

    # ---- model variants for the website --------------------------------------
    # Kaggle rows have no model year: average each variant over 2014-2020.
    # Newer rows: one variant per run of identical ratings, labelled with its years.
    keys = ["make", "model", "vehicle_class", "engine_l", "cylinders", "transmission",
            "transmission_name", "fuel_type", "fuel_name", "performance", "awd"]
    old = (df[df["source"] == "Kaggle 2014-2020"].groupby(keys, as_index=False)
           .agg(fuel_city=("fuel_city", "mean"), fuel_hwy=("fuel_hwy", "mean"),
                fuel_comb=("fuel_comb", "mean"), co2_g_km=("co2_g_km", "mean")))
    old["year_from"], old["year_to"] = KAGGLE_YEARS
    new = (df[df["source"] == "Canada 2021-2026"]
           .groupby(keys + ["fuel_city", "fuel_hwy", "fuel_comb", "co2_g_km"], as_index=False)
           .agg(year_from=("model_year", "min"), year_to=("model_year", "max")))
    models = pd.concat([old, new], ignore_index=True)
    models = models.round({"fuel_city": 1, "fuel_hwy": 1, "fuel_comb": 1, "co2_g_km": 0})
    models["co2_g_km"] = models["co2_g_km"].astype(int)
    models["year_from"] = models["year_from"].astype(int)
    models["year_to"] = models["year_to"].astype(int)
    models["years"] = [year_label(a, b) for a, b in zip(models["year_from"], models["year_to"])]
    models = models.sort_values(["make", "model", "year_from", "transmission"]).reset_index(drop=True)
    models.insert(0, "id", models.index + 1)
    order = ["id", "make", "model", "years", "year_from", "year_to", "vehicle_class", "engine_l",
             "cylinders", "transmission", "transmission_name", "fuel_type", "fuel_name",
             "performance", "awd", "fuel_city", "fuel_hwy", "fuel_comb", "co2_g_km"]
    models[order].to_csv(OUT / "bmw_mercedes_models.csv", index=False)
    print(f"Model variants: {len(models)} "
          f"({int((models['year_to'] >= 2021).sum())} from 2021-2026)")

    # ---- electric cars ---------------------------------------------------------
    ev = pd.read_csv(DATA / "canada_ev_2012_2026_bmw_mercedes.csv").rename(columns=EV_RENAME)
    ev["make"] = ev["make"].str.upper().map(BRANDS)
    ev["model"] = ev["model"].str.strip().str.replace(r"\s+", " ", regex=True).str.replace('"', "″")
    ev["model"] = ev["model"].str.replace(r"\s+\)", ")", regex=True)
    ev["vehicle_class"] = ev["vehicle_class"].map(vehicle_class)
    # keep each electric model's latest model year
    ev = ev.sort_values("model_year").groupby(["make", "model"], as_index=False).last()
    ev = ev.sort_values(["make", "kwh_comb", "model"]).reset_index(drop=True)
    ev.insert(0, "id", ev.index + 9001)   # ids that never clash with the petrol/diesel models
    ev_cols = ["id", "make", "model", "model_year", "vehicle_class", "motor_kw", "kwh_city", "kwh_hwy",
               "kwh_comb", "range_km", "recharge_h"]
    ev[ev_cols].to_csv(OUT / "bmw_mercedes_evs.csv", index=False)
    print(f"Electric models: {len(ev)} (latest model year of each), "
          f"{int((ev['model_year'] >= 2024).sum())} on sale from 2024 on")

    print(clean.groupby("make")["co2_g_km"].agg(["count", "mean", "min", "max"]).round(1))
    print(f"Saved to {OUT}")


if __name__ == "__main__":
    main()

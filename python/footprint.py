"""
Core logic: car carbon footprint estimation + hybrid recommendation.

  estimate(profile)   -> yearly CO2, fuel and fuel cost of the user's car, plus
                         everyday comparisons (trees, an average Indian, LPG cylinders)
  recommend(profile)  -> personalised suggestions ranked by yearly CO2 saving

The project covers BMW and Mercedes-Benz cars only.

How the estimate works
  The dataset rates every car in city driving and in highway driving
  (L/100 km). The user says what share of their driving is in the city, and
  the two ratings are blended:

      fuel  = share * fuel_city + (1 - share) * fuel_hwy          (L/100 km)
      CO2   = rated CO2 * fuel / fuel_comb                        (g/km)

  CO2 is proportional to the fuel burned, so scaling the rated combined CO2
  by the fuel ratio gives the CO2 for the user's own driving mix.

  Two ways to give the driving:
    mode "distance" - kilometres per month
    mode "fuel"     - the monthly fuel bill in rupees: litres = bill / price,
                      and kilometres = litres / fuel use. Everything else then
                      follows from those kilometres.

The recommender is a hybrid:
  * data-driven  - the cleanest BMW / Mercedes-Benz in the same vehicle class,
                   and the most efficient electric BMW / Mercedes-Benz of the
                   same body type, charged from India's grid
  * rule-based   - driving-habit rules, each with a calculated saving

The same formulas are implemented in java/CarbonFootprintApp.java and
web/footprint.js, so all three give the same numbers.
"""
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
MODELS_CSV = ROOT / "data" / "processed" / "bmw_mercedes_models.csv"
EVS_CSV = ROOT / "data" / "processed" / "bmw_mercedes_evs.csv"
FACTORS_CSV = ROOT / "data" / "emission_factors.csv"

DEFAULT_PROFILE = {
    "car_id": None,             # id from bmw_mercedes_models.csv (None = the sample car)
    "mode": "distance",         # "distance" or "fuel"
    "km_month": 1000,           # kilometres driven per month (mode "distance")
    "fuel_spend_month": 10000,  # rupees spent on fuel per month (mode "fuel")
    "city_share": 55,           # % of driving done in the city (55 = the official combined rating)
    "fuel_price": 100,          # rupees per litre
    "elec_price": 8,            # rupees per kWh, for the electric-car suggestion
}
EV_MIN_YEAR = 2024              # only suggest electric models still on sale


def load_factors(path=FACTORS_CSV):
    df = pd.read_csv(path)
    return dict(zip(df["key"], df["value"].astype(float)))


def load_models(path=MODELS_CSV):
    return pd.read_csv(path)


def load_evs(path=EVS_CSV):
    return pd.read_csv(path)


def default_car_id(models):
    """The sample car: the newest BMW X5 xDrive40i."""
    x5 = models[models["model"].str.upper() == "X5 XDRIVE40I"].sort_values(["year_to", "id"], ascending=[False, True])
    return int(x5.iloc[0]["id"]) if len(x5) else int(models.iloc[0]["id"])


def get_car(profile, models):
    car_id = profile.get("car_id") or default_car_id(models)
    return models.loc[models["id"] == int(car_id)].iloc[0]


def blended(car, city_share):
    """(fuel L/100 km, CO2 g/km) of a car for a given % of city driving."""
    s = min(100.0, max(0.0, float(city_share))) / 100
    fuel = s * car["fuel_city"] + (1 - s) * car["fuel_hwy"]
    return fuel, car["co2_g_km"] * fuel / car["fuel_comb"]


def blended_ev(ev, city_share):
    """kWh per 100 km of an electric car for a given % of city driving."""
    s = min(100.0, max(0.0, float(city_share))) / 100
    return s * ev["kwh_city"] + (1 - s) * ev["kwh_hwy"]


def km_per_month(p, car):
    """Kilometres a month, either given or worked out from the fuel bill."""
    if p["mode"] == "fuel":
        fuel, _ = blended(car, p["city_share"])
        litres = float(p["fuel_spend_month"]) / float(p["fuel_price"])
        return litres * 100 / fuel
    return float(p["km_month"])


def band(total_kg):
    """Project-defined bands for the yearly CO2 of one car."""
    if total_kg < 1500:
        return "Low"
    if total_kg < 3000:
        return "Moderate"
    if total_kg < 5000:
        return "High"
    return "Very high"


def estimate(profile, factors=None, models=None):
    p = {**DEFAULT_PROFILE, **profile}
    f = factors or load_factors()
    models = load_models() if models is None else models
    car = get_car(p, models)
    s = min(100.0, max(0.0, float(p["city_share"]))) / 100
    km_month = km_per_month(p, car)
    km_year = km_month * 12
    fuel, co2 = blended(car, p["city_share"])

    co2_per_litre_100km = car["co2_g_km"] / car["fuel_comb"]          # g/km per L/100 km
    city_kg = s * km_year * car["fuel_city"] * co2_per_litre_100km / 1000
    hwy_kg = (1 - s) * km_year * car["fuel_hwy"] * co2_per_litre_100km / 1000
    total = city_kg + hwy_kg
    litres = fuel * km_year / 100
    r = lambda v, d=1: round(float(v), d)
    return {
        "car": f"{car['make']} {car['model']} ({car['years']})",
        "km_month": r(km_month),
        "co2_g_km": r(co2),
        "fuel_l_100km": r(fuel, 2),
        "breakdown_kg": {"City driving": r(city_kg), "Highway driving": r(hwy_kg)},
        "total_kg": r(total),
        "total_tonnes": r(total / 1000, 2),
        "fuel_litres": r(litres),
        "fuel_cost": int(round(float(litres) * float(p["fuel_price"]))),
        "band": band(total),
        "comparisons": {
            "trees_to_absorb": r(total / f["tree_per_year"]),
            "share_of_average_indian": r(total / f["india_per_capita"], 3),
            "lpg_cylinders": r(total / f["lpg_cylinder"]),
        },
    }


def estimate_ev(profile, ev, km_month, factors):
    """Yearly CO2 and charging cost of an electric car on India's grid."""
    p = {**DEFAULT_PROFILE, **profile}
    kwh_year = blended_ev(ev, p["city_share"]) * km_month * 12 / 100
    return {"kwh_year": kwh_year, "total_kg": kwh_year * factors["grid_india"],
            "cost": kwh_year * float(p["elec_price"])}


def body_type(vehicle_class, model=""):
    """'suv' or 'car', used to match electric alternatives."""
    if re.search(r"SUV|SPECIAL", vehicle_class, re.I) or re.search(r"\bSUV\b|^iX|^EQB|^G 580", model):
        return "suv"
    return "car"


def best_alternative(car, models):
    """Cleanest BMW / Mercedes-Benz in the same vehicle class.
    E85 flex-fuel ratings are skipped: they are only valid when running on ethanol."""
    same = models[(models["vehicle_class"] == car["vehicle_class"]) &
                  (models["fuel_type"] != "E") &
                  (models["co2_g_km"] < car["co2_g_km"])]
    return None if same.empty else same.sort_values(["co2_g_km", "id"]).iloc[0]


def best_ev(car, evs):
    """Most efficient current electric BMW / Mercedes-Benz in the same vehicle class,
    or, if there is none, of the same body type (SUV or car)."""
    current = evs[evs["model_year"] >= EV_MIN_YEAR]
    pool = current[current["vehicle_class"] == car["vehicle_class"]]
    if pool.empty:
        want = body_type(car["vehicle_class"], car["model"])
        same_body = pd.Series([body_type(c, m) == want for c, m in zip(current["vehicle_class"], current["model"])],
                              index=current.index)
        pool = current[same_body]
    if pool.empty:
        return None
    pool = pool.assign(other_make=(pool["make"] != car["make"]).astype(int))
    return pool.sort_values(["kwh_comb", "other_make", "id"]).iloc[0]


def recommend(profile, factors=None, models=None, evs=None):
    """Suggestions sorted by yearly CO2 saving (kg), each with the money saved (rupees)."""
    p = {**DEFAULT_PROFILE, **profile}
    f = factors or load_factors()
    models = load_models() if models is None else models
    evs = load_evs() if evs is None else evs
    car = get_car(p, models)
    km_month = km_per_month(p, car)
    km_year = km_month * 12
    price = float(p["fuel_price"])
    fuel, co2 = blended(car, p["city_share"])
    total_kg = co2 * km_year / 1000
    cost = fuel * km_year / 100 * price
    tips = []

    def add(kind, title, text, kg, rupees):
        if kg > 0.5:
            tips.append({"kind": kind, "title": title, "tip": text,
                         "saving_kg": round(float(kg), 1), "saving_rupees": int(round(float(rupees)))})

    # ---- data-driven: an electric car ----------------------------------------
    ev = best_ev(car, evs)
    if ev is not None:
        e = estimate_ev(p, ev, km_month, f)
        add("ev", "Switch to an electric car",
            f"The {ev['make']} {ev['model']} ({int(ev['model_year'])}) uses {ev['kwh_comb']} kWh per 100 km. "
            f"Charged from India's grid it would emit about {e['total_kg']:.0f} kg of CO2 a year instead of "
            f"{total_kg:.0f} kg, and charging would cost about Rs {e['cost']:,.0f} a year.",
            total_kg - e["total_kg"], cost - e["cost"])

    # ---- data-driven: cleaner car in the same class ---------------------------
    alt = best_alternative(car, models)
    if alt is not None:
        a_fuel, a_co2 = blended(alt, p["city_share"])
        add("car", "Choose a cleaner car next time",
            f"In the same class, the {alt['make']} {alt['model']} ({alt['years']}) is rated "
            f"{int(alt['co2_g_km'])} g/km against {int(car['co2_g_km'])} g/km for your car.",
            (co2 - a_co2) * km_year / 1000, (fuel - a_fuel) * km_year / 100 * price)

    # ---- rules: driving habits ----------------------------------------------
    if km_month >= 800:
        add("habit", "Move one trip in five to bus or metro",
            "You drive a lot. Taking the bus or metro for a fifth of your kilometres still cuts emissions after counting the bus.",
            0.20 * km_year * (co2 / 1000 - f["bus"]), 0.20 * cost)
    add("habit", "Drive smoothly",
        "Accelerate gently, keep the tyres at the right pressure and switch off instead of idling. This saves about a tenth of your fuel.",
        f["eco_driving"] * total_kg, f["eco_driving"] * cost)
    add("habit", "Combine short trips",
        "Plan errands into one round and skip one drive in ten.",
        0.10 * total_kg, 0.10 * cost)
    if float(p["city_share"]) >= 70:
        hwy_like = car["co2_g_km"] * car["fuel_hwy"] / car["fuel_comb"]
        city_like = car["co2_g_km"] * car["fuel_city"] / car["fuel_comb"]
        add("habit", "Avoid rush-hour traffic",
            f"Your car emits {city_like:.0f} g/km in city traffic and {hwy_like:.0f} g/km on open roads. "
            "Shifting a tenth of your city driving to free-flowing hours or routes narrows that gap.",
            0.10 * (float(p["city_share"]) / 100) * km_year * (city_like - hwy_like) / 1000,
            0.10 * (float(p["city_share"]) / 100) * km_year * (car["fuel_city"] - car["fuel_hwy"]) / 100 * price)

    tips.sort(key=lambda t: -t["saving_kg"])
    return tips


if __name__ == "__main__":
    print(estimate({}))
    for t in recommend({}):
        print(f"- {t['title']}: {t['saving_kg']} kg, Rs {t['saving_rupees']} a year. {t['tip']}")
    print(estimate({"mode": "fuel", "fuel_spend_month": 8000}))

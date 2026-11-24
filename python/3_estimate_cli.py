"""
Step 3 - Estimate your car's footprint in the terminal.

Run:  python python/3_estimate_cli.py          (asks questions)
      python python/3_estimate_cli.py --demo   (uses the sample car)
"""
import sys

from footprint import (DEFAULT_PROFILE, ROOT, default_car_id, estimate, load_evs, load_factors,
                       load_models, recommend)


def ask(text, default, cast=float):
    raw = input(f"{text} [{default}]: ").strip()
    try:
        return cast(raw) if raw else default
    except ValueError:
        print("  Not a valid value, using the default.")
        return default


def choose_car(models):
    while True:
        word = input("Search your car model (e.g. X5, C 300, GLA): ").strip().upper()
        hits = models[models["model"].str.upper().str.contains(word, regex=False)].head(20) if word else models.head(0)
        if hits.empty:
            print("  No BMW / Mercedes-Benz model matches. Try a shorter name.")
            continue
        for _, r in hits.iterrows():
            print(f"  {r['id']:>4}  {r['make']} {r['model']} ({r['years']})  {r['engine_l']}L "
                  f"{r['transmission_name']}  {r['co2_g_km']} g/km")
        return ask("Type the id of your car", int(hits.iloc[0]["id"]), int)


def show(profile, factors, models, evs):
    r = estimate(profile, factors, models)
    car = models.loc[models["id"] == profile["car_id"]].iloc[0]
    print(f"\n================ {r['car'].upper()} ================")
    if profile.get("mode") == "fuel":
        print(f"Your fuel bill means about {r['km_month']:.0f} km a month in this car.")
    print(f"In your driving mix: {r['co2_g_km']} g CO2/km, {r['fuel_l_100km']} L/100 km")
    for name, kg in r["breakdown_kg"].items():
        bar = "#" * int(round(40 * kg / max(r["total_kg"], 1)))
        print(f"{name:<16}{kg:>9.1f} kg  {bar}")
    print(f"{'TOTAL':<16}{r['total_kg']:>9.1f} kg CO2 per year = {r['total_tonnes']} tonnes  ({r['band']})")
    print(f"Fuel: {r['fuel_litres']:.0f} litres a year, about Rs {r['fuel_cost']:,}")
    if "tier" in car:
        print(f"K-Means emission group of this car: {car['tier']}")
    cleaner = int((models["co2_g_km"] < car["co2_g_km"]).sum())
    print(f"{cleaner} of {len(models)} BMW / Mercedes-Benz models are rated lower.")

    c = r["comparisons"]
    print("\nThat is like:")
    print(f"  - the CO2 that {c['trees_to_absorb']:.0f} mature trees absorb in a year")
    print(f"  - {c['share_of_average_indian'] * 100:.0f}% of an average Indian's total yearly CO2")
    print(f"  - burning {c['lpg_cylinders']:.0f} domestic LPG cylinders")

    print("\n================ RECOMMENDATIONS ================")
    for n, t in enumerate(recommend(profile, factors, models, evs), 1):
        print(f"{n}. {t['title']}: saves about {t['saving_kg']:.0f} kg CO2 and Rs {t['saving_rupees']:,} a year.\n   {t['tip']}")
    print("\nNote: the savings overlap, so they do not add up exactly.")


def main():
    factors = load_factors()
    clustered = ROOT / "data" / "processed" / "bmw_mercedes_models_clustered.csv"
    models = load_models(clustered) if clustered.exists() else load_models()
    evs = load_evs()

    if "--demo" in sys.argv:
        profile = {**DEFAULT_PROFILE, "car_id": default_car_id(models)}
        print("Demo profile:", profile)
        show(profile, factors, models, evs)
        return

    print("Car Carbon Footprint Estimation and Recommendation System (BMW / Mercedes-Benz)")
    print("Press Enter to accept the value in [brackets].\n")
    d = DEFAULT_PROFILE
    p = {"car_id": choose_car(models)}
    p["fuel_price"] = ask("Fuel price in rupees per litre", d["fuel_price"])
    spend = input("Do you know your monthly fuel bill? Type it in rupees, or press Enter to give kilometres: ").strip()
    if spend:
        try:
            p["mode"], p["fuel_spend_month"] = "fuel", float(spend)
        except ValueError:
            print("  Not a number, asking for kilometres instead.")
    if p.get("mode") != "fuel":
        p["mode"] = "distance"
        p["km_month"] = ask("Kilometres driven per month", d["km_month"])
    p["city_share"] = ask("How much of your driving is in the city, in % (0-100)", d["city_share"])
    p["elec_price"] = ask("Electricity price in rupees per kWh (for the electric-car suggestion)", d["elec_price"])
    show({**d, **p}, factors, models, evs)


if __name__ == "__main__":
    main()

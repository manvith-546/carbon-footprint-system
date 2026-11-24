"""
Project tests. Run:  python tests/test_api.py

Checks that every part of the project works and gives the same answers:
  1. Flask API: /api/health, /api/predict (CO2 + emission group), /api/estimate
     (distance and fuel-bill modes), /api/history (save, list, delete), and that
     bad input is rejected
  2. Python estimator: the demo car (newest BMW X5 xDrive40i, 1000 km a month, 55% city)
  3. Website JavaScript: every script parses, and the estimator, recommendations and both in-browser models
     match Python and scikit-learn (needs Node.js; skipped if Node is not installed)
  4. Java console app: same demo estimate as Python (needs a JDK; skipped if not installed)

The history checks use a temporary database, so your own saved estimates are not touched.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))
os.environ["HISTORY_DB"] = str(Path(tempfile.mkdtemp()) / "history_test.db")
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def main():
    print("\n1. Flask API")
    import pandas as pd
    import app as server   # trains the models first if they are missing
    from footprint import default_car_id, estimate
    client = server.app.test_client()
    demo_id = default_car_id(server.models)
    expected_kg = estimate({"car_id": demo_id}, server.factors, server.models)["total_kg"]

    r = client.get("/api/health")
    check("GET /api/health", r.status_code == 200 and r.get_json()["status"] == "ok", str(r.get_json()))

    car = {"make": "BMW", "vehicle_class": "COMPACT", "transmission": "AS8", "fuel_type": "Z",
           "engine_l": 2.0, "cylinders": 4, "performance": "no", "awd": "yes"}
    r = client.post("/api/predict", json=car)
    body = r.get_json()
    expected = round(float(server.spec_model.predict(pd.DataFrame([car]))[0]), 1)
    group = str(server.tier_model.predict(pd.DataFrame([car]))[0])
    check("POST /api/predict (CO2 rating)", r.status_code == 200 and body["co2_g_km"] == expected, f"{body['co2_g_km']} g/km")
    check("POST /api/predict (emission group)", body.get("group") == group and
          abs(sum(body["group_probabilities"].values()) - 1) < 0.01, f"{body.get('group')} {body.get('group_probabilities')}")
    r = client.post("/api/predict", json={"make": "BMW"})
    check("POST /api/predict rejects missing fields", r.status_code == 400)

    r = client.post("/api/estimate", json={"car_id": demo_id, "km_month": 1000, "city_share": 55, "fuel_price": 100})
    est = r.get_json() if r.status_code == 200 else {}
    total = est.get("estimate", {}).get("total_kg")
    check("POST /api/estimate", total is not None and abs(total - expected_kg) < 0.1, f"{total} kg CO2 a year")
    kinds = [t["kind"] for t in est.get("recommendations", [])]
    check("Recommendations include an electric car", "ev" in kinds, ", ".join(kinds))
    check("Everyday comparisons", "trees_to_absorb" in est.get("estimate", {}).get("comparisons", {}))

    spend = 8000
    r = client.post("/api/estimate", json={"car_id": demo_id, "mode": "fuel", "fuel_spend_month": spend, "fuel_price": 100})
    e = r.get_json()["estimate"]
    check("Fuel-bill mode spends exactly the bill", abs(e["fuel_cost"] - spend * 12) < 2,
          f"{e['km_month']:.0f} km a month, Rs {e['fuel_cost']:,} a year")
    r = client.post("/api/estimate", json={"car_id": 99999})
    check("POST /api/estimate rejects an unknown car", r.status_code == 400)
    check("GET / serves the website", all(client.get(p).status_code == 200
                                          for p in ("/", "/details.html", "/report.html")))

    r1 = client.post("/api/history", json={"car_id": demo_id, "km_month": 1000, "note": "first"})
    r2 = client.post("/api/history", json={"car_id": demo_id, "km_month": 800})
    listed = client.get("/api/history").get_json()
    check("POST + GET /api/history", r1.status_code == 201 and r2.status_code == 201 and len(listed) == 2
          and abs(listed[0]["total_kg"] - expected_kg) < 0.1, f"{len(listed)} saved")
    d = client.delete(f"/api/history/{r1.get_json()['id']}")
    check("DELETE /api/history/<id>", d.status_code == 200 and len(client.get("/api/history").get_json()) == 1)
    check("DELETE an unknown entry gives 404", client.delete("/api/history/99999").status_code == 404)
    client.delete("/api/history")
    check("DELETE /api/history clears all", client.get("/api/history").get_json() == [])

    print("\n2. Python estimator")
    car_row = server.models.loc[server.models["id"] == demo_id].iloc[0]
    check("Demo estimate", 1000 < expected_kg < 5000,
          f"{car_row['make']} {car_row['model']} ({car_row['years']}): {expected_kg} kg CO2 a year")

    print("\n3. Website JavaScript")
    if shutil.which("node"):
        bad = [f for f in sorted((ROOT / "web").glob("*.js")) if f.name not in ("data.js", "model.js")
               and subprocess.run(["node", "--check", str(f)], capture_output=True).returncode != 0]
        check("Website scripts have no syntax errors", not bad, ", ".join(f.name for f in bad) or "all scripts")
        r = subprocess.run(["node", str(ROOT / "tests" / "check_consistency.js")], capture_output=True, text=True)
        check("Estimator and in-browser models match Python", r.returncode == 0,
              r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr.strip())
    else:
        print("  [SKIP] Node.js is not installed")

    print("\n4. Java console app")
    if shutil.which("javac") and shutil.which("java"):
        out_dir = ROOT / "java" / "out"
        c = subprocess.run(["javac", "-d", str(out_dir), str(ROOT / "java" / "CarbonFootprintApp.java")],
                           capture_output=True, text=True)
        if c.returncode != 0:
            check("Java compiles", False, c.stderr.strip()[:300])
        else:
            r = subprocess.run(["java", "-cp", str(out_dir), "CarbonFootprintApp", "--demo"],
                               capture_output=True, text=True, cwd=ROOT)
            m = re.search(r"TOTAL\s+([\d.]+) kg", r.stdout)
            java_total = float(m.group(1)) if m else None
            check("Java demo estimate equals Python", java_total is not None and abs(java_total - expected_kg) < 0.1,
                  f"{java_total} kg CO2 a year")
    else:
        print("  [SKIP] Java (JDK) is not installed")

    passed = sum(results)
    print(f"\n{passed} of {len(results)} checks passed.")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()

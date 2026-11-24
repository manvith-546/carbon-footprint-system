"""
Step 5 - Run the website with its Python backend (Flask).

  python python/app.py        then the browser opens http://127.0.0.1:8000

On the first run it trains the models automatically (about a minute).

Routes
  GET    /                    the estimator (web/index.html)
  GET    /details.html        data, models and method
  GET    /api/health          is the server running, which models are loaded
  POST   /api/predict         predict the CO2 rating (g/km) and emission group of a car from its specifications
                              body: {"make": "BMW", "vehicle_class": "COMPACT", "transmission": "AS8",
                                     "fuel_type": "Z", "engine_l": 2.0, "cylinders": 4,
                                     "performance": "no", "awd": "yes"}     (the last two are optional)
  POST   /api/estimate        yearly CO2, fuel, cost and everyday comparisons of a car + recommendations
                              body: {"car_id": 425, "km_month": 1000, "city_share": 55, "fuel_price": 100}
                              or, from the monthly fuel bill:
                                    {"car_id": 425, "mode": "fuel", "fuel_spend_month": 8000, "fuel_price": 100}
  GET    /api/history         saved estimates, oldest first
  POST   /api/history         save an estimate   body: a profile as for /api/estimate, plus an optional "note"
  DELETE /api/history/<id>    delete one saved estimate
  DELETE /api/history         delete all saved estimates

Options (environment variables)
  PORT=8001                 use another port
  NO_BROWSER=1              do not open the browser
  HISTORY_DB=path/to.db     where saved estimates are kept (default data/history.db)
"""
import os
import sqlite3
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
REQUIRED = [ROOT / "models" / "co2_spec_model.joblib",
            ROOT / "models" / "tier_classifier.joblib",
            ROOT / "data" / "processed" / "bmw_mercedes_models_clustered.csv",
            ROOT / "data" / "processed" / "bmw_mercedes_evs.csv"]
HISTORY_DB = Path(os.environ.get("HISTORY_DB", ROOT / "data" / "history.db"))

try:
    import joblib
    import pandas as pd
    from flask import Flask, jsonify, request, send_from_directory
except ImportError as err:
    sys.exit(f"Missing package: {err.name}. Install the packages first:\n"
             f"    {Path(sys.executable).name} -m pip install -r requirements.txt")

from footprint import DEFAULT_PROFILE, estimate, load_evs, load_factors, load_models, recommend


def ensure_models():
    """Trains the models the first time (they are not stored on GitHub)."""
    if all(p.exists() for p in REQUIRED):
        return
    print("First run: preparing the data and training the models (about a minute)...\n", flush=True)
    result = subprocess.run([sys.executable, str(ROOT / "run_all.py")], cwd=ROOT)
    if result.returncode != 0 or not all(p.exists() for p in REQUIRED):
        sys.exit("Training failed. Run  python run_all.py  to see the error.")


def db():
    con = sqlite3.connect(HISTORY_DB)
    con.row_factory = sqlite3.Row
    return con


def init_history():
    HISTORY_DB.parent.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.executescript((ROOT / "sql" / "history.sql").read_text(encoding="utf-8"))


ensure_models()
init_history()

app = Flask(__name__, static_folder=None)
spec_model = joblib.load(ROOT / "models" / "co2_spec_model.joblib")
tier_model = joblib.load(ROOT / "models" / "tier_classifier.joblib")
factors = load_factors()
models = load_models(ROOT / "data" / "processed" / "bmw_mercedes_models_clustered.csv")
evs = load_evs()
SPEC_FIELDS = {"make": str, "vehicle_class": str, "transmission": str, "fuel_type": str,
               "engine_l": float, "cylinders": int}
OPTIONAL_FIELDS = {"performance": "no", "awd": "no"}   # yes / no


def read_profile(body):
    """Validates a profile sent by the website; returns (profile, error message)."""
    try:
        car_id = int(body.get("car_id", 0))
    except (TypeError, ValueError):
        return None, "car_id must be a whole number"
    if car_id not in set(models["id"]):
        return None, f"Unknown car_id {car_id}. Use an id from the database (1 to {int(models['id'].max())})."
    profile = {**DEFAULT_PROFILE, "car_id": car_id}
    for key in ("km_month", "fuel_spend_month", "city_share", "fuel_price", "elec_price"):
        if key in body:
            try:
                profile[key] = float(body[key])
            except (TypeError, ValueError):
                return None, f"{key} must be a number"
    profile["mode"] = "fuel" if body.get("mode") == "fuel" else "distance"
    if profile["fuel_price"] <= 0:
        return None, "fuel_price must be more than 0"
    return profile, None


@app.get("/")
def index():
    return send_from_directory(WEB, "index.html")


@app.get("/<path:name>")
def static_files(name):
    return send_from_directory(WEB, name)


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "model": type(spec_model.named_steps["model"]).__name__,
                    "classifier": type(tier_model.named_steps["model"]).__name__,
                    "cars": int(len(models)), "electric_cars": int(len(evs)), "history": True})


@app.post("/api/predict")
def predict():
    body = request.get_json(force=True, silent=True) or {}
    try:
        values = {k: cast(body[k]) for k, cast in SPEC_FIELDS.items()}
    except (KeyError, ValueError, TypeError) as err:
        return jsonify({"error": f"Missing or invalid field: {err}",
                        "expected": list(SPEC_FIELDS) + list(OPTIONAL_FIELDS)}), 400
    for k, default in OPTIONAL_FIELDS.items():
        values[k] = "yes" if str(body.get(k, default)).lower() in ("yes", "true", "1") else "no"
    row = pd.DataFrame([values])
    co2 = float(spec_model.predict(row)[0])
    probs = tier_model.predict_proba(row)[0]
    classes = [str(c) for c in tier_model.classes_]
    return jsonify({"co2_g_km": round(co2, 1), "model": type(spec_model.named_steps["model"]).__name__,
                    "group": classes[int(probs.argmax())],
                    "group_probabilities": {c: round(float(p), 4) for c, p in zip(classes, probs)},
                    "classifier": type(tier_model.named_steps["model"]).__name__})


@app.post("/api/estimate")
def api_estimate():
    profile, error = read_profile(request.get_json(force=True, silent=True) or {})
    if error:
        return jsonify({"error": error}), 400
    return jsonify({"profile": profile, "estimate": estimate(profile, factors, models),
                    "recommendations": recommend(profile, factors, models, evs)})


@app.get("/api/history")
def history_list():
    with db() as con:
        rows = con.execute("SELECT * FROM estimates ORDER BY saved_at, id").fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/history")
def history_add():
    body = request.get_json(force=True, silent=True) or {}
    profile, error = read_profile(body)
    if error:
        return jsonify({"error": error}), 400
    e = estimate(profile, factors, models)
    note = str(body.get("note", ""))[:200] or None
    with db() as con:
        cur = con.execute(
            "INSERT INTO estimates (car_id, car, mode, km_month, city_share, fuel_price, total_kg, fuel_cost, note)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (profile["car_id"], e["car"], profile["mode"], round(e["km_month"], 1), profile["city_share"],
             profile["fuel_price"], e["total_kg"], e["fuel_cost"], note))
        row = con.execute("SELECT * FROM estimates WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.delete("/api/history/<int:entry_id>")
def history_delete(entry_id):
    with db() as con:
        deleted = con.execute("DELETE FROM estimates WHERE id = ?", (entry_id,)).rowcount
    return (jsonify({"deleted": entry_id}), 200) if deleted else (jsonify({"error": "No such entry"}), 404)


@app.delete("/api/history")
def history_clear():
    with db() as con:
        n = con.execute("DELETE FROM estimates").rowcount
    return jsonify({"deleted": n})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    url = f"http://127.0.0.1:{port}"
    print("\n  Carbon Footprint Estimation and Recommendation System")
    print(f"  Website running at {url}")
    print(f"  Saved estimates are kept in {HISTORY_DB}")
    print("  Press Ctrl+C to stop.\n", flush=True)
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    try:
        app.run(host="127.0.0.1", port=port, debug=False)
    except OSError as err:
        sys.exit(f"Port {port} is busy ({err}). Close the other program or run with another port, "
                 f"for example:  PORT=8001 python python/app.py   (Windows PowerShell: $env:PORT=8001; python python/app.py)")

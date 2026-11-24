"""
Step 4 - Export everything the website needs.

  web/data.js    cars, electric cars, emission factors, EU fleet records and ML metrics
  web/model.js   the two trained models, so the CO2 predictor and the emission-group
                 classifier on web/details.html run in the browser (no server needed,
                 which is what lets the site work on GitHub Pages)
  tests/fixtures/predictions.json   sample cars with the scikit-learn answers
  tests/fixtures/estimates.json     sample profiles with the Python estimator's answers
                 Both are used by tests/check_consistency.js to prove that the
                 browser gives the same answers as Python.

The website then works by simply opening web/index.html in a browser.
Run this again whenever the data or the models change.

Run:  python python/4_export_web_data.py
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import (GradientBoostingClassifier, GradientBoostingRegressor,
                              RandomForestClassifier, RandomForestRegressor)
from sklearn.linear_model import LinearRegression, LogisticRegression

from footprint import default_car_id, estimate, load_evs, load_factors, recommend

ROOT = Path(__file__).resolve().parent.parent
SPEC_INPUTS = ["make", "vehicle_class", "transmission", "fuel_type", "performance", "awd",
               "engine_l", "cylinders"]


def compact_tree(tree, classes=None):
    """A decision tree as plain arrays: left child, right child, feature, threshold, leaf value(s)."""
    leaf = tree.children_left == -1
    if classes is None:
        values = [float(v) if is_leaf else 0 for v, is_leaf in zip(tree.value[:, 0, 0], leaf)]
    else:   # class probabilities of each leaf
        values = [[float(x) for x in (row / row.sum())] if is_leaf else 0 for row, is_leaf in zip(tree.value[:, 0, :], leaf)]
    return {"l": tree.children_left.tolist(), "r": tree.children_right.tolist(),
            "f": [int(v) for v in tree.feature], "t": [float(v) for v in tree.threshold], "v": values}


def export_pipeline(pipe):
    """Turns a scikit-learn pipeline (scaler + one-hot encoder + model) into JSON, or None."""
    pre, est = pipe.named_steps["pre"], pipe.named_steps["model"]
    scaler, encoder = pre.named_transformers_["num"], pre.named_transformers_["cat"]
    out = {
        "algorithm": type(est).__name__,
        "num": list(pre.transformers_[0][2]), "mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist(),
        "cat": list(pre.transformers_[1][2]), "categories": [c.tolist() for c in encoder.categories_],
    }
    n_features = len(out["num"]) + sum(len(c) for c in out["categories"])
    if isinstance(est, GradientBoostingRegressor):
        out.update(kind="gradient_boosting", base=float(np.ravel(est.init_.constant_)[0]),
                   rate=float(est.learning_rate), trees=[compact_tree(s[0].tree_) for s in est.estimators_])
    elif isinstance(est, RandomForestRegressor):
        out.update(kind="random_forest", trees=[compact_tree(t.tree_) for t in est.estimators_])
    elif isinstance(est, LinearRegression):
        out.update(kind="linear", coef=est.coef_.tolist(), intercept=float(est.intercept_))
    elif isinstance(est, GradientBoostingClassifier):
        base = est._raw_predict_init(np.zeros((1, n_features), dtype=np.float32))[0]
        out.update(kind="gradient_boosting_classifier", classes=est.classes_.tolist(), base=base.tolist(),
                   rate=float(est.learning_rate),
                   trees=[[compact_tree(t.tree_) for t in stage] for stage in est.estimators_])
    elif isinstance(est, RandomForestClassifier):
        out.update(kind="random_forest_classifier", classes=est.classes_.tolist(),
                   trees=[compact_tree(t.tree_, est.classes_) for t in est.estimators_])
    elif isinstance(est, LogisticRegression):
        out.update(kind="logistic_classifier", classes=est.classes_.tolist(),
                   coef=est.coef_.tolist(), intercept=est.intercept_.tolist())
    else:
        return None
    return out


# ---- the same arithmetic as web/predictor.js, to check the export before writing it ----
def features(spec, row):
    x = [(float(row[c]) - m) / s for c, m, s in zip(spec["num"], spec["mean"], spec["scale"])]
    for c, cats in zip(spec["cat"], spec["categories"]):
        x += [1.0 if str(row[c]) == str(v) else 0.0 for v in cats]
    return x


def walk(t, x):
    n = 0
    while t["l"][n] != -1:
        n = t["l"][n] if float(np.float32(x[t["f"][n]])) <= t["t"][n] else t["r"][n]
    return t["v"][n]


def softmax(z):
    z = np.array(z) - max(z)
    e = np.exp(z)
    return (e / e.sum()).tolist()


def js_like(spec, row):
    x = features(spec, row)
    k = spec["kind"]
    if k == "linear":
        return spec["intercept"] + sum(a * b for a, b in zip(x, spec["coef"]))
    if k == "gradient_boosting":
        y = spec["base"]
        for t in spec["trees"]:
            y += spec["rate"] * walk(t, x)
        return y
    if k == "random_forest":
        return sum(walk(t, x) for t in spec["trees"]) / len(spec["trees"])
    if k == "logistic_classifier":
        return softmax([b + sum(a * v for a, v in zip(w, x)) for w, b in zip(spec["coef"], spec["intercept"])])
    if k == "gradient_boosting_classifier":
        raw = list(spec["base"])
        for stage in spec["trees"]:
            for j, t in enumerate(stage):
                raw[j] += spec["rate"] * walk(t, x)
        return softmax(raw)
    if k == "random_forest_classifier":
        probs = np.zeros(len(spec["classes"]))
        for t in spec["trees"]:
            probs += np.array(walk(t, x))
        return (probs / len(spec["trees"])).tolist()
    raise ValueError(k)


def checked_export(pipe, sample, label):
    spec = export_pipeline(pipe)
    if spec is None:
        print(f"  {label}: model type {type(pipe.named_steps['model']).__name__} is not exported")
        return None, None
    if "classes" in spec:
        py = pipe.predict_proba(sample)
        mine = np.array([js_like(spec, r) for _, r in sample.iterrows()])
    else:
        py = pipe.predict(sample)
        mine = np.array([js_like(spec, r) for _, r in sample.iterrows()])
    worst = float(np.max(np.abs(py - mine)))
    if worst > 1e-6:
        raise SystemExit(f"{label}: browser export does not match scikit-learn (max difference {worst})")
    print(f"  {label}: {spec['algorithm']}, checked against scikit-learn on {len(sample)} cars "
          f"(max difference {worst:.1e})")
    return spec, py


def main():
    models = pd.read_csv(ROOT / "data" / "processed" / "bmw_mercedes_models_clustered.csv")
    evs = load_evs()
    factors = pd.read_csv(ROOT / "data" / "emission_factors.csv")
    eu = pd.read_csv(ROOT / "data" / "eu_obfcm_bmw_mercedes_2021_2024.csv")
    metrics = json.loads((ROOT / "reports" / "metrics.json").read_text())
    f = dict(zip(factors["key"], factors["value"].astype(float)))

    data = {
        "models": models.to_dict(orient="records"),
        "evs": evs.to_dict(orient="records"),
        "factors": f,
        "factorTable": factors.to_dict(orient="records"),
        "eu": eu.to_dict(orient="records"),
        "metrics": metrics,
        "defaultCarId": default_car_id(models),
    }
    out = ROOT / "web" / "data.js"
    out.write_text("// Generated by python/4_export_web_data.py - do not edit by hand\n"
                   "window.CFS_DATA = " + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";\n",
                   encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size / 1024:.0f} KB): {len(models)} models, {len(evs)} electric models, "
          f"{len(eu)} EU fleet records")

    # ---- the two models for the browser ------------------------------------------
    clean = pd.read_csv(ROOT / "data" / "processed" / "bmw_mercedes_clean.csv")
    sample = clean.drop_duplicates(SPEC_INPUTS).sample(n=min(80, len(clean)), random_state=7)[SPEC_INPUTS]
    unseen = pd.DataFrame([  # combinations that are not in the data, including an unknown gearbox
        {"make": "BMW", "vehicle_class": "TWO-SEATER", "transmission": "AS8", "fuel_type": "D",
         "performance": "yes", "awd": "no", "engine_l": 3.5, "cylinders": 6},
        {"make": "Mercedes-Benz", "vehicle_class": "COMPACT", "transmission": "XYZ", "fuel_type": "Z",
         "performance": "no", "awd": "yes", "engine_l": 1.6, "cylinders": 4},
    ])
    sample = pd.concat([sample, unseen], ignore_index=True)
    reg, reg_py = checked_export(joblib.load(ROOT / "models" / "co2_spec_model.joblib"), sample, "CO2 regression")
    cls_pipe = joblib.load(ROOT / "models" / "tier_classifier.joblib")
    cls, cls_py = checked_export(cls_pipe, sample, "Emission-group classifier")

    model_js = ROOT / "web" / "model.js"
    model_js.write_text("// Generated by python/4_export_web_data.py - do not edit by hand\n"
                        "window.CFS_MODEL = " + json.dumps(reg, separators=(",", ":")) + ";\n"
                        "window.CFS_CLASSIFIER = " + json.dumps(cls, separators=(",", ":")) + ";\n",
                        encoding="utf-8")
    print(f"Wrote {model_js} ({model_js.stat().st_size / 1024:.0f} KB)")

    fixtures = ROOT / "tests" / "fixtures"
    fixtures.mkdir(parents=True, exist_ok=True)
    rows = sample.to_dict(orient="records")
    for i, r in enumerate(rows):
        r["engine_l"], r["cylinders"] = float(r["engine_l"]), int(r["cylinders"])
        if reg is not None:
            r["expected_co2_g_km"] = float(reg_py[i])
        if cls is not None:
            r["expected_group_probabilities"] = dict(zip(cls["classes"], [float(v) for v in cls_py[i]]))
    (fixtures / "predictions.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")

    # ---- estimator answers for the consistency test ------------------------------------
    base = default_car_id(models)
    pick = lambda name: int(models[models["model"] == name].sort_values("year_to").iloc[-1]["id"])
    profiles = [
        {"car_id": base},
        {"car_id": base, "mode": "fuel", "fuel_spend_month": 8000, "fuel_price": 102},
        {"car_id": pick("C 300 4MATIC Sedan"), "km_month": 2500, "city_share": 85, "elec_price": 10},
        {"car_id": pick("Z4 M40i"), "km_month": 400, "city_share": 20},
        {"car_id": pick("AMG G 63 SUV"), "mode": "fuel", "fuel_spend_month": 30000, "city_share": 70},
    ]
    cases = []
    for p in profiles:
        e = estimate(p, f, models)
        tips = recommend(p, f, models, evs)
        cases.append({"profile": p, "total_kg": e["total_kg"], "km_month": e["km_month"],
                      "fuel_cost": e["fuel_cost"], "comparisons": e["comparisons"],
                      "tips": [{"kind": t["kind"], "kg": t["saving_kg"], "rupees": t["saving_rupees"]} for t in tips]})
    (fixtures / "estimates.json").write_text(json.dumps(cases, indent=1), encoding="utf-8")
    print(f"Wrote test fixtures: {len(rows)} predictions, {len(cases)} estimates")


if __name__ == "__main__":
    main()

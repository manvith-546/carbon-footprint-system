"""
Step 2 - Train the machine-learning models.

  A. Regression  - predict CO2 (g/km) of a BMW / Mercedes-Benz car
       "spec" model : from engine size, cylinders, class, transmission, fuel, make,
                      performance version and all-wheel drive (the last two are
                      read from the model name). Works when the fuel use is NOT known.
       "full" model : same + combined fuel consumption (almost exact, because
                      CO2 is physically proportional to the fuel burned)
     Linear Regression, Random Forest and Gradient Boosting are compared.
  B. Clustering  - K-Means groups the cars into Low / Medium / High emission tiers.
  C. Classification - predict a car's emission group (Low / Medium / High) from
     its specifications alone. Logistic Regression, Random Forest and Gradient
     Boosting are compared; accuracy, macro F1 and a confusion matrix are reported.

Outputs: models/*.joblib, reports/metrics.json, reports/*.png,
         data/processed/bmw_mercedes_models_clustered.csv

Run:  python python/2_train_models.py
"""
import json
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (GradientBoostingClassifier, GradientBoostingRegressor,
                              RandomForestClassifier, RandomForestRegressor)
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score, mean_absolute_error,
                             r2_score, root_mean_squared_error, silhouette_score)
from sklearn.model_selection import GroupKFold, GroupShuffleSplit, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "processed"
MODELS = ROOT / "models"
REPORTS = ROOT / "reports"
SEED = 42

CAT = ["make", "vehicle_class", "transmission", "fuel_type", "performance", "awd"]
NUM_SPEC = ["engine_l", "cylinders"]
NUM_FULL = NUM_SPEC + ["fuel_comb"]
TARGET = "co2_g_km"
CLUSTER_FEATURES = ["engine_l", "cylinders", "fuel_comb", "co2_g_km"]

# Chart colours (colour-blind-safe pair): BMW blue, Mercedes-Benz orange
BLUE, ORANGE, INK, GRID = "#2a78d6", "#eb6834", "#1d2b30", "#d9dedd"
plt.rcParams.update({"font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": INK,
                     "xtick.color": "#52605f", "ytick.color": "#52605f",
                     "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
                     "axes.axisbelow": True, "figure.dpi": 130})


def make_pipeline(model, num_cols):
    pre = ColumnTransformer([
        ("num", StandardScaler(), num_cols),
        ("cat", OneHotEncoder(handle_unknown="ignore"), CAT),
    ])
    return Pipeline([("pre", pre), ("model", model)])


# The forests are kept small (100 trees, 6 levels) so that whichever model wins can be
# exported to web/model.js and run in the browser, which is what lets the website work
# on GitHub Pages without the Python server.
def candidates():
    return {
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(n_estimators=100, max_depth=6, random_state=SEED),
        "Gradient Boosting": GradientBoostingRegressor(random_state=SEED),
    }


def evaluate(df, num_cols, label):
    X, y = df[num_cols + CAT], df[TARGET]
    # Split by model name: the same model appears in several model years, so
    # all rows of one model go to the same side. The test cars are truly unseen.
    groups = df["make"] + " " + df["model"].str.upper()
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED).split(X, y, groups))
    X_tr, X_te, y_tr, y_te, g_tr = X.iloc[tr], X.iloc[te], y.iloc[tr], y.iloc[te], groups.iloc[tr]
    cv = GroupKFold(n_splits=5)
    rows, fitted = [], {}
    for name, model in candidates().items():
        pipe = make_pipeline(model, num_cols)
        cv_r2 = cross_val_score(pipe, X_tr, y_tr, cv=cv, groups=g_tr, scoring="r2").mean()
        pipe.fit(X_tr, y_tr)
        pred = pipe.predict(X_te)
        rows.append({
            "model": name,
            "cv_r2": round(float(cv_r2), 4),
            "test_r2": round(float(r2_score(y_te, pred)), 4),
            "test_mae": round(float(mean_absolute_error(y_te, pred)), 2),
            "test_rmse": round(float(root_mean_squared_error(y_te, pred)), 2),
        })
        fitted[name] = (pipe, pred)
    best = max(rows, key=lambda r: r["cv_r2"])["model"]   # chosen on CV, not on the test set
    print(f"\n{label} model  (train {len(X_tr)}, test {len(X_te)})")
    print(pd.DataFrame(rows).to_string(index=False))
    print(f"Best by cross-validation: {best}")
    return rows, best, fitted[best][0], y_te, fitted[best][1]


def cluster(models_df):
    X = StandardScaler().fit_transform(models_df[CLUSTER_FEATURES])
    sil = {}
    for k in range(2, 7):
        labels = KMeans(n_clusters=k, n_init=10, random_state=SEED).fit_predict(X)
        sil[k] = round(float(silhouette_score(X, labels)), 3)
    print("\nK-Means silhouette score by k:", sil)

    scaler = StandardScaler().fit(models_df[CLUSTER_FEATURES])
    km = KMeans(n_clusters=3, n_init=10, random_state=SEED).fit(scaler.transform(models_df[CLUSTER_FEATURES]))
    raw = km.labels_
    # name clusters by their mean CO2 so that the labels are stable
    order = models_df.groupby(raw)[TARGET].mean().sort_values().index.tolist()
    names = {order[0]: "Low", order[1]: "Medium", order[2]: "High"}
    tiers = pd.Series(raw).map(names).values
    joblib.dump({"scaler": scaler, "kmeans": km, "names": names, "features": CLUSTER_FEATURES},
                MODELS / "kmeans_tiers.joblib")
    return tiers, sil


TIERS = ["Low", "Medium", "High"]


def classifier_candidates():
    return {
        "Logistic Regression": LogisticRegression(max_iter=3000),
        "Random Forest": RandomForestClassifier(n_estimators=100, max_depth=6, random_state=SEED),
        "Gradient Boosting": GradientBoostingClassifier(random_state=SEED),
    }


def classify(models_df):
    """Predict the K-Means emission group from the specifications (no fuel or CO2 inputs)."""
    X, y = models_df[NUM_SPEC + CAT], models_df["tier"]
    groups = models_df["make"] + " " + models_df["model"].str.upper()
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED).split(X, y, groups))
    X_tr, X_te, y_tr, y_te, g_tr = X.iloc[tr], X.iloc[te], y.iloc[tr], y.iloc[te], groups.iloc[tr]
    cv = GroupKFold(n_splits=5)
    rows, fitted = [], {}
    for name, model in classifier_candidates().items():
        pipe = make_pipeline(model, NUM_SPEC)
        cv_f1 = cross_val_score(pipe, X_tr, y_tr, cv=cv, groups=g_tr, scoring="f1_macro").mean()
        pipe.fit(X_tr, y_tr)
        pred = pipe.predict(X_te)
        rows.append({
            "model": name,
            "cv_f1": round(float(cv_f1), 4),
            "test_accuracy": round(float(accuracy_score(y_te, pred)), 4),
            "test_f1": round(float(f1_score(y_te, pred, average="macro")), 4),
        })
        fitted[name] = (pipe, pred)
    best = max(rows, key=lambda r: r["cv_f1"])["model"]
    pipe, pred = fitted[best]
    cm = confusion_matrix(y_te, pred, labels=TIERS)
    print(f"\nCLASSIFIER: emission group from specifications  (train {len(X_tr)}, test {len(X_te)})")
    print(pd.DataFrame(rows).to_string(index=False))
    print(f"Best by cross-validation: {best}\nConfusion matrix (rows = actual {TIERS}, columns = predicted):\n{cm}")

    pipe.fit(X, y)   # final model on all the variants
    joblib.dump(pipe, MODELS / "tier_classifier.joblib")

    fig, ax = plt.subplots(figsize=(4.8, 4.2))
    ax.imshow(cm, cmap="Blues")
    ax.grid(False)
    ax.set(xticks=range(3), yticks=range(3), xticklabels=TIERS, yticklabels=TIERS,
           xlabel="Predicted group", ylabel="Actual group", title=f"{best}: unseen test cars")
    for i in range(3):
        for j in range(3):
            ax.text(j, i, int(cm[i, j]), ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else INK, fontsize=12)
    fig.tight_layout(); fig.savefig(REPORTS / "confusion_matrix.png"); plt.close(fig)
    return {"best": best, "results": rows, "labels": TIERS, "confusion_matrix": cm.tolist(),
            "test_cars": int(len(X_te))}


def plots(df, models_df, y_te, pred, importances):
    # 1. actual vs predicted
    fig, ax = plt.subplots(figsize=(5.2, 4.6))
    ax.scatter(y_te, pred, s=22, color=BLUE, alpha=0.75, edgecolor="white", linewidth=0.6)
    lim = [min(y_te.min(), pred.min()) - 10, max(y_te.max(), pred.max()) + 10]
    ax.plot(lim, lim, color=INK, linewidth=1, linestyle="--")
    ax.set(xlabel="Actual CO2 (g/km)", ylabel="Predicted CO2 (g/km)", xlim=lim, ylim=lim,
           title="Spec model on unseen test cars")
    fig.tight_layout(); fig.savefig(REPORTS / "actual_vs_predicted.png"); plt.close(fig)

    # 2. feature importance
    top = importances.head(10).iloc[::-1]
    fig, ax = plt.subplots(figsize=(6, 4.2))
    ax.barh(top.index, top.values, color=BLUE, height=0.6)
    ax.grid(axis="y", visible=False)
    ax.set(xlabel="Importance", title="What drives CO2 in the spec model")
    fig.tight_layout(); fig.savefig(REPORTS / "feature_importance.png"); plt.close(fig)

    # 3. clusters
    fig, ax = plt.subplots(figsize=(6, 4.4))
    for tier, colour, marker in [("Low", "#1baf7a", "o"), ("Medium", "#eda100", "s"), ("High", "#e34948", "^")]:
        part = models_df[models_df["tier"] == tier]
        ax.scatter(part["engine_l"], part["co2_g_km"], s=26, color=colour, marker=marker,
                   edgecolor="white", linewidth=0.6, label=f"{tier} ({len(part)})")
    ax.set(xlabel="Engine size (L)", ylabel="CO2 (g/km)", title="K-Means emission tiers")
    ax.legend(frameon=False, title="Tier")
    fig.tight_layout(); fig.savefig(REPORTS / "clusters.png"); plt.close(fig)

    # 4. brand distributions
    fig, ax = plt.subplots(figsize=(6, 4.2))
    bins = np.arange(120, 500, 20)
    for make, colour in [("BMW", BLUE), ("Mercedes-Benz", ORANGE)]:
        ax.hist(df.loc[df["make"] == make, TARGET], bins=bins, histtype="step", linewidth=2,
                color=colour, label=make)
    ax.set(xlabel="CO2 (g/km)", ylabel="Rated vehicles", title="CO2 ratings by brand")
    ax.legend(frameon=False)
    fig.tight_layout(); fig.savefig(REPORTS / "brand_distribution.png"); plt.close(fig)


def main():
    MODELS.mkdir(exist_ok=True); REPORTS.mkdir(exist_ok=True)
    df = pd.read_csv(DATA / "bmw_mercedes_clean.csv")
    models_df = pd.read_csv(DATA / "bmw_mercedes_models.csv")

    spec_rows, spec_best, spec_pipe, y_te, pred = evaluate(df, NUM_SPEC, "SPEC")
    full_rows, full_best, full_pipe, _, _ = evaluate(df, NUM_FULL, "FULL")

    # feature importance of a (full-size) Random Forest on the spec features, for the report
    rf = make_pipeline(RandomForestRegressor(n_estimators=300, random_state=SEED), NUM_SPEC)
    rf.fit(df[NUM_SPEC + CAT], df[TARGET])
    names = [n.split("__", 1)[1] for n in rf.named_steps["pre"].get_feature_names_out()]
    importances = pd.Series(rf.named_steps["model"].feature_importances_, index=names).sort_values(ascending=False)

    # final models are refitted on all the data before saving
    spec_pipe.fit(df[NUM_SPEC + CAT], df[TARGET]); joblib.dump(spec_pipe, MODELS / "co2_spec_model.joblib")
    full_pipe.fit(df[NUM_FULL + CAT], df[TARGET]); joblib.dump(full_pipe, MODELS / "co2_full_model.joblib")

    tiers, sil = cluster(models_df)
    models_df["tier"] = tiers
    models_df.to_csv(DATA / "bmw_mercedes_models_clustered.csv", index=False)
    tier_summary = (models_df.groupby("tier")
                    .agg(cars=("id", "count"), engine_l=("engine_l", "mean"),
                         fuel_comb=("fuel_comb", "mean"), co2_g_km=("co2_g_km", "mean"))
                    .round(1).reindex(["Low", "Medium", "High"]))
    print("\nEmission tiers:\n", tier_summary)

    classifier = classify(models_df)
    plots(df, models_df, y_te, pred, importances)

    metrics = {
        "rows_used": int(len(df)),
        "rows_by_source": {k: int(v) for k, v in df["source"].value_counts().items()},
        "model_variants": int(len(models_df)),
        "spec": {"best": spec_best, "results": spec_rows},
        "full": {"best": full_best, "results": full_rows},
        "feature_importance": {k: round(float(v), 4) for k, v in importances.head(10).items()},
        "kmeans": {"k": 3, "silhouette_by_k": sil,
                   "tiers": tier_summary.reset_index().to_dict(orient="records")},
        "classifier": classifier,
        "categories": {c: sorted(df[c].unique().tolist()) for c in CAT},
    }
    (REPORTS / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print(f"\nSaved models to {MODELS} and reports to {REPORTS}")


if __name__ == "__main__":
    main()

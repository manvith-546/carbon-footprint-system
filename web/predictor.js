/*
 * The trained machine-learning models, running in the browser.
 *
 * python/4_export_web_data.py exports the two scikit-learn models to web/model.js:
 *   CFS_MODEL       CO2 rating regression   (models/co2_spec_model.joblib)
 *   CFS_CLASSIFIER  emission-group classifier (models/tier_classifier.joblib)
 * This file applies the same preprocessing (StandardScaler + OneHotEncoder) and walks
 * the same decision trees / linear weights, so it gives the same answers as the Flask
 * API (/api/predict) without a server. tests/check_consistency.js checks this.
 */
(function (root) {
  /** Feature vector in the same order as the scikit-learn ColumnTransformer. */
  function features(M, input) {
    const x = [];
    M.num.forEach((col, i) => x.push((Number(input[col]) - M.mean[i]) / M.scale[i]));
    M.cat.forEach((col, i) => M.categories[i].forEach(v => x.push(String(input[col]) === String(v) ? 1 : 0)));
    return x;
  }

  /** Leaf value of one decision tree. scikit-learn compares float32 features with float64 thresholds. */
  function walk(t, x) {
    let n = 0;
    while (t.l[n] !== -1) n = Math.fround(x[t.f[n]]) <= t.t[n] ? t.l[n] : t.r[n];
    return t.v[n];
  }

  function softmax(z) {
    const m = Math.max(...z), e = z.map(v => Math.exp(v - m)), s = e.reduce((a, b) => a + b, 0);
    return e.map(v => v / s);
  }

  /** Predicted CO2 rating in g/km. */
  function predict(M, input) {
    const x = features(M, input);
    if (M.kind === "gradient_boosting") { let y = M.base; for (const t of M.trees) y += M.rate * walk(t, x); return y; }
    if (M.kind === "random_forest") return M.trees.reduce((s, t) => s + walk(t, x), 0) / M.trees.length;
    if (M.kind === "linear") return x.reduce((s, v, i) => s + v * M.coef[i], M.intercept);
    throw new Error("Unsupported model type: " + M.kind);
  }

  /** Class probabilities, e.g. { High: 0.02, Low: 0.9, Medium: 0.08 }, plus the most likely class. */
  function classify(M, input) {
    const x = features(M, input);
    let p;
    if (M.kind === "logistic_classifier") p = softmax(M.coef.map((w, k) => w.reduce((s, a, i) => s + a * x[i], M.intercept[k])));
    else if (M.kind === "gradient_boosting_classifier") {
      const raw = M.base.slice();
      for (const stage of M.trees) stage.forEach((t, k) => { raw[k] += M.rate * walk(t, x); });
      p = softmax(raw);
    } else if (M.kind === "random_forest_classifier") {
      p = M.classes.map(() => 0);
      for (const t of M.trees) walk(t, x).forEach((v, k) => { p[k] += v; });
      p = p.map(v => v / M.trees.length);
    } else throw new Error("Unsupported model type: " + M.kind);
    const probabilities = Object.fromEntries(M.classes.map((c, k) => [c, p[k]]));
    const label = M.classes[p.indexOf(Math.max(...p))];
    return { label, probabilities };
  }

  /** Reads 'performance' and 'awd' from a model name, as python/1_prepare_data.py does. */
  const PERFORMANCE = /\bAMG\b|\bMaybach\b|\bALPINA\b|\bCompetition\b|^M\d|\bM\d{1,3}[id]?\b|\bX\d M\b|^Z4 M/i;
  const nameFeatures = model => ({ performance: PERFORMANCE.test(model) ? "yes" : "no", awd: /xDrive|4MATIC|4x4/i.test(model) ? "yes" : "no" });

  const api = { features, predict, classify, nameFeatures };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CO2Predictor = api;
})(typeof window !== "undefined" ? window : globalThis);

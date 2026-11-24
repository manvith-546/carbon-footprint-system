// Checks that the website (JavaScript) gives the same answers as Python.
// Run:  node tests/check_consistency.js
//
// 1. Estimator: for every profile in tests/fixtures/estimates.json (written by
//    python/4_export_web_data.py) the yearly CO2, kilometres, fuel cost, everyday
//    comparisons and every recommendation must match python/footprint.py.
// 2. Machine learning: web/predictor.js with web/model.js must reproduce the
//    scikit-learn CO2 predictions and emission-group probabilities in
//    tests/fixtures/predictions.json.
const fs = require("fs");
const path = require("path");
globalThis.window = globalThis;
const web = p => path.join(__dirname, "..", "web", p);
require(web("data.js"));
require(web("model.js"));
const F = require(web("footprint.js"));
const P = require(web("predictor.js"));
const D = globalThis.CFS_DATA;
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
let failures = 0;
const fail = msg => { failures++; console.error("FAIL: " + msg); };
const close = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- 1. estimator ----------------------------------------------------------------
const byId = new Map(D.models.map(m => [m.id, m]));
for (const c of read("estimates.json")) {
  const p = { ...F.DEFAULT_PROFILE, ...c.profile };
  const car = byId.get(p.car_id);
  const r = F.estimate(p, car, D.factors);
  const tips = F.recommend(p, car, D.models, D.factors, D.evs);
  const label = `${car.model} (${car.years}), ${p.mode}`;
  if (!close(r.total, c.total_kg, 0.06)) fail(`${label}: total ${r.total.toFixed(1)} kg, Python ${c.total_kg}`);
  if (!close(r.km_month, c.km_month, 0.06)) fail(`${label}: km ${r.km_month.toFixed(1)}, Python ${c.km_month}`);
  if (!close(r.cost, c.fuel_cost, 0.6)) fail(`${label}: cost ${r.cost.toFixed(0)}, Python ${c.fuel_cost}`);
  if (!close(r.comparisons.trees, c.comparisons.trees_to_absorb, 0.06)) fail(`${label}: trees`);
  if (!close(r.comparisons.lpg, c.comparisons.lpg_cylinders, 0.06)) fail(`${label}: LPG cylinders`);
  if (tips.length !== c.tips.length) fail(`${label}: ${tips.length} tips, Python ${c.tips.length}`);
  tips.forEach((t, i) => {
    const e = c.tips[i] || {};
    if (t.kind !== e.kind || !close(t.kg, e.kg, 0.06) || !close(t.rupees, e.rupees, 0.6))
      fail(`${label}: tip ${i + 1} ${t.kind} ${t.kg.toFixed(1)} kg / Rs ${t.rupees.toFixed(0)}, Python ${e.kind} ${e.kg} kg / Rs ${e.rupees}`);
  });
  console.log(`Estimate ${label}: ${r.total.toFixed(1)} kg CO2 a year, ${tips.length} tips`);
}

// ---- 2. machine-learning models ----------------------------------------------------
const rows = read("predictions.json");
let worstReg = 0, worstCls = 0;
for (const row of rows) {
  if (globalThis.CFS_MODEL) worstReg = Math.max(worstReg, Math.abs(P.predict(globalThis.CFS_MODEL, row) - row.expected_co2_g_km));
  if (globalThis.CFS_CLASSIFIER) {
    const { probabilities } = P.classify(globalThis.CFS_CLASSIFIER, row);
    for (const [k, v] of Object.entries(row.expected_group_probabilities)) worstCls = Math.max(worstCls, Math.abs(probabilities[k] - v));
  }
}
if (!globalThis.CFS_MODEL) fail("web/model.js has no CO2 model"); else if (worstReg > 1e-6) fail(`CO2 predictor differs by ${worstReg}`);
if (!globalThis.CFS_CLASSIFIER) fail("web/model.js has no classifier"); else if (worstCls > 1e-9) fail(`classifier differs by ${worstCls}`);
console.log(`Predictor: ${rows.length} cars, largest difference from scikit-learn ${worstReg.toExponential(1)} g/km`);
console.log(`Classifier: largest probability difference ${worstCls.toExponential(1)}`);

// ---- 3. features read from the model name --------------------------------------------
const mismatched = D.models.filter(m => { const n = P.nameFeatures(m.model); return n.performance !== m.performance || n.awd !== m.awd; });
if (mismatched.length) fail(`name features differ from Python for ${mismatched.length} models, e.g. ${mismatched[0].model}`);
else console.log(`Name features: same as Python for all ${D.models.length} models`);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nOK: the website matches Python and scikit-learn");
process.exit(failures ? 1 : 0);

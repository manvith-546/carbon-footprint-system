/* Page behaviour: reads the form, draws the result, the charts and the tables. */
(function () {
  const D = window.CFS_DATA, F = window.Footprint;
  const $ = id => document.getElementById(id);
  const fmt = (n, d = 0) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const models = D.models, factors = D.factors;
  const byId = new Map(models.map(m => [m.id, m]));
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("cfs-car") || "{}"); } catch (e) { /* storage unavailable */ }
  /** Opens a car in the app (index.html). */
  function useCar(id) {
    try { localStorage.setItem("cfs-car", JSON.stringify({ ...saved, car_id: id, cmp_a: null })); } catch (e) { /* ignore */ }
    window.location.href = "index.html";
  }

  // ---------------------------------------------------------------- tooltip
  const tip = $("tooltip");
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14)) + "px";
    tip.style.top = (y - h - 12 < 8 ? y + 18 : y - h - 12) + "px";
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------------------------------------------------------------- ruler (strip plot)
  const X0 = 120, X1 = 480, L = 130, R = 985;
  const sx = v => L + (v - X0) / (X1 - X0) * (R - L);
  const ROWS = [["BMW", "bmw", 34], ["Mercedes-Benz", "merc", 98]];
  function drawRuler(car, co2) {
    let s = "";
    for (let v = 150; v <= 450; v += 50)
      s += `<line class="grid" x1="${sx(v)}" x2="${sx(v)}" y1="26" y2="150"/><text x="${sx(v)}" y="168" text-anchor="middle">${v}</text>`;
    s += `<text x="${R}" y="186" text-anchor="end">CO₂, grams per kilometre</text>`;
    ROWS.forEach(([make, cls, y]) => {
      s += `<text class="rowlabel" x="0" y="${y + 26}">${make}</text>`;
      models.filter(m => m.make === make).forEach(m => {
        s += `<line class="tick ${cls}" data-id="${m.id}" x1="${sx(m.co2_g_km)}" x2="${sx(m.co2_g_km)}" y1="${y}" y2="${y + 44}"/>`;
      });
      s += `<rect class="hit" data-make="${make}" x="${L - 6}" y="${y - 4}" width="${R - L + 12}" height="52"/>`;
    });
    if (co2 > 0) {
      const x = sx(Math.min(X1, Math.max(X0, co2)));
      const y = car ? ROWS.find(r => r[0] === car.make)[2] : 34;
      const y1 = car ? y - 8 : 26, y2 = car ? y + 52 : 150;
      const anchor = x > 800 ? "end" : "start", dx = x > 800 ? -8 : 8;
      s += `<line class="you" x1="${x}" x2="${x}" y1="${y1}" y2="${y2}"/>` +
        `<text class="youlabel" x="${x + dx}" y="${car ? y - 10 : 18}" text-anchor="${anchor}">${car ? esc(car.model) : "Your car"}, ${fmt(co2)} g/km</text>`;
    }
    $("ruler").innerHTML = s;
    const cleaner = co2 > 0 ? models.filter(m => m.co2_g_km < co2).length : 0;
    $("rulerNote").textContent = co2 > 0
      ? `The marked car is the one chosen in the app. ${cleaner} of ${models.length} models are rated lower.` + (car && car.tier ? ` K-Means places it in the ${car.tier.toLowerCase()} emission tier.` : "")
      : "";
  }
  function nearest(evt) {
    const svg = $("ruler"), box = svg.getBoundingClientRect();
    const vx = (evt.clientX - box.left) / box.width * 1000;
    const make = evt.target.dataset.make;
    let best = null, d = 1e9;
    for (const m of models) {
      if (m.make !== make) continue;
      const dd = Math.abs(sx(m.co2_g_km) - vx);
      if (dd < d) { d = dd; best = m; }
    }
    return d < 12 ? best : null;
  }
  $("ruler").addEventListener("mousemove", e => {
    $("ruler").querySelectorAll(".tick.hot").forEach(t => t.classList.remove("hot"));
    if (!e.target.classList.contains("hit")) return hideTip();
    const m = nearest(e); if (!m) return hideTip();
    const same = models.filter(o => o.make === m.make && o.co2_g_km === m.co2_g_km);
    same.forEach(o => $("ruler").querySelector(`.tick[data-id="${o.id}"]`).classList.add("hot"));
    showTip(`<b>${m.co2_g_km} g/km</b>` + same.slice(0, 4).map(o => `${esc(o.make)} ${esc(o.model)}, ${o.engine_l.toFixed(1)} L`).join("<br>") +
      (same.length > 4 ? `<br>and ${same.length - 4} more` : ""), e.clientX, e.clientY);
  });
  $("ruler").addEventListener("mouseleave", hideTip);
  $("ruler").addEventListener("click", e => {
    if (!e.target.classList.contains("hit")) return;
    const m = nearest(e); if (m) useCar(m.id);
  });

  // ---------------------------------------------------------------- models table
  let sortKey = "co2_g_km", sortDir = 1, shown = 25;
  function drawTable() {
    const q = $("q").value.trim().toLowerCase(), b = $("fBrand").value, c = $("fClass").value, t = $("fTier").value;
    const rows = models.filter(m => (!q || (m.make + " " + m.model).toLowerCase().includes(q)) &&
      (!b || m.make === b) && (!c || m.vehicle_class === c) && (!t || m.tier === t));
    rows.sort((x, y) => (x[sortKey] > y[sortKey] ? 1 : x[sortKey] < y[sortKey] ? -1 : 0) * sortDir || x.co2_g_km - y.co2_g_km);
    $("table").tBodies[0].innerHTML = rows.slice(0, shown).map(m =>
      `<tr><td><span class="brand-mark" style="background:var(--${m.make === "BMW" ? "bmw" : "merc"})"></span>${m.make}</td>` +
      `<td>${esc(m.model)}</td><td>${esc(m.years)}</td><td>${F.classLabel(m.vehicle_class)}</td><td class="num">${m.engine_l.toFixed(1)} L</td>` +
      `<td>${esc(m.fuel_name)}</td><td class="num">${m.fuel_comb.toFixed(1)}</td><td class="num">${m.co2_g_km}</td>` +
      `<td>${m.tier || ""}</td><td><button class="use" data-id="${m.id}">Open in the app</button></td></tr>`).join("") ||
      `<tr><td colspan="10">No model matches these filters. Clear the search or choose "All".</td></tr>`;
    $("count").textContent = `${rows.length} of ${models.length} models` + (rows.length > shown ? `, showing the first ${shown}` : "");
    $("more").hidden = rows.length <= shown;
    document.querySelectorAll("#table th button").forEach(btn => {
      if (btn.dataset.sort === sortKey) btn.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
      else btn.removeAttribute("aria-sort");
    });
  }
  document.querySelectorAll("#table th button").forEach(btn => btn.addEventListener("click", () => {
    sortDir = sortKey === btn.dataset.sort ? -sortDir : 1; sortKey = btn.dataset.sort; drawTable();
  }));
  ["q", "fBrand", "fClass", "fTier"].forEach(id => $(id).addEventListener("input", () => { shown = 25; drawTable(); }));
  $("more").addEventListener("click", () => { shown += 50; drawTable(); });
  $("table").addEventListener("click", e => {
    if (!e.target.classList.contains("use")) return;
    useCar(Number(e.target.dataset.id));
  });

  // ---------------------------------------------------------------- laboratory vs road
  const FUEL_LABEL = { "PETROL": "Petrol", "DIESEL": "Diesel", "PETROL/ELECTRIC": "Petrol plug-in hybrid", "DIESEL/ELECTRIC": "Diesel plug-in hybrid" };
  function drawRoad() {
    const year = $("euYear").value;
    const groups = new Map();
    D.eu.filter(r => !year || String(r.year) === year).forEach(r => {
      const k = r.brand + "|" + r.fuel_type;
      const g = groups.get(k) || { brand: r.brand, fuel: r.fuel_type, n: 0, lab: 0, road: 0 };
      g.n += r.vehicles; g.lab += r.wltp_co2_g_km * r.vehicles; g.road += r.obfcm_co2_g_km * r.vehicles;
      groups.set(k, g);
    });
    const order = Object.keys(FUEL_LABEL);
    const list = [...groups.values()].map(g => ({ ...g, lab: g.lab / g.n, road: g.road / g.n }))
      .sort((a, b) => order.indexOf(a.fuel) - order.indexOf(b.fuel) || a.brand.localeCompare(b.brand));
    const max = 240;
    $("dumbbells").innerHTML = list.map(g => {
      const col = `var(--${g.brand === "BMW" ? "bmw" : "merc"})`;
      const a = 100 * g.lab / max, b = 100 * Math.min(g.road, max) / max;
      return `<div class="db" data-tip="<b>${g.brand}, ${FUEL_LABEL[g.fuel].toLowerCase()}</b>Laboratory ${fmt(g.lab, 1)} g/km<br>On the road ${fmt(g.road, 1)} g/km<br>${fmt(g.n)} vehicles">` +
        `<div class="name"><b>${FUEL_LABEL[g.fuel]}</b><small>${g.brand}, ${fmt(g.n)} vehicles</small></div>` +
        `<div class="track" style="color:${col}"><div class="bar" style="left:${a}%;width:${b - a}%;background:${col}"></div>` +
        `<div class="p lab" style="left:${a}%"></div><div class="p road" style="left:${b}%"></div></div>` +
        `<div class="vals">${fmt(g.lab)} to ${fmt(g.road)} g/km<small>${fmt(100 * (g.road - g.lab) / g.lab)}% higher on the road</small></div></div>`;
    }).join("") || `<p class="hint">No records for this year.</p>`;
  }
  $("euYear").addEventListener("change", drawRoad);

  // ---------------------------------------------------------------- machine learning section
  function drawMl() {
    const m = D.metrics;
    const rows = (set, label) => set.results.map(r =>
      `<tr><td>${label}</td><td>${r.model}${r.model === set.best ? " (used)" : ""}</td><td class="num">${r.cv_r2.toFixed(3)}</td>` +
      `<td class="num">${r.test_r2.toFixed(3)}</td><td class="num">${r.test_mae.toFixed(1)}</td></tr>`).join("");
    $("mlTable").tBodies[0].innerHTML = rows(m.spec, "Specifications") + rows(m.full, "With fuel use");
    const imp = Object.entries(m.feature_importance).slice(0, 7), top = imp[0][1];
    const FUEL_NAME = { Z: "premium petrol", X: "regular petrol", D: "diesel", E: "E85" };
    const nice = k => k === "engine_l" ? "Engine size" : k === "cylinders" ? "Cylinders"
      : k.startsWith("vehicle_class_") ? "Class: " + F.classLabel(k.slice(14))
      : k.startsWith("transmission_") ? "Gearbox: " + k.slice(13)
      : k.startsWith("make_") ? "Brand: " + k.slice(5)
      : k.startsWith("fuel_type_") ? "Fuel: " + (FUEL_NAME[k.slice(10)] || k.slice(10))
      : k.startsWith("performance_") ? (k.endsWith("yes") ? "Performance version" : "Not a performance version")
      : k.startsWith("awd_") ? (k.endsWith("yes") ? "All-wheel drive" : "Two-wheel drive") : k;
    $("importance").innerHTML = imp.map(([k, v]) =>
      `<div class="b" data-tip="<b>${nice(k)}</b>${fmt(100 * v, 1)}% of the model's importance"><span>${nice(k)}</span><span><span class="t" style="display:block;width:${100 * v / top}%"></span></span><span class="v">${fmt(100 * v)}%</span></div>`).join("");
    $("tierTable").tBodies[0].innerHTML = m.kmeans.tiers.map(t =>
      `<tr><td>${t.tier}</td><td class="num">${t.cars}</td><td class="num">${t.engine_l.toFixed(1)}</td><td class="num">${t.fuel_comb.toFixed(1)}</td><td class="num">${fmt(t.co2_g_km)}</td></tr>`).join("");
    $("silNote").textContent = `Silhouette score with three clusters: ${m.kmeans.silhouette_by_k["3"]}. Three was chosen so the tiers read as low, medium and high.`;
    $("factorTable").tBodies[0].innerHTML = D.factorTable.map(f =>
      `<tr><td>${esc(f.key.replace(/_/g, " "))}</td><td class="num">${f.value}</td><td>${esc(f.unit)}</td><td>${esc(f.source)}</td></tr>`).join("");
    $("c_class").innerHTML = m.categories.vehicle_class.map(c => `<option value="${c}">${F.classLabel(c)}</option>`).join("");
    $("c_trans").innerHTML = m.categories.transmission.map(c => `<option>${c}</option>`).join("");
    $("c_trans").value = "AS8";
    const FUEL = { Z: "Premium petrol", X: "Regular petrol", D: "Diesel", E: "E85 flex fuel" };
    $("c_fuel").innerHTML = m.categories.fuel_type.map(c => `<option value="${c}">${FUEL[c] || c}</option>`).join("");
    $("c_fuel").value = "Z";

    // classifier: scores and confusion matrix
    const c = m.classifier;
    if (c) {
      $("clsTable").tBodies[0].innerHTML = c.results.map(r =>
        `<tr><td>${r.model}${r.model === c.best ? " (used)" : ""}</td><td class="num">${r.cv_f1.toFixed(3)}</td>` +
        `<td class="num">${fmt(100 * r.test_accuracy, 1)}%</td><td class="num">${r.test_f1.toFixed(3)}</td></tr>`).join("");
      $("clsNote").textContent = `The algorithm is chosen by cross-validation on the training cars (grouped by model name), then scored once on ${c.test_cars} test cars.`;
      const max = Math.max(...c.confusion_matrix.flat());
      $("cmTable").innerHTML = `<thead><tr><th class="corner">Actual ↓ · Predicted →</th>${c.labels.map(l => `<th>${l}</th>`).join("")}</tr></thead><tbody>` +
        c.confusion_matrix.map((row, i) => `<tr><th>${c.labels[i]}</th>` + row.map((v, j) =>
          `<td style="background:rgba(${i === j ? "79,210,154" : "238,138,69"},${v ? (0.12 + 0.45 * v / max).toFixed(2) : 0})" data-tip="<b>${v} cars</b>actually ${c.labels[i]}, predicted ${c.labels[j]}">${v}</td>`).join("") + `</tr>`).join("") + `</tbody>`;
      const correct = c.confusion_matrix.reduce((s, row, i) => s + row[i], 0), total = c.confusion_matrix.flat().reduce((a, b) => a + b, 0);
      const offs = []; c.confusion_matrix.forEach((row, i) => row.forEach((v, j) => { if (i !== j && v) offs.push(`${v} ${c.labels[i]} as ${c.labels[j]}`); }));
      const lo = c.labels.indexOf("Low"), hi = c.labels.indexOf("High");
      const farOff = lo >= 0 && hi >= 0 ? c.confusion_matrix[lo][hi] + c.confusion_matrix[hi][lo] : 0;
      $("cmNote").textContent = `${correct} of ${total} test cars are placed in the right group. Mistakes: ${offs.join(", ") || "none"}.` +
        (offs.length && !farOff ? " Only neighbouring groups get mixed up; no Low car is called High or the other way round." : "");
    }
  }

  // ---------------------------------------------------------------- custom car: ask the Flask API
  function runPrediction() {
    const out = $("predictOut");
    const input = { make: $("c_make").value, vehicle_class: $("c_class").value, transmission: $("c_trans").value,
      fuel_type: $("c_fuel").value, performance: $("c_perf").value, awd: $("c_awd").value,
      engine_l: parseFloat($("c_engine").value), cylinders: parseInt($("c_cyl").value, 10) };
    if (!(input.engine_l > 0) || !(input.cylinders > 0)) { out.textContent = "Enter an engine size and a number of cylinders."; return; }
    if (!window.CFS_MODEL || !window.CO2Predictor) {
      out.textContent = "The model file is missing. Run python run_all.py to create web/model.js.";
      return;
    }
    const co2 = window.CO2Predictor.predict(window.CFS_MODEL, input);
    const similar = D.models.filter(m => m.make === input.make && m.vehicle_class === input.vehicle_class && m.fuel_type === input.fuel_type)
      .sort((a, b) => Math.abs(a.engine_l - input.engine_l) - Math.abs(b.engine_l - input.engine_l))[0];
    let html = `Predicted CO₂ rating <b>${fmt(co2)} g/km</b>` +
      (similar ? `<br>The closest real model in the data, the ${esc(similar.make)} ${esc(similar.model)} (${esc(similar.years)}, ${similar.engine_l.toFixed(1)} L), is rated ${similar.co2_g_km} g/km.` : "");
    if (window.CFS_CLASSIFIER) {
      const g = window.CO2Predictor.classify(window.CFS_CLASSIFIER, input);
      const COL = { Low: "#4fd29a", Medium: "#e8c35a", High: "#ee8a45" };
      html += `<br>Predicted emission group <b>${g.label}</b><div class="probs">` + ["Low", "Medium", "High"].filter(k => k in g.probabilities).map(k =>
        `<div class="p"><span>${k}</span><span class="t"><i style="width:${(100 * g.probabilities[k]).toFixed(1)}%;background:${COL[k]}"></i></span><span class="v">${fmt(100 * g.probabilities[k])}%</span></div>`).join("") + `</div>`;
    }
    out.innerHTML = html;
  }
  $("predictBtn").addEventListener("click", runPrediction);
  ["c_make", "c_class", "c_trans", "c_fuel", "c_perf", "c_awd", "c_engine", "c_cyl"].forEach(id => $(id).addEventListener("change", runPrediction));

  // ---------------------------------------------------------------- generic hover tooltips
  document.addEventListener("mousemove", e => {
    const el = e.target.closest ? e.target.closest("[data-tip]") : null;
    if (el) showTip(el.dataset.tip, e.clientX, e.clientY);
    else if (!e.target.closest || !e.target.closest("#ruler")) hideTip();
  });

  // ---------------------------------------------------------------- start
  $("nModels").textContent = models.length;
  $("fClass").innerHTML += [...new Set(models.map(m => m.vehicle_class))].sort().map(c => `<option value="${c}">${F.classLabel(c)}</option>`).join("");
  const mine = byId.get(saved.car_id) || null;
  drawMl(); drawTable(); drawRoad(); drawRuler(mine, mine ? mine.co2_g_km : 0); runPrediction();
})();

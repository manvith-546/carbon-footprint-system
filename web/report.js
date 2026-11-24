/* Printable one-page report. Reads the car and driving from the link (report.html?car=425&km=1000...),
   or else from what the estimator remembered in this browser, and uses the same formulas (footprint.js). */
(function () {
  const D = window.CFS_DATA, F = window.Footprint;
  const $ = id => document.getElementById(id);
  const fmt = (n, d = 0) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const models = D.models, evs = D.evs, f = D.factors;
  const byId = new Map(models.map(m => [m.id, m]));

  // ---- the profile: link first, then the estimator's saved settings, then the defaults
  const p = { ...F.DEFAULT_PROFILE, car_id: D.defaultCarId };
  try {
    const s = JSON.parse(localStorage.getItem("cfs-car") || "{}");
    ["car_id", "km_month", "fuel_spend_month", "city_share", "fuel_price", "elec_price"].forEach(k => { if (typeof s[k] === "number") p[k] = s[k]; });
    if (s.mode === "fuel" || s.mode === "distance") p.mode = s.mode;
  } catch (e) { /* storage unavailable */ }
  const q = new URLSearchParams(location.search);
  const num = (key, field, lo, hi) => { const v = parseFloat(q.get(key)); if (!isNaN(v)) p[field] = Math.min(hi, Math.max(lo, v)); };
  num("car", "car_id", 0, 1e9); num("km", "km_month", 0, 20000); num("spend", "fuel_spend_month", 0, 500000);
  num("city", "city_share", 0, 100); num("fuel", "fuel_price", 1, 1000); num("elec", "elec_price", 0, 100);
  if (q.get("mode") === "fuel" || q.get("mode") === "distance") p.mode = q.get("mode");
  if (!byId.has(p.car_id)) p.car_id = D.defaultCarId;

  const c = byId.get(p.car_id), r = F.estimate(p, c, f), tips = F.recommend(p, c, models, f, evs);
  const cleaner = models.filter(m => m.co2_g_km < c.co2_g_km).length;
  const pct = Math.round(100 * (models.length - cleaner - 1) / (models.length - 1));

  $("rDate").textContent = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  $("rMake").textContent = c.make;
  $("rModel").textContent = c.model;
  $("rSpecs").textContent = [`${c.years} models`, F.classLabel(c.vehicle_class), `${c.engine_l.toFixed(1)} L ${c.fuel_name.toLowerCase()}`,
    c.transmission_name, `rated ${c.co2_g_km} g CO₂/km`, `${c.tier} emission group (K-Means)`].join(" · ");
  document.title = `Car carbon report: ${c.make} ${c.model}`;

  const distance = p.mode === "fuel"
    ? [`₹${fmt(p.fuel_spend_month)} fuel a month`, `about ${fmt(r.km_month)} km a month`]
    : [`${fmt(r.km_month)} km a month`, `${fmt(r.km_month * 12)} km a year`];
  $("rInputs").innerHTML = [["Driving", ...distance], ["In the city", `${p.city_share}%`, `${100 - p.city_share}% on highways`],
    ["Fuel price", `₹${fmt(p.fuel_price)} a litre`, ""], ["Electricity price", `₹${fmt(p.elec_price, 1)} a kWh`, "for the electric option"]]
    .map(([k, v, s]) => `<div><span>${k}</span><b>${esc(v)}</b>${s ? `<small>${esc(s)}</small>` : ""}</div>`).join("");

  $("rTotal").textContent = fmt(r.total / 1000, 2);
  $("rBand").textContent = `${r.band} for one car · about ${fmt(r.total / 365, 1)} kg of CO₂ a day`;
  $("rStats").innerHTML = [["Fuel burned", `${fmt(r.litres)} litres a year`], ["Spent on fuel", `₹${fmt(r.cost)} a year`],
    ["CO₂ with your driving", `${fmt(r.co2)} g/km`], [`Compared with ${models.length} models`, `cleaner than ${pct}%`]]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");

  const city = r.parts["City driving"], hwy = r.parts["Highway driving"];
  $("rBar").innerHTML = `<i class="city" style="flex-grow:${city}"></i><i class="hwy" style="flex-grow:${hwy}"></i>`;
  $("rLegend").innerHTML = `<span><i class="city"></i>City driving: ${fmt(city)} kg (${r.total ? fmt(100 * city / r.total) : 0}%)</span>` +
    `<span><i class="hwy"></i>Highway driving: ${fmt(hwy)} kg (${r.total ? fmt(100 * hwy / r.total) : 0}%)</span>`;

  const k = r.comparisons;
  $("rLikes").innerHTML = [[`${fmt(k.trees)} trees`, `growing for a year to absorb it (about ${fmt(f.tree_per_year)} kg each)`],
    [`${fmt(k.indian, 1)} times`, `an average Indian's yearly CO₂ from everything (${fmt(f.india_per_capita / 1000, 1)} t)`],
    [`${fmt(k.lpg)} cylinders`, "of 14.2 kg cooking gas (LPG) burned"]]
    .map(([b, s]) => `<li><b>${b}</b><span>${s}</span></li>`).join("");

  $("rTips").innerHTML = tips.map((t, i) => `<tr><td class="n">${i + 1}</td><td><b>${esc(t.title)}</b><span>${esc(t.tip)}</span></td>` +
    `<td class="num">${fmt(t.kg)} kg</td><td class="num">₹${fmt(t.rupees)}</td></tr>`).join("") ||
    `<tr><td colspan="4">Nothing to suggest at this distance.</td></tr>`;

  $("rMethod").textContent = `Method: yearly CO₂ = kilometres × the car's city and highway fuel use × its rated CO₂ per litre (laboratory tailpipe ratings). ` +
    `Electric cars are counted at India's grid average of ${f.grid_india} kg CO₂ per kWh. Real driving usually emits more than the laboratory rating: ` +
    `about a fifth more for these brands in EU on-board fuel-meter data (2021–2024). Making the fuel, the car or its battery is not counted.`;

  // ---- one page: when printing, shrink the sheet if its content is taller than A4
  const sheet = $("sheet"), MM = 96 / 25.4;
  function fit() {
    unfit();
    const over = sheet.scrollHeight / (297 * MM);
    if (over > 1) {
      const z = Math.max(0.6, 1 / over - 0.005);
      Object.assign(sheet.style, { zoom: z, width: `${210 / z}mm`, height: `${297 / z}mm` });
    }
  }
  function unfit() { Object.assign(sheet.style, { zoom: "", width: "", height: "" }); }
  const printing = window.matchMedia("print");
  const onMedia = e => (e.matches ? fit() : unfit());
  if (printing.addEventListener) printing.addEventListener("change", onMedia); else printing.addListener(onMedia);
  window.addEventListener("beforeprint", fit);
  window.addEventListener("afterprint", unfit);
  $("printBtn").addEventListener("click", () => window.print());
})();

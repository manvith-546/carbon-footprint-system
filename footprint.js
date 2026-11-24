/*
 * Car footprint estimation and recommendation logic (JavaScript version).
 * Same formulas as python/footprint.py and java/CarbonFootprintApp.java.
 * No DOM code here, so it can also be tested with Node (see tests/check_consistency.js).
 */
(function (root) {
  const DEFAULT_PROFILE = { mode: "distance", km_month: 1000, fuel_spend_month: 10000, city_share: 55, fuel_price: 100, elec_price: 8 };
  const EV_MIN_YEAR = 2024;   // only suggest electric models still on sale

  /** Fuel (L/100 km) and CO2 (g/km) of a car for a given % of city driving. */
  function blended(car, cityShare) {
    const s = Math.min(100, Math.max(0, cityShare)) / 100;
    const fuel = s * car.fuel_city + (1 - s) * car.fuel_hwy;
    return { fuel, co2: car.co2_g_km * fuel / car.fuel_comb };
  }

  /** kWh per 100 km of an electric car for a given % of city driving. */
  function blendedEv(ev, cityShare) {
    const s = Math.min(100, Math.max(0, cityShare)) / 100;
    return s * ev.kwh_city + (1 - s) * ev.kwh_hwy;
  }

  /** Kilometres a month: given, or worked out from the monthly fuel bill. */
  function kmPerMonth(p, car) {
    if (p.mode === "fuel") return (p.fuel_spend_month / p.fuel_price) * 100 / blended(car, p.city_share).fuel;
    return p.km_month;
  }

  /** Project-defined bands for the yearly CO2 of one car. */
  function band(totalKg) {
    if (totalKg < 1500) return "Low";
    if (totalKg < 3000) return "Moderate";
    if (totalKg < 5000) return "High";
    return "Very high";
  }

  /** Yearly CO2 (kg), fuel (litres), fuel cost and everyday comparisons. */
  function estimate(p, car, f) {
    const s = Math.min(100, Math.max(0, p.city_share)) / 100;
    const km = kmPerMonth(p, car), kmYear = km * 12;
    const b = blended(car, p.city_share);
    const perLitre = car.co2_g_km / car.fuel_comb;
    const city = s * kmYear * car.fuel_city * perLitre / 1000;
    const hwy = (1 - s) * kmYear * car.fuel_hwy * perLitre / 1000;
    const total = city + hwy, litres = b.fuel * kmYear / 100;
    return {
      km_month: km, co2: b.co2, fuel: b.fuel, parts: { "City driving": city, "Highway driving": hwy },
      total, litres, cost: litres * p.fuel_price, band: band(total),
      comparisons: f ? { trees: total / f.tree_per_year, indian: total / f.india_per_capita, lpg: total / f.lpg_cylinder } : null,
    };
  }

  /** Yearly CO2 and charging cost of an electric car on India's grid, for the same driving. */
  function estimateEv(p, ev, kmMonth, f) {
    const kwhYear = blendedEv(ev, p.city_share) * kmMonth * 12 / 100;
    return { kwh: blendedEv(ev, p.city_share), kwhYear, total: kwhYear * f.grid_india, cost: kwhYear * p.elec_price,
      co2: blendedEv(ev, p.city_share) * f.grid_india * 10 };
  }

  const bodyType = (cls, model = "") =>
    (/SUV|SPECIAL/i.test(cls) || /\bSUV\b|^iX|^EQB|^G 580/.test(model)) ? "suv" : "car";

  /** Cleanest car in the same class (E85 flex-fuel ratings are skipped). */
  function bestAlternative(car, models) {
    let best = null;
    for (const v of models) {
      if (v.vehicle_class !== car.vehicle_class || v.fuel_type === "E" || v.co2_g_km >= car.co2_g_km) continue;
      if (!best || v.co2_g_km < best.co2_g_km || (v.co2_g_km === best.co2_g_km && v.id < best.id)) best = v;
    }
    return best;
  }

  /** Electric models of the same class (or, failing that, body type), most efficient first. */
  function evOptions(car, evs) {
    const current = evs.filter(e => e.model_year >= EV_MIN_YEAR);
    let pool = current.filter(e => e.vehicle_class === car.vehicle_class);
    if (!pool.length) { const want = bodyType(car.vehicle_class, car.model); pool = current.filter(e => bodyType(e.vehicle_class, e.model) === want); }
    const otherMake = e => (e.make !== car.make ? 1 : 0);
    return pool.slice().sort((a, b) => a.kwh_comb - b.kwh_comb || otherMake(a) - otherMake(b) || a.id - b.id);
  }
  const bestEv = (car, evs) => evOptions(car, evs)[0] || null;

  const classLabel = c => (c.charAt(0) + c.slice(1).toLowerCase()).replace(/suv/i, "SUV");
  const fmt0 = n => Math.round(n).toLocaleString("en-IN");

  /** Suggestions sorted by yearly CO2 saving. Each has kg and rupees saved. */
  function recommend(p, car, models, f, evs) {
    const km = kmPerMonth(p, car), kmYear = km * 12;
    const b = blended(car, p.city_share);
    const totalKg = b.co2 * kmYear / 1000;
    const cost = b.fuel * kmYear / 100 * p.fuel_price;
    const tips = [];
    const add = (kind, title, tip, kg, rupees, extra) => { if (kg > 0.5) tips.push({ kind, title, tip, kg, rupees, ...extra }); };

    const ev = evs ? bestEv(car, evs) : null;
    if (ev) {
      const e = estimateEv(p, ev, km, f);
      add("ev", "Switch to an electric car",
        `The ${ev.make} ${ev.model} (${ev.model_year}) uses ${ev.kwh_comb} kWh per 100 km. Charged from India's grid it would emit about ` +
        `${fmt0(e.total)} kg of CO₂ a year instead of ${fmt0(totalKg)} kg, and charging would cost about ₹${fmt0(e.cost)} a year.`,
        totalKg - e.total, cost - e.cost, { target: ev });
    }
    const alt = bestAlternative(car, models);
    if (alt) {
      const a = blended(alt, p.city_share);
      add("car", "Choose a cleaner car next time",
        `In the same class, the ${alt.make} ${alt.model} (${alt.years}) is rated ${alt.co2_g_km} g/km against ${car.co2_g_km} g/km for your car.`,
        (b.co2 - a.co2) * kmYear / 1000, (b.fuel - a.fuel) * kmYear / 100 * p.fuel_price, { target: alt });
    }
    if (km >= 800) add("habit", "Move one trip in five to bus or metro",
      "You drive a lot. Taking the bus or metro for a fifth of your kilometres still cuts emissions after counting the bus.",
      0.20 * kmYear * (b.co2 / 1000 - f.bus), 0.20 * cost);
    add("habit", "Drive smoothly",
      "Accelerate gently, keep the tyres at the right pressure and switch off instead of idling. This saves about a tenth of your fuel.",
      f.eco_driving * totalKg, f.eco_driving * cost);
    add("habit", "Combine short trips", "Plan errands into one round and skip one drive in ten.", 0.10 * totalKg, 0.10 * cost);
    if (p.city_share >= 70) {
      const cityLike = car.co2_g_km * car.fuel_city / car.fuel_comb, hwyLike = car.co2_g_km * car.fuel_hwy / car.fuel_comb;
      add("habit", "Avoid rush-hour traffic",
        `Your car emits ${cityLike.toFixed(0)} g/km in city traffic and ${hwyLike.toFixed(0)} g/km on open roads. ` +
        "Shifting a tenth of your city driving to free-flowing hours or routes narrows that gap.",
        0.10 * (p.city_share / 100) * kmYear * (cityLike - hwyLike) / 1000,
        0.10 * (p.city_share / 100) * kmYear * (car.fuel_city - car.fuel_hwy) / 100 * p.fuel_price);
    }
    return tips.sort((x, y) => y.kg - x.kg);
  }

  const api = { DEFAULT_PROFILE, EV_MIN_YEAR, blended, blendedEv, kmPerMonth, band, estimate, estimateEv, bodyType,
    bestAlternative, evOptions, bestEv, recommend, classLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Footprint = api;
})(typeof window !== "undefined" ? window : globalThis);

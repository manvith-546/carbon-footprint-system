/* Main page: configurator, car on stage, result, recommendations, electric cars, cleaner cars,
   compare two cars, saved history and the model database.
   The numbers come from footprint.js (same formulas as the Python and Java versions). */
(function () {
  const D = window.CFS_DATA, F = window.Footprint;
  const $ = id => document.getElementById(id);
  const fmt = (n, d = 0) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const models = D.models, evs = D.evs, factors = D.factors;
  const byId = new Map(models.map(m => [m.id, m]));
  const evById = new Map(evs.map(e => [e.id, e]));
  const anyCar = id => byId.get(id) || evById.get(id);
  const isEv = v => evById.has(v.id);
  const yearsOf = v => isEv(v) ? String(v.model_year) : v.years;
  const nameOf = v => `${v.make} ${v.model}`;
  const DEFAULT_CAR = byId.has(D.defaultCarId) ? D.defaultCarId : models[0].id;
  const PAINT = { "BMW": "var(--paint-bmw)", "Mercedes-Benz": "var(--paint-merc)" };
  const BANDS = [["Low", "var(--band-low)"], ["Moderate", "var(--band-mod)"], ["High", "var(--band-high)"], ["Very high", "var(--band-vhigh)"]];
  const BAND_EDGES = [0, 1.5, 3, 5, 8];   // tonnes; must match band() in footprint.js
  const YEARS = 5;                         // horizon of the comparison

  // ------------------------------------------------------------ state (remembered in the browser)
  const KEYS = ["car_id", "mode", "km_month", "fuel_spend_month", "city_share", "fuel_price", "elec_price", "cmp_a", "cmp_b"];
  const state = { ...F.DEFAULT_PROFILE, car_id: DEFAULT_CAR, cmp_a: null, cmp_b: null };
  let storage = null;
  try { storage = window.localStorage; storage.getItem("cfs-car"); } catch (e) { storage = null; }
  try {
    const s = JSON.parse((storage && storage.getItem("cfs-car")) || "{}");
    KEYS.forEach(k => { if (typeof s[k] === "number" || (k === "mode" && (s[k] === "fuel" || s[k] === "distance"))) state[k] = s[k]; });
  } catch (e) { /* ignore a broken saved value */ }
  if (!byId.has(state.car_id)) state.car_id = DEFAULT_CAR;
  const save = () => {
    if (!storage) return;
    try { storage.setItem("cfs-car", JSON.stringify(Object.fromEntries(KEYS.map(k => [k, state[k]])))); } catch (e) { /* full or blocked */ }
  };
  const car = () => byId.get(state.car_id);

  // ------------------------------------------------------------ tooltip
  const tipBox = $("tooltip");
  function showTip(html, x, y) {
    tipBox.innerHTML = html; tipBox.hidden = false;
    const w = tipBox.offsetWidth, h = tipBox.offsetHeight;
    tipBox.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14)) + "px";
    tipBox.style.top = (y - h - 12 < 8 ? y + 18 : y - h - 12) + "px";
  }
  const hideTip = () => { tipBox.hidden = true; };

  // ------------------------------------------------------------ car pictures
  // Generic side views by body type, drawn here (not drawings of a specific model).
  const SHAPES = {
    sedan: {
      body: "M18 112Q18 92 46 88L96 80Q132 50 176 46L240 46Q282 48 312 78L362 86Q384 90 384 108L384 114Q384 121 376 121L26 121Q18 121 18 114Z",
      glass: ["M112 79Q140 58 177 55L201 55L201 79Z", "M209 55L238 55Q270 58 294 79L209 79Z"],
    },
    suv: {
      body: "M18 112Q18 78 50 74L106 70Q128 34 166 30L304 30Q336 32 350 62L374 70Q386 74 386 94L386 114Q386 121 378 121L26 121Q18 121 18 114Z",
      glass: ["M124 68Q142 42 170 39L206 39L206 68Z", "M214 39L264 39L264 68L214 68Z", "M272 39L302 39Q322 42 334 68L272 68Z"],
    },
    wagon: {
      body: "M18 112Q18 92 46 88L96 80Q132 50 176 46L318 46Q346 48 360 80L374 86Q386 90 386 106L386 114Q386 121 378 121L26 121Q18 121 18 114Z",
      glass: ["M112 79Q140 58 177 55L201 55L201 79Z", "M209 55L262 55L262 79L209 79Z", "M270 55L314 55Q334 58 345 79L270 79Z"],
    },
    sports: {
      body: "M18 112Q20 97 60 93L132 87Q162 61 206 58L240 58Q276 60 302 85L364 93Q386 97 386 110L386 114Q386 121 378 121L26 121Q18 121 18 114Z",
      glass: ["M148 86Q170 69 206 66L238 66Q262 68 284 86Z"],
    },
  };
  const TYPE_NAME = { sedan: "saloon", suv: "SUV", wagon: "estate", sports: "sports car" };
  function bodyType(v) {
    const cls = v.vehicle_class;
    if (cls.includes("SUV") || cls.includes("SPECIAL") || /^iX|^EQB|^G 580/.test(v.model)) return "suv";
    if (cls.includes("WAGON")) return "wagon";
    if (cls.includes("TWO-SEATER")) return "sports";
    return "sedan";
  }
  let uid = 0;
  function carSvg(type, paint, electric) {
    const s = SHAPES[type], u = "cv" + (++uid);
    const spokes = x => [18, 90, 162, 234, 306].map(a => {
      const r = a * Math.PI / 180;
      return `<path d="M${x} 121L${(x + 14 * Math.cos(r)).toFixed(1)} ${(121 + 14 * Math.sin(r)).toFixed(1)}" stroke="#39424a" stroke-width="3.4" stroke-linecap="round"/>`;
    }).join("");
    const wheel = x => `<circle cx="${x}" cy="121" r="29" fill="#030507"/><circle cx="${x}" cy="121" r="24.5" fill="#0c0f12"/>` +
      `<circle cx="${x}" cy="121" r="17" fill="url(#${u}r)"/>${spokes(x)}<circle cx="${x}" cy="121" r="4.5" fill="#e6e9eb"/>` +
      `<circle cx="${x}" cy="121" r="17" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1"/>`;
    const label = `Illustration of ${electric ? "an electric" : type === "suv" ? "an" : "a"} ${TYPE_NAME[type]}`;
    return `<svg viewBox="0 0 404 160" role="img" aria-label="${label}">` +
      `<defs><linearGradient id="${u}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/>` +
      `<stop offset=".36" stop-color="#fff" stop-opacity=".05"/><stop offset=".68" stop-color="#000" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>` +
      `<linearGradient id="${u}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6f8595"/><stop offset=".5" stop-color="#1c2832"/><stop offset="1" stop-color="#0c141a"/></linearGradient>` +
      `<radialGradient id="${u}r" cx=".38" cy=".32" r=".85"><stop offset="0" stop-color="#f2f4f5"/><stop offset=".55" stop-color="#9aa3aa"/><stop offset="1" stop-color="#3f474e"/></radialGradient>` +
      `<radialGradient id="${u}f"><stop offset="0" stop-color="#000" stop-opacity=".8"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
      `<filter id="${u}b" x="-100%" y="-300%" width="300%" height="700%"><feGaussianBlur stdDeviation="5"/></filter></defs>` +
      `<ellipse cx="202" cy="147" rx="198" ry="13" fill="url(#${u}f)"/>` +
      `<path d="${s.body}" fill="${paint}"/><path d="${s.body}" fill="url(#${u}s)"/>` +
      s.glass.map(g => `<path d="${g}" fill="url(#${u}g)"/>`).join("") +
      `<path d="M58 100H352" stroke="${electric ? "rgba(79,210,154,.75)" : "rgba(255,255,255,.22)"}" stroke-width="${electric ? 2 : 1.3}"/>` +
      `<ellipse cx="22" cy="99" rx="22" ry="7" fill="${electric ? "#bff3dc" : "#ffe7a8"}" opacity=".55" filter="url(#${u}b)"/>` +
      `<rect x="20" y="96" width="17" height="6" rx="3" fill="#fff7df"/><rect x="371" y="94" width="13" height="7" rx="3" fill="#ff4f4f"/>` +
      wheel(102) + wheel(306) + `</svg>`;
  }
  /** Fills an element with a photo from web/images if one was added, otherwise the illustration. */
  function paint(el, v) {
    const type = bodyType(v), electric = isEv(v);
    el.innerHTML = carSvg(type, PAINT[v.make], electric);
    const img = new Image();
    img.alt = `${v.make} ${electric ? "electric " : ""}${TYPE_NAME[type]}`;
    img.onload = () => { el.innerHTML = ""; el.appendChild(img); };
    img.src = `images/${v.make === "BMW" ? "bmw" : "mercedes"}-${type}.jpg`;
  }
  const tierTag = t => `<span class="tag ${t}">${t}</span>`;

  // ------------------------------------------------------------ reusable searchable picker (combobox)
  function makeCombo(input, list, cfg) {
    let options = [], active = -1;
    function open(query) {
      options = cfg.items((query || "").trim().toLowerCase());
      active = Math.max(0, options.findIndex(o => o.id === cfg.current()));
      list.innerHTML = options.length ? options.map((o, i) =>
        `<li role="option" id="${list.id}-${o.id}" data-id="${o.id}" aria-selected="${o.id === cfg.current()}" class="${i === active ? "active" : ""}">${cfg.render(o)}</li>`).join("")
        : `<li class="none">${cfg.empty(query)}</li>`;
      list.hidden = false; input.setAttribute("aria-expanded", "true");
      const el = list.querySelector("li.active"); if (el) el.scrollIntoView({ block: "nearest" });
    }
    function close() { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.value = cfg.label(); }
    function move(d) {
      if (!options.length) return;
      active = (active + d + options.length) % options.length;
      list.querySelectorAll("li").forEach((li, i) => li.classList.toggle("active", i === active));
      const el = list.children[active]; el.scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", el.id);
    }
    input.addEventListener("focus", () => { input.select(); open(""); });
    input.addEventListener("input", () => open(input.value));
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) open(""); else move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); if (options[active]) { cfg.pick(options[active].id); input.blur(); } }
      else if (e.key === "Escape") { close(); }
    });
    input.addEventListener("blur", () => setTimeout(close, 120));
    list.addEventListener("mousedown", e => {
      const li = e.target.closest("li[data-id]"); if (!li) return;
      e.preventDefault(); cfg.pick(Number(li.dataset.id)); input.blur();
    });
    return { sync: close };
  }
  const byName = (x, y) => x.model.localeCompare(y.model) || (y.year_to || y.model_year) - (x.year_to || x.model_year);

  // main model picker: one brand at a time
  const brandNow = () => document.querySelector('input[name="brand"]:checked').value;
  const mainCombo = makeCombo($("modelInput"), $("modelList"), {
    items: q => models.filter(m => m.make === brandNow() && (!q || m.model.toLowerCase().includes(q) ||
      m.vehicle_class.toLowerCase().includes(q) || m.years.includes(q))).sort(byName),
    current: () => state.car_id,
    label: () => `${car().model} (${car().years})`,
    render: m => `<b>${esc(m.model)}</b><span class="g">${m.co2_g_km} g/km</span>` +
      `<small>${esc(m.years)} · ${F.classLabel(m.vehicle_class)} · ${m.engine_l.toFixed(1)} L ${esc(m.fuel_name.toLowerCase())} · ${esc(m.transmission_name)}</small>`,
    empty: q => `No ${brandNow()} model matches “${esc(q)}”. Try a shorter name.`,
    pick: id => setCar(id),
  });
  const newest = (make, name) => models.filter(m => m.make === make && m.model.toUpperCase() === name)
    .sort((a, b) => b.year_to - a.year_to)[0];
  document.querySelectorAll('input[name="brand"]').forEach(r => r.addEventListener("change", () => {
    if (car().make === r.value) return;
    // start from a well-known model of that brand
    const pick = newest(r.value, r.value === "BMW" ? "X5 XDRIVE40I" : "C 300 4MATIC SEDAN") || models.filter(m => m.make === r.value)[0];
    setCar(pick.id);
  }));

  // ------------------------------------------------------------ inputs
  const fill = el => el.style.setProperty("--fill", (100 * (el.value - el.min) / (el.max - el.min)) + "%");
  function syncInputs() {
    document.querySelector(`input[name="brand"][value="${car().make}"]`).checked = true;
    document.querySelector(`input[name="mode"][value="${state.mode}"]`).checked = true;
    mainCombo.sync();
    ["km_month", "city_share", "fuel_spend_month"].forEach(id => { const el = $(id); el.value = state[id]; fill(el); });
    $("kmBlock").hidden = state.mode === "fuel";
    $("spendBlock").hidden = state.mode !== "fuel";
    $("o_km").textContent = `${fmt(state.km_month)} km a month`;
    $("o_spend").textContent = `₹${fmt(state.fuel_spend_month)} a month`;
    $("o_city").textContent = state.city_share === 0 ? "All highway" : state.city_share === 100 ? "All city" : `${state.city_share}% city`;
    $("fuel_price").value = state.fuel_price;
    $("elec_price").value = state.elec_price;
  }
  ["km_month", "city_share", "fuel_spend_month"].forEach(id => $(id).addEventListener("input", e => {
    state[id] = Number(e.target.value); syncInputs(); update();
  }));
  document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener("change", () => {
    // keep the same driving when switching: the bill that buys this distance, or the distance this bill buys
    const km = F.kmPerMonth(state, car());
    if (r.value === "fuel") state.fuel_spend_month = Math.min(50000, Math.max(1000, Math.round(km * F.blended(car(), state.city_share).fuel / 100 * state.fuel_price / 500) * 500));
    else state.km_month = Math.min(5000, Math.max(100, Math.round(km / 50) * 50));
    state.mode = r.value; syncInputs(); update();
  }));
  const LIMITS = { fuel_price: [50, 200], elec_price: [2, 30] };
  const clamp = (id, v) => Math.min(LIMITS[id][1], Math.max(LIMITS[id][0], v));
  ["fuel_price", "elec_price"].forEach(id => {
    $(id).addEventListener("input", e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) { state[id] = clamp(id, v); update(); } });
    $(id).addEventListener("change", syncInputs);
  });
  document.querySelectorAll(".stepper button").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.for;
    state[id] = clamp(id, Math.round((state[id] + Number(b.dataset.step)) * 10) / 10);
    syncInputs(); update();
  }));
  $("resetBtn").addEventListener("click", () => {
    Object.assign(state, F.DEFAULT_PROFILE, { cmp_a: null, cmp_b: null }); setCar(DEFAULT_CAR);
  });

  function setCar(id) { state.car_id = id; state.cmp_a = null; syncInputs(); update(); highlightRow(); }

  // ------------------------------------------------------------ stage
  let shown = null;
  function drawStage(c) {
    if (shown === c.id) return;
    const first = shown === null;
    shown = c.id;
    paint($("heroCar"), c); paint($("heroReflect"), c);
    if (!first) ["heroCar", "heroReflect"].forEach(id => { const el = $(id); el.classList.remove("drive-in"); void el.offsetWidth; el.classList.add("drive-in"); });
    $("tierTag").className = "tag " + c.tier; $("tierTag").textContent = `${c.tier} emission group`;
    $("stageClass").textContent = `${F.classLabel(c.vehicle_class)} · ${c.years} models`;
    $("stageMake").textContent = c.make;
    $("stageModel").textContent = c.model;
    $("specs").innerHTML = [["Rated CO₂", `${c.co2_g_km} g/km`], ["Engine", `${c.engine_l.toFixed(1)} L, ${c.cylinders} cyl`],
      ["Gearbox", c.transmission_name], ["City / highway", `${c.fuel_city.toFixed(1)} / ${c.fuel_hwy.toFixed(1)} L`]]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
  }

  // ------------------------------------------------------------ gauge
  function bandPos(t) {   // 0..1 along the dial: each band takes a quarter
    for (let i = 0; i < 4; i++) if (t < BAND_EDGES[i + 1]) return (i + (t - BAND_EDGES[i]) / (BAND_EDGES[i + 1] - BAND_EDGES[i])) / 4;
    return 1;
  }
  const CX = 120, CY = 124, R = 96;
  const pt = (a, r) => [CX + r * Math.cos(a * Math.PI / 180), CY - r * Math.sin(a * Math.PI / 180)];
  function arc(a0, a1, r) { const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; }
  function buildGauge() {
    let s = `<path d="${arc(180, 0, R)}" stroke="#1d252c" stroke-width="16" fill="none"/>`;
    BANDS.forEach(([, col], i) => { s += `<path d="${arc(180 - 45 * i - 1, 180 - 45 * (i + 1) + 1, R)}" stroke="${col}" stroke-width="10" fill="none" opacity=".9"/>`; });
    BAND_EDGES.forEach((e, i) => {
      const [x, y] = pt(180 - 45 * i, R + 16);
      s += `<text class="lbl" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${i === 0 ? "end" : i === 4 ? "start" : "middle"}">${i === 4 ? "8+" : e} t</text>`;
    });
    s += `<g class="needle" id="needle" style="transform-origin:${CX}px ${CY}px"><path d="M${CX} ${CY - 3}L${CX - R + 18} ${CY}L${CX} ${CY + 3}Z" fill="var(--text)"/></g>` +
      `<circle cx="${CX}" cy="${CY}" r="7" fill="var(--text)"/><circle cx="${CX}" cy="${CY}" r="3" fill="var(--panel)"/>`;
    $("gauge").innerHTML = s;
  }

  // ------------------------------------------------------------ icons
  const ICONS = {
    ev: '<path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v5"/><path d="M12.6 9.4l-1.6 2.2h2l-1.6 2.2"/>',
    car: '<path d="M3 15l2-5.5A2 2 0 0 1 6.9 8h10.2a2 2 0 0 1 1.9 1.5L21 15v3h-2.2M5.2 18H3v-3h18M8 18h8"/><circle cx="6.6" cy="18" r="1.9"/><circle cx="17.4" cy="18" r="1.9"/>',
    bus: '<rect x="4.5" y="3" width="15" height="14" rx="2.5"/><path d="M4.5 11h15M8 20.5V17M16 20.5V17"/><circle cx="8.2" cy="14" r=".6"/><circle cx="15.8" cy="14" r=".6"/>',
    smooth: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l3.8-5"/><path d="M7 17h.01M17 17h.01"/>',
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6.5a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    tree: '<path d="M12 21v-5"/><path d="M12 3l5 7h-3l4 6H6l4-6H7z"/>',
    person: '<circle cx="12" cy="7" r="3.2"/><path d="M5.5 20.5v-2a6.5 6.5 0 0 1 13 0v2"/>',
    gas: '<rect x="6.5" y="7" width="11" height="14" rx="4"/><path d="M9.5 7V4.5h5V7M6.5 12h11"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const tipIcon = t => t.kind === "ev" ? "ev" : t.kind === "car" ? "car" : /bus/i.test(t.title) ? "bus" : /smooth/i.test(t.title) ? "smooth" : /trips/i.test(t.title) ? "route" : "clock";

  // ------------------------------------------------------------ result
  let last = null;   // last estimate, used by the history and the report
  function update() {
    const c = car(), r = F.estimate(state, c, factors);
    last = r;
    drawStage(c);

    // fuel-bill mode: show the distance that bill buys
    $("o_derived").textContent = `That buys about ${fmt(r.km_month)} km a month in this car (${fmt(r.fuel, 1)} L per 100 km at your mix, ₹${fmt(state.fuel_price)} a litre).`;

    // gauge
    const t = r.total / 1000, bi = BANDS.findIndex(b => b[0] === r.band);
    $("needle").style.transform = `rotate(${(bandPos(t) * 180).toFixed(1)}deg)`;
    $("gTotal").textContent = fmt(t, 2);
    $("gBand").innerHTML = `<i style="background:${BANDS[bi][1]}"></i><span><b>${r.band}</b> for one car · about ${fmt(r.total / 365, 1)} kg of CO₂ a day</span>`;

    // tiles
    $("tLitres").textContent = fmt(r.litres);
    $("tLitresSub").textContent = `litres a year, ${fmt(r.km_month * 12)} km`;
    $("tCost").textContent = "₹" + fmt(r.cost);
    $("tCo2").textContent = `${fmt(r.co2)} g/km`;
    $("tCo2Sub").textContent = `rated ${c.co2_g_km} g/km at the official mix`;
    const cleaner = models.filter(m => m.co2_g_km < c.co2_g_km).length;
    const pct = Math.round(100 * (models.length - cleaner - 1) / (models.length - 1));
    $("tRank").textContent = `Cleaner than ${pct}%`;
    $("tRankSub").textContent = `${cleaner} of ${models.length} models are rated lower`;
    $("rankMark").style.left = `${100 * cleaner / (models.length - 1)}%`;

    // city / highway split
    const city = r.parts["City driving"], hwy = r.parts["Highway driving"];
    $("splitBar").innerHTML = `<div style="flex-grow:${city};background:var(--gold)"></div><div style="flex-grow:${hwy};background:var(--blue)"></div>`;
    $("splitLegend").innerHTML =
      `<div><i style="background:var(--gold)"></i><b>City driving · ${fmt(city)} kg</b><span>${r.total ? fmt(100 * city / r.total) : 0}% of the total, at ${fmt(c.co2_g_km * c.fuel_city / c.fuel_comb)} g/km</span></div>` +
      `<div><i style="background:var(--blue)"></i><b>Highway driving · ${fmt(hwy)} kg</b><span>${r.total ? fmt(100 * hwy / r.total) : 0}% of the total, at ${fmt(c.co2_g_km * c.fuel_hwy / c.fuel_comb)} g/km</span></div>`;
    $("splitNote").textContent = `${state.city_share}% of ${fmt(r.km_month * 12)} km a year in the city`;

    // everyday comparisons
    const k = r.comparisons;
    $("likes").innerHTML = [
      ["tree", `${fmt(k.trees)} trees`, `would each have to grow for a year to soak it up (about ${fmt(factors.tree_per_year)} kg a tree)`],
      ["person", `${fmt(k.indian, 1)} times`, `an average Indian's yearly CO₂ from everything they do (${fmt(factors.india_per_capita / 1000, 1)} tonnes)`],
      ["gas", `${fmt(k.lpg)} cylinders`, `of 14.2 kg cooking gas (LPG) burned at home`],
    ].map(([ic, big, small]) => `<div class="like"><span class="ico">${icon(ic)}</span><div><b>${big}</b><span>${small}</span></div></div>`).join("");

    // recommendations
    const tips = F.recommend(state, c, models, factors, evs);
    $("tipList").innerHTML = tips.map((tp, i) =>
      `<article class="tip${i === 0 ? " top" : ""}"><span class="ico">${icon(tipIcon(tp))}</span>` +
      `<h3>${esc(tp.title)}</h3><p>${esc(tp.tip)}</p>` +
      `<div class="save"><b>−${fmt(tp.kg)} kg</b><span>CO₂ a year</span><span class="rs">₹${fmt(tp.rupees)}</span><span>less on ${tp.kind === "ev" ? "fuel after charging" : "fuel"}</span>` +
      (tp.target ? `<button type="button" class="link" data-compare="${tp.target.id}">Compare with my car</button>` : "") + `</div>` +
      `<div class="share" title="${fmt(100 * tp.kg / r.total)}% of your car's yearly CO₂"><i style="width:${Math.min(100, 100 * tp.kg / r.total)}%"></i></div></article>`).join("")
      || `<p class="empty">Nothing to suggest at this distance.</p>`;

    drawElectric(c, r);
    drawAlternatives(c, r);
    drawCompare();
    $("reportLink").href = "report.html?" + new URLSearchParams({ car: state.car_id, mode: state.mode, km: state.km_month,
      spend: state.fuel_spend_month, city: state.city_share, fuel: state.fuel_price, elec: state.elec_price }).toString();
    save();
  }
  $("tipList").addEventListener("click", e => {
    const b = e.target.closest("[data-compare]"); if (!b) return;
    compareWith(Number(b.dataset.compare));
  });

  // ------------------------------------------------------------ electric cars
  const baseName = m => m.model.replace(/\s*\(\d+″.*?\)/, "");
  function drawElectric(c, r) {
    const seen = new Set();
    const options = F.evOptions(c, evs).filter(e => { const k = e.make + "|" + baseName(e); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
    const sameClass = options.length && options[0].vehicle_class === c.vehicle_class;
    $("evLead").textContent = options.length
      ? `${sameClass ? F.classLabel(c.vehicle_class) : (F.bodyType(c.vehicle_class, c.model) === "suv" ? "SUV" : "Car")} models on sale from ${F.EV_MIN_YEAR}, most efficient first, charged from India's grid and driven the way you drive.`
      : "No electric BMW or Mercedes-Benz of this type is in the data.";
    $("evCards").innerHTML = options.map(ev => {
      const e = F.estimateEv(state, ev, r.km_month, factors);
      const dKg = r.total - e.total, dRs = r.cost - e.cost;
      const verdict = dKg >= 0
        ? `<p class="alt-save">−${fmt(dKg)} kg CO₂ and ${dRs >= 0 ? "−" : "+"}₹${fmt(Math.abs(dRs))} a year</p>`
        : `<p class="alt-save worse">+${fmt(-dKg)} kg CO₂ a year more than your car on India's grid</p>`;
      return `<article class="alt ev"><div class="car-image" data-car="${ev.id}"></div><div class="alt-body">` +
        `<div class="alt-title"><div><small>${esc(ev.make)} · ${ev.model_year}</small><h3>${esc(ev.model)}</h3></div><span class="tag Electric">Electric</span></div>` +
        `<div class="alt-nums"><div><span>Per 100 km</span><b>${ev.kwh_comb} kWh</b></div><div><span>Range</span><b>${fmt(ev.range_km)} km</b></div>` +
        `<div><span>CO₂ a year</span><b>${fmt(e.total)} kg</b></div><div><span>Charging a year</span><b>₹${fmt(e.cost)}</b></div></div>` +
        verdict + `<button class="outline" type="button" data-compare="${ev.id}">Compare with my car</button></div></article>`;
    }).join("") || `<p class="empty">No electric model to suggest for this car.</p>`;
    $("evCards").querySelectorAll(".car-image[data-car]").forEach(el => paint(el, anyCar(Number(el.dataset.car))));
    $("evNote").textContent = `An electric car has no exhaust, but the power station does: India's grid emits about ${factors.grid_india} kg of CO₂ for each kWh generated ` +
      `(Central Electricity Authority, 2023–24). Grid losses and making the battery are not counted, so the real saving is somewhat smaller. Energy use is the Government of Canada rating.`;
  }
  $("evCards").addEventListener("click", e => { const b = e.target.closest("[data-compare]"); if (b) compareWith(Number(b.dataset.compare)); });

  // ------------------------------------------------------------ cleaner cars in the same class
  function drawAlternatives(c, r) {
    const seen = new Set();
    const alts = models.filter(m => m.vehicle_class === c.vehicle_class && m.fuel_type !== "E" && m.co2_g_km < c.co2_g_km)
      .sort((a, b) => a.co2_g_km - b.co2_g_km || a.id - b.id)
      .filter(m => { const k = m.make + "|" + m.model; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
    $("altLead").textContent = alts.length
      ? `${F.classLabel(c.vehicle_class)} models rated lower than your ${c.model}, with what each would save at your driving.`
      : "";
    const kmYear = r.km_month * 12, me = F.blended(c, state.city_share);
    $("altCards").innerHTML = alts.length ? alts.map(m => {
      const a = F.blended(m, state.city_share);
      return `<article class="alt"><div class="car-image" data-car="${m.id}"></div><div class="alt-body">` +
        `<div class="alt-title"><div><small>${esc(m.make)} · ${esc(m.years)}</small><h3>${esc(m.model)}</h3></div>${tierTag(m.tier)}</div>` +
        `<div class="alt-nums"><div><span>Rated CO₂</span><b>${m.co2_g_km} g/km</b></div><div><span>Combined</span><b>${m.fuel_comb.toFixed(1)} L/100 km</b></div></div>` +
        `<p class="alt-save">−${fmt((me.co2 - a.co2) * kmYear / 1000)} kg CO₂ and ₹${fmt((me.fuel - a.fuel) * kmYear / 100 * state.fuel_price)} a year</p>` +
        `<button class="outline" type="button" data-use="${m.id}">Put this car on stage</button></div></article>`;
    }).join("") : `<p class="empty">Your ${esc(c.model)} is already the lowest-rated ${F.classLabel(c.vehicle_class).toLowerCase()} petrol or diesel model in the data. See the electric options above.</p>`;
    $("altCards").querySelectorAll(".car-image[data-car]").forEach(el => paint(el, byId.get(Number(el.dataset.car))));
  }
  $("altCards").addEventListener("click", e => {
    const b = e.target.closest("[data-use]"); if (!b) return;
    setCar(Number(b.dataset.use)); $("estimate").scrollIntoView({ behavior: "smooth" });
  });

  // ------------------------------------------------------------ compare two cars
  const everything = models.concat(evs);
  const cmpA = () => anyCar(state.cmp_a) || car();
  const cmpB = () => {
    const b = anyCar(state.cmp_b);
    if (b && b.id !== cmpA().id) return b;
    return F.bestEv(car(), evs) || F.bestAlternative(car(), models) || models.find(m => m.id !== cmpA().id);
  };
  const pickerFor = (side, get) => makeCombo($(side === "a" ? "cmpA" : "cmpB"), $(side === "a" ? "cmpListA" : "cmpListB"), {
    items: q => everything.filter(v => !q || `${v.make} ${v.model} ${yearsOf(v)} ${isEv(v) ? "electric ev" : ""}`.toLowerCase().includes(q))
      .sort((x, y) => x.make.localeCompare(y.make) || byName(x, y)).slice(0, 200),
    current: () => get().id,
    label: () => `${nameOf(get())} (${yearsOf(get())})`,
    render: v => `<b>${esc(v.make)} ${esc(v.model)}</b><span class="g">${isEv(v) ? `${v.kwh_comb} kWh` : `${v.co2_g_km} g/km`}</span>` +
      `<small>${isEv(v) ? `Electric · ${v.model_year}` : esc(v.years)} · ${F.classLabel(v.vehicle_class)}</small>`,
    empty: q => `Nothing matches “${esc(q)}”. Try a model name such as X5, EQE or i4.`,
    pick: id => { state[side === "a" ? "cmp_a" : "cmp_b"] = id; drawCompare(); save(); },
  });
  const comboA = pickerFor("a", cmpA), comboB = pickerFor("b", cmpB);
  $("cmpSwap").addEventListener("click", () => { const a = cmpA().id, b = cmpB().id; state.cmp_a = b; state.cmp_b = a; drawCompare(); save(); });
  function compareWith(id) {
    state.cmp_a = state.car_id; state.cmp_b = id; drawCompare(); save();
    $("compare").scrollIntoView({ behavior: "smooth" });
  }

  /** Yearly CO2, cost and energy use of any car (petrol, diesel or electric) for this driving. */
  function yearly(v, km) {
    if (isEv(v)) {
      const e = F.estimateEv(state, v, km, factors);
      return { kg: e.total, cost: e.cost, perKm: e.co2, energy: `${e.kwh.toFixed(1)} kWh/100 km`, costLabel: "Charging" };
    }
    const e = F.estimate({ ...state, mode: "distance", km_month: km }, v, factors);
    return { kg: e.total, cost: e.cost, perKm: e.co2, energy: `${e.fuel.toFixed(1)} L/100 km`, costLabel: "Fuel" };
  }
  function drawCompare() {
    comboA.sync(); comboB.sync();
    const a = cmpA(), b = cmpB(), km = F.kmPerMonth(state, car());
    const A = yearly(a, km), B = yearly(b, km);
    $("cmpLead").textContent = `Any two models, petrol, diesel or electric, driven ${fmt(km)} km a month with ${state.city_share}% in the city.`;
    const head = (v, cls) => `<div class="cmp-car ${cls}"><div class="car-image" data-car="${v.id}"></div>` +
      `<div><small>${esc(v.make)} · ${isEv(v) ? `Electric, ${v.model_year}` : esc(v.years)}</small><h3>${esc(v.model)}</h3></div></div>`;
    $("cmpCars").innerHTML = head(a, "a") + head(b, "b");
    $("cmpCars").querySelectorAll(".car-image[data-car]").forEach(el => paint(el, anyCar(Number(el.dataset.car))));

    const dKg = (A.kg - B.kg) * YEARS, dRs = (A.cost - B.cost) * YEARS;
    if (a.id === b.id) $("cmpVerdict").textContent = "Pick two different cars to compare.";
    else {
      const co2 = `${Math.abs(dKg) < 50 ? "about the same CO₂" : `${fmt(Math.abs(dKg) / 1000, 1)} tonnes ${dKg > 0 ? "less" : "more"} CO₂`}`;
      const cost = Math.abs(dRs) < 1000 ? "cost about the same to run" : `cost ₹${fmt(Math.abs(dRs))} ${dRs > 0 ? "less" : "more"} to run`;
      const joint = (dKg > 0) === (dRs > 0) || Math.abs(dKg) < 50 || Math.abs(dRs) < 1000 ? "and" : "but";
      $("cmpVerdict").innerHTML = `Over ${YEARS} years the <b>${esc(nameOf(b))}</b> would emit <b>${co2}</b> ${joint} <b>${cost}</b> than the ${esc(nameOf(a))}.`;
    }

    const bar = (label, va, vb, show) => {
      const max = Math.max(va, vb, 1);
      const row = (v, cls, name) => `<div class="cmp-bar ${cls}" data-tip="${esc(name)}: ${show(v)}"><span class="nm">${esc(name)}</span>` +
        `<span class="track"><i style="width:${(100 * v / max).toFixed(1)}%"></i></span><b>${show(v)}</b></div>`;
      return `<div class="cmp-group"><h4>${label}</h4>${row(va, "a", a.model)}${row(vb, "b", b.model)}</div>`;
    };
    $("cmpBars").innerHTML = bar(`CO₂ over ${YEARS} years`, A.kg * YEARS, B.kg * YEARS, v => `${fmt(v / 1000, 1)} t`) +
      bar(`Running cost over ${YEARS} years`, A.cost * YEARS, B.cost * YEARS, v => `₹${fmt(v)}`);

    const diff = (x, y, f) => (Math.abs(x - y) < 1e-9 ? "Same" : (y < x ? "−" : "+") + f(Math.abs(y - x)));
    const rows = [
      ["CO₂ per km", `${fmt(A.perKm)} g`, `${fmt(B.perKm)} g`, diff(A.perKm, B.perKm, v => `${fmt(v)} g`)],
      ["Energy use", A.energy, B.energy, ""],
      ["CO₂ a year", `${fmt(A.kg)} kg`, `${fmt(B.kg)} kg`, diff(A.kg, B.kg, v => `${fmt(v)} kg`)],
      [`CO₂ in ${YEARS} years`, `${fmt(A.kg * YEARS / 1000, 1)} t`, `${fmt(B.kg * YEARS / 1000, 1)} t`, diff(A.kg, B.kg, v => `${fmt(v * YEARS / 1000, 1)} t`)],
      ["Running cost a year", `₹${fmt(A.cost)}`, `₹${fmt(B.cost)}`, diff(A.cost, B.cost, v => `₹${fmt(v)}`)],
      [`Running cost in ${YEARS} years`, `₹${fmt(A.cost * YEARS)}`, `₹${fmt(B.cost * YEARS)}`, diff(A.cost, B.cost, v => `₹${fmt(v * YEARS)}`)],
    ];
    $("cmpTable").innerHTML = `<thead><tr><th></th><th>${esc(a.model)}</th><th>${esc(b.model)}</th><th>Second minus first</th></tr></thead><tbody>` +
      rows.map(r => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td><td class="${r[3].startsWith("−") ? "good" : r[3].startsWith("+") ? "bad" : ""}">${r[3]}</td></tr>`).join("") +
      `</tbody>`;
  }
  $("cmpBars").addEventListener("mousemove", e => { const el = e.target.closest("[data-tip]"); if (el) showTip(el.dataset.tip, e.clientX, e.clientY); else hideTip(); });
  $("cmpBars").addEventListener("mouseleave", hideTip);

  // ------------------------------------------------------------ history (Flask + SQLite, or this browser)
  const hist = { server: false, items: [], memoryOnly: !storage };
  const pad = n => String(n).padStart(2, "0");
  const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const when = s => { const d = new Date(String(s).replace(" ", "T")); return isNaN(d) ? s : d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
  const api = (path, opts) => fetch("api/" + path, { cache: "no-store", ...opts, headers: { "Content-Type": "application/json" } });

  async function initHistory() {
    if (location.protocol === "file:") { await loadHistory(); return; }   // opened as a file: no server to ask
    try {
      const r = await api("health");
      if (r.ok && (await r.json()).history) hist.server = true;
    } catch (e) { /* no server: static website */ }
    await loadHistory();
  }
  async function loadHistory() {
    if (hist.server) {
      try { const r = await api("history"); if (r.ok) hist.items = await r.json(); }
      catch (e) { hist.server = false; }
    }
    if (!hist.server && storage) {
      try { hist.items = JSON.parse(storage.getItem("cfs-history") || "[]"); } catch (e) { hist.items = []; }
    }
    drawHistory();
  }
  const keepLocal = () => { if (storage) try { storage.setItem("cfs-history", JSON.stringify(hist.items)); } catch (e) { /* ignore */ } };

  async function saveEstimate() {
    const body = { car_id: state.car_id, mode: state.mode, km_month: state.km_month, fuel_spend_month: state.fuel_spend_month,
      city_share: state.city_share, fuel_price: state.fuel_price, elec_price: state.elec_price };
    let ok = false;
    if (hist.server) {
      try { const r = await api("history", { method: "POST", body: JSON.stringify(body) }); ok = r.ok; } catch (e) { ok = false; }
      if (ok) await loadHistory();
    } else {
      const c = car(), r = last;
      hist.items.push({ id: Date.now(), saved_at: stamp(new Date()), car_id: c.id, car: `${c.make} ${c.model} (${c.years})`, mode: state.mode,
        km_month: Math.round(r.km_month * 10) / 10, city_share: state.city_share, fuel_price: state.fuel_price,
        total_kg: Math.round(r.total * 10) / 10, fuel_cost: Math.round(r.cost) });
      keepLocal(); drawHistory(); ok = true;
    }
    const note = $("savedNote");
    note.textContent = ok ? `Saved: ${fmt(last.total / 1000, 2)} tonnes a year. See My history below.` : "Could not save. Is the server still running?";
    clearTimeout(note._t); note._t = setTimeout(() => { note.textContent = ""; }, 5000);
  }
  async function deleteEntry(id) {
    if (hist.server) { try { await api("history/" + id, { method: "DELETE" }); } catch (e) { /* ignore */ } await loadHistory(); }
    else { hist.items = hist.items.filter(x => x.id !== id); keepLocal(); drawHistory(); }
  }
  async function clearAll() {
    if (hist.server) { try { await api("history", { method: "DELETE" }); } catch (e) { /* ignore */ } await loadHistory(); }
    else { hist.items = []; keepLocal(); drawHistory(); }
  }
  $("saveBtn").addEventListener("click", saveEstimate);
  $("saveBtn2").addEventListener("click", saveEstimate);
  let armed = null;
  $("clearHist").addEventListener("click", () => {
    const b = $("clearHist");
    if (!hist.items.length) return;
    if (armed) { clearTimeout(armed); armed = null; b.textContent = "Delete all"; clearAll(); return; }
    b.textContent = "Press again to delete all";
    armed = setTimeout(() => { armed = null; b.textContent = "Delete all"; }, 4000);
  });
  $("histList").addEventListener("click", e => { const b = e.target.closest("[data-del]"); if (b) deleteEntry(Number(b.dataset.del)); });

  function drawHistory() {
    const items = hist.items.slice().sort((x, y) => String(x.saved_at).localeCompare(String(y.saved_at)) || x.id - y.id);
    $("clearHist").hidden = !items.length;
    $("histWhere").textContent = hist.server
      ? "Saved in the project's SQLite database (data/history.db) through the Flask server."
      : hist.memoryOnly ? "This browser does not allow saving here, so the history lasts until you close the page. Run python python/app.py to keep it in a database."
      : "Saved in this browser only. Run the project with python python/app.py to keep the history in a SQLite database instead.";

    // change since the first save
    if (items.length >= 2) {
      const d = items[items.length - 1].total_kg - items[0].total_kg, p = 100 * d / items[0].total_kg;
      $("histChange").textContent = Math.abs(d) < 1 ? "No change since your first save"
        : `${d < 0 ? "Down" : "Up"} ${fmt(Math.abs(d) / 1000, 2)} t (${d < 0 ? "−" : "+"}${fmt(Math.abs(p))}%) since your first save`;
    } else $("histChange").textContent = items.length ? "Save again later to see a trend" : "";

    // line chart: one series, tonnes per year at each save
    const W = 600, H = 230, L = 44, Rt = 16, T = 16, B = 34;
    if (!items.length) { $("histChart").innerHTML = `<p class="empty">No saves yet. Press <b>Save this estimate</b> to add your first point.</p>`; }
    else {
      const max = Math.max(...items.map(x => x.total_kg)) / 1000;
      const top = Math.max(1, Math.ceil(max * 1.15));
      const step = top <= 4 ? 1 : top <= 8 ? 2 : Math.ceil(top / 4);
      const x = i => items.length === 1 ? (L + W - Rt) / 2 : L + i * (W - L - Rt) / (items.length - 1);
      const y = v => T + (1 - v / top) * (H - T - B);
      let s = "";
      for (let v = 0; v <= top; v += step) s += `<line class="grid" x1="${L}" x2="${W - Rt}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v} t</text>`;
      if (items.length > 1) s += `<path class="line" d="${items.map((it, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(it.total_kg / 1000).toFixed(1)}`).join("")}"/>`;
      const labelAt = new Set([0, items.length - 1]);
      items.forEach((it, i) => {
        const d = new Date(String(it.saved_at).replace(" ", "T"));
        if (labelAt.has(i)) s += `<text class="ax" x="${x(i)}" y="${H - 10}" text-anchor="${items.length === 1 ? "middle" : i === 0 ? "start" : "end"}">${isNaN(d) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</text>`;
        const tipText = `${esc(when(it.saved_at))}<br><b>${fmt(it.total_kg / 1000, 2)} t a year</b><br>${esc(it.car)}<br>${fmt(it.km_month)} km a month, ${fmt(it.city_share)}% city`;
        s += `<circle class="pt" cx="${x(i)}" cy="${y(it.total_kg / 1000)}" r="5"/>` +
          `<circle class="hit" cx="${x(i)}" cy="${y(it.total_kg / 1000)}" r="16" tabindex="0" role="img" aria-label="${esc(when(it.saved_at))}: ${fmt(it.total_kg / 1000, 2)} tonnes a year" data-tip="${esc(tipText)}"/>`;
      });
      $("histChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Yearly CO₂ at each save">${s}</svg>`;
    }

    $("histList").innerHTML = items.slice().reverse().map(it =>
      `<li><div><b>${fmt(it.total_kg / 1000, 2)} t</b><span class="when">${esc(when(it.saved_at))}</span></div>` +
      `<p>${esc(it.car)}</p><p class="muted">${fmt(it.km_month)} km a month${it.mode === "fuel" ? " (from the fuel bill)" : ""} · ${fmt(it.city_share)}% city · ₹${fmt(it.fuel_cost)} fuel a year</p>` +
      `<button type="button" class="del" data-del="${it.id}" aria-label="Delete the save from ${esc(when(it.saved_at))}">×</button></li>`).join("")
      || `<li class="none">Your saved estimates will be listed here, newest first.</li>`;
  }
  const chart = $("histChart");
  const tipFrom = el => { const r = el.getBoundingClientRect(); showTip(el.dataset.tip, r.left + r.width / 2, r.top); };
  chart.addEventListener("mousemove", e => { const el = e.target.closest("[data-tip]"); if (el) showTip(el.dataset.tip, e.clientX, e.clientY); else hideTip(); });
  chart.addEventListener("mouseleave", hideTip);
  chart.addEventListener("focusin", e => { if (e.target.dataset.tip) tipFrom(e.target); });
  chart.addEventListener("focusout", hideTip);

  // ------------------------------------------------------------ model database
  let filtered = models, limit = 15, sortKey = "co2_g_km", sortDir = 1;
  const MAX_CO2 = Math.max(...models.map(m => m.co2_g_km));
  const inYears = (m, y) => !y || (y === "2024" ? m.year_to >= 2024 : y === "2021" ? m.year_to >= 2021 && m.year_to <= 2023 : m.year_to <= 2020);
  function drawTable() {
    const q = $("searchBox").value.trim().toLowerCase(), b = $("brandFilter").value, cl = $("classFilter").value, t = $("tierFilter").value, y = $("yearFilter").value;
    filtered = models.filter(m => (!q || (m.make + " " + m.model + " " + m.fuel_name + " " + m.years).toLowerCase().includes(q)) &&
      (!b || m.make === b) && (!cl || m.vehicle_class === cl) && (!t || m.tier === t) && inYears(m, y))
      .sort((x, z) => ((x[sortKey] > z[sortKey]) - (x[sortKey] < z[sortKey])) * sortDir || x.co2_g_km - z.co2_g_km || x.id - z.id);
    $("tableBody").innerHTML = filtered.slice(0, limit).map(m =>
      `<tr data-row="${m.id}" class="${m.id === state.car_id ? "current" : ""}"><td><b>${esc(m.model)}</b><span class="mk">${m.make}</span></td>` +
      `<td>${esc(m.years)}</td><td>${F.classLabel(m.vehicle_class)}</td><td class="num">${m.engine_l.toFixed(1)} L</td><td>${esc(m.fuel_name)}</td>` +
      `<td class="num">${m.fuel_city.toFixed(1)}</td><td class="num">${m.fuel_hwy.toFixed(1)}</td>` +
      `<td><div class="co2cell"><b>${m.co2_g_km}</b><i style="width:${(100 * m.co2_g_km / MAX_CO2).toFixed(1)}%"></i></div></td>` +
      `<td>${tierTag(m.tier)}</td><td><button class="view" type="button" data-view="${m.id}">View</button></td></tr>`).join("") ||
      `<tr><td colspan="10" class="muted">No model matches these filters. Press Clear to see all models.</td></tr>`;
    $("status").textContent = `Showing ${Math.min(limit, filtered.length)} of ${filtered.length} matching models · ${models.length} in the database`;
    $("more").hidden = filtered.length <= limit;
    document.querySelectorAll("th button[data-sort]").forEach(btn => {
      if (btn.dataset.sort === sortKey) btn.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
      else btn.removeAttribute("aria-sort");
    });
  }
  function highlightRow() { document.querySelectorAll("#tableBody tr[data-row]").forEach(tr => tr.classList.toggle("current", Number(tr.dataset.row) === state.car_id)); }
  document.querySelectorAll("th button[data-sort]").forEach(btn => btn.addEventListener("click", () => {
    sortDir = sortKey === btn.dataset.sort ? -sortDir : 1; sortKey = btn.dataset.sort; drawTable();
  }));
  ["searchBox", "brandFilter", "classFilter", "tierFilter", "yearFilter"].forEach(id =>
    $(id).addEventListener(id === "searchBox" ? "input" : "change", () => { limit = 15; drawTable(); }));
  $("quickSearch").addEventListener("input", e => { $("searchBox").value = e.target.value; limit = 15; drawTable(); });
  $("quickSearch").addEventListener("keydown", e => { if (e.key === "Enter") $("database").scrollIntoView({ behavior: "smooth" }); });
  // On phones the top search box shows only its icon: tapping it jumps to the model search.
  document.querySelector(".top-search").addEventListener("click", e => {
    if ($("quickSearch").offsetParent === null) { e.preventDefault(); $("database").scrollIntoView({ behavior: "smooth" }); setTimeout(() => $("searchBox").focus(), 450); }
  });
  $("clearFilters").addEventListener("click", () => {
    ["searchBox", "brandFilter", "classFilter", "tierFilter", "yearFilter", "quickSearch"].forEach(id => { $(id).value = ""; }); limit = 15; drawTable();
  });
  $("more").addEventListener("click", () => { limit += 30; drawTable(); });

  // ------------------------------------------------------------ details window
  let modalCar = null, lastFocus = null;
  function showDetails(id) {
    const m = byId.get(id); if (!m) return;
    modalCar = id; lastFocus = document.activeElement;
    paint($("modalCar"), m);
    $("modalMake").textContent = `${m.make} · ${m.years} models`;
    $("modalTitle").textContent = m.model;
    $("modalBody").innerHTML = [["Vehicle class", F.classLabel(m.vehicle_class)], ["Emission group (K-Means)", m.tier],
      ["Engine", `${m.engine_l.toFixed(1)} L, ${m.cylinders} cylinders`], ["Gearbox", m.transmission_name], ["Fuel", m.fuel_name],
      ["Performance version", m.performance === "yes" ? "Yes" : "No"], ["All-wheel drive", m.awd === "yes" ? "Yes" : "No"],
      ["City", `${m.fuel_city.toFixed(1)} L/100 km`], ["Highway", `${m.fuel_hwy.toFixed(1)} L/100 km`],
      ["Combined", `${m.fuel_comb.toFixed(1)} L/100 km`], ["Rated CO₂", `${m.co2_g_km} g/km`],
      ["Source", m.year_to <= 2020 ? "Kaggle CO2_Emissions_Canada.csv" : "Government of Canada ratings"]]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
    $("modalUse").hidden = id === state.car_id;
    $("detailModal").classList.add("open"); $("modalClose").focus();
  }
  function closeModal() { $("detailModal").classList.remove("open"); if (lastFocus) lastFocus.focus(); }
  $("tableBody").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) showDetails(Number(b.dataset.view)); });
  $("modalClose").addEventListener("click", closeModal); $("modalDone").addEventListener("click", closeModal);
  $("modalUse").addEventListener("click", () => { closeModal(); setCar(modalCar); $("estimate").scrollIntoView({ behavior: "smooth" }); });
  $("detailModal").addEventListener("click", e => { if (e.target.id === "detailModal") closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("detailModal").classList.contains("open")) closeModal(); });

  // ------------------------------------------------------------ CSV export
  const COLUMNS = [["Brand", "make"], ["Model", "model"], ["Model years", "years"], ["Vehicle class", "vehicle_class"], ["Engine size (L)", "engine_l"],
    ["Cylinders", "cylinders"], ["Transmission", "transmission_name"], ["Fuel", "fuel_name"], ["Performance version", "performance"], ["All-wheel drive", "awd"],
    ["Fuel consumption city (L/100 km)", "fuel_city"], ["Fuel consumption highway (L/100 km)", "fuel_hwy"],
    ["Fuel consumption combined (L/100 km)", "fuel_comb"], ["CO2 emissions (g/km)", "co2_g_km"], ["Emission group", "tier"]];
  // Inside a frame (for example a hosted preview) downloads are often blocked, so copy instead.
  const framed = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  function exportRows(rows, name) {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [COLUMNS.map(c => q(c[0])).join(",")].concat(rows.map(r => COLUMNS.map(c => q(r[c[1]])).join(",")));
    const csv = "﻿" + lines.join("\r\n");   // the BOM lets Excel read ₹, – and ″ correctly
    if (framed) {
      navigator.clipboard.writeText(csv.slice(1))
        .then(() => { $("status").textContent = `Copied ${rows.length} models as CSV. Paste them into Excel or Google Sheets.`; })
        .catch(() => { $("status").textContent = "Copying was blocked here. Open the website on its own to download the CSV."; });
      return;
    }
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }
  if (framed) { $("exportCsv").textContent = "Copy filtered CSV"; $("exportAll").textContent = "Copy all as CSV"; }
  $("exportCsv").addEventListener("click", () => exportRows(filtered, "BMW_Mercedes_filtered_models.csv"));
  $("exportAll").addEventListener("click", () => exportRows(models, "BMW_Mercedes_all_models.csv"));

  // ------------------------------------------------------------ start
  $("nBMW").textContent = `${models.filter(m => m.make === "BMW").length} models`;
  $("nMerc").textContent = `${models.filter(m => m.make === "Mercedes-Benz").length} models`;
  $("classFilter").innerHTML += [...new Set(models.map(m => m.vehicle_class))].sort().map(c => `<option value="${c}">${F.classLabel(c)}</option>`).join("");
  buildGauge(); syncInputs(); drawTable(); update(); initHistory();
})();

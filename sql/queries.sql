-- Analysis queries. Run all of them with: python sql/build_database.py
-- (the title line above each query is printed before its result)

-- name: Average CO2 by brand
SELECT make, COUNT(*) AS variants, ROUND(AVG(co2_g_km), 1) AS avg_co2,
       MIN(co2_g_km) AS lowest, MAX(co2_g_km) AS highest
FROM vehicles GROUP BY make;

-- name: Average CO2 by model-year period - are newer cars cleaner?
SELECT CASE WHEN year_to <= 2020 THEN '2014-2020 (Kaggle)'
            WHEN year_to <= 2023 THEN '2021-2023' ELSE '2024-2026' END AS period,
       COUNT(*) AS variants, ROUND(AVG(co2_g_km), 1) AS avg_co2, ROUND(AVG(fuel_comb), 2) AS avg_l_100km
FROM vehicles GROUP BY period ORDER BY period;

-- name: Five cleanest current models of each brand (on sale in 2024 or later)
SELECT make, model, years, engine_l, fuel_name, co2_g_km FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY make ORDER BY co2_g_km, model) AS rn
    FROM vehicles WHERE year_to >= 2024
) WHERE rn <= 5;

-- name: Average CO2 by vehicle class and brand
SELECT vehicle_class,
       ROUND(AVG(CASE WHEN make = 'BMW' THEN co2_g_km END), 1) AS bmw,
       ROUND(AVG(CASE WHEN make = 'Mercedes-Benz' THEN co2_g_km END), 1) AS mercedes_benz
FROM vehicles GROUP BY vehicle_class ORDER BY vehicle_class;

-- name: Performance and all-wheel-drive versions emit more
SELECT performance, awd, COUNT(*) AS variants, ROUND(AVG(co2_g_km), 1) AS avg_co2
FROM vehicles GROUP BY performance, awd ORDER BY avg_co2;

-- name: Emission groups found by K-Means
SELECT tier, COUNT(*) AS variants, ROUND(AVG(engine_l), 1) AS avg_engine_l,
       ROUND(AVG(co2_g_km), 1) AS avg_co2
FROM vehicles GROUP BY tier ORDER BY avg_co2;

-- name: Recommendation query - cleaner current cars in the same class as the newest Mercedes-Benz C 300 4MATIC Sedan
SELECT v.make, v.model, v.years, v.co2_g_km, mine.co2_g_km - v.co2_g_km AS saving_g_km
FROM vehicles v
JOIN (SELECT vehicle_class, co2_g_km FROM vehicles WHERE model = 'C 300 4MATIC Sedan'
      ORDER BY year_to DESC LIMIT 1) mine
  ON v.vehicle_class = mine.vehicle_class AND v.co2_g_km < mine.co2_g_km AND v.year_to >= 2024
ORDER BY v.co2_g_km LIMIT 5;

-- name: Most efficient electric models on sale (2024 or later), CO2 on India's grid (0.727 kg/kWh)
SELECT make, model, model_year, vehicle_class, kwh_comb, range_km,
       ROUND(kwh_comb * 10 * 0.727, 0) AS grid_co2_g_km
FROM electric_vehicles WHERE model_year >= 2024 ORDER BY kwh_comb LIMIT 8;

-- name: EU fleets - laboratory (WLTP) vs real-world (OBFCM) CO2, weighted by vehicles
SELECT brand, fuel_type, SUM(vehicles) AS vehicles,
       ROUND(SUM(wltp_co2_g_km * vehicles) / SUM(vehicles), 1) AS wltp_co2,
       ROUND(SUM(obfcm_co2_g_km * vehicles) / SUM(vehicles), 1) AS real_world_co2
FROM eu_fleet GROUP BY brand, fuel_type ORDER BY brand, fuel_type;

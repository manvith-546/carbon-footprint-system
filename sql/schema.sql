-- Carbon Footprint Estimation and Recommendation System
-- Database schema (SQLite). Built by: python sql/build_database.py

DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS electric_vehicles;
DROP TABLE IF EXISTS eu_fleet;

-- Petrol and diesel model variants (Kaggle 2014-2020 + Government of Canada 2021-2026)
CREATE TABLE vehicles (
    id                INTEGER PRIMARY KEY,
    make              TEXT NOT NULL CHECK (make IN ('BMW', 'Mercedes-Benz')),
    model             TEXT NOT NULL,
    years             TEXT NOT NULL,      -- model years, e.g. '2024–2026'
    year_from         INTEGER NOT NULL,
    year_to           INTEGER NOT NULL,
    vehicle_class     TEXT NOT NULL,
    engine_l          REAL NOT NULL,
    cylinders         INTEGER NOT NULL,
    transmission      TEXT NOT NULL,      -- code, e.g. AS8
    transmission_name TEXT,               -- e.g. '8-speed automatic'
    fuel_type         TEXT NOT NULL,      -- Z premium petrol, X regular petrol, D diesel, E E85
    fuel_name         TEXT,
    performance       TEXT NOT NULL CHECK (performance IN ('yes', 'no')),   -- AMG, M, ALPINA, Maybach
    awd               TEXT NOT NULL CHECK (awd IN ('yes', 'no')),           -- xDrive, 4MATIC
    fuel_city         REAL NOT NULL,      -- city fuel consumption, L/100 km
    fuel_hwy          REAL NOT NULL,      -- highway fuel consumption, L/100 km
    fuel_comb         REAL NOT NULL,      -- combined fuel consumption, L/100 km
    co2_g_km          INTEGER NOT NULL,   -- tailpipe CO2, g/km
    tier              TEXT                -- K-Means emission group: Low / Medium / High
);

-- Battery-electric models (Government of Canada, latest model year of each)
CREATE TABLE electric_vehicles (
    id            INTEGER PRIMARY KEY,
    make          TEXT NOT NULL,
    model         TEXT NOT NULL,
    model_year    INTEGER NOT NULL,
    vehicle_class TEXT NOT NULL,
    motor_kw      INTEGER,
    kwh_city      REAL NOT NULL,          -- electricity use, kWh/100 km
    kwh_hwy       REAL NOT NULL,
    kwh_comb      REAL NOT NULL,
    range_km      INTEGER,
    recharge_h    REAL                    -- hours on a 240 V charger
);

CREATE TABLE eu_fleet (
    brand              TEXT NOT NULL,
    manufacturer       TEXT NOT NULL,
    year               INTEGER NOT NULL,
    fuel_type          TEXT NOT NULL,
    vehicles           INTEGER NOT NULL,
    obfcm_fuel_l_100km REAL,
    wltp_fuel_l_100km  REAL,
    fuel_gap_l_100km   REAL,
    fuel_gap_pct       REAL,
    obfcm_co2_g_km     REAL,   -- real-world CO2 (on-board fuel consumption monitoring)
    wltp_co2_g_km      REAL,   -- laboratory CO2
    co2_gap_g_km       REAL,
    co2_gap_pct        REAL
);

CREATE INDEX idx_vehicles_class ON vehicles (vehicle_class, co2_g_km);
CREATE INDEX idx_vehicles_year ON vehicles (year_to);

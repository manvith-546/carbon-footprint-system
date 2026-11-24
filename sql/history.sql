-- Saved estimates ("My history" on the website, when it runs with python python/app.py).
-- python/app.py creates this table in data/history.db on its first start.
CREATE TABLE IF NOT EXISTS estimates (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    saved_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    car_id       INTEGER NOT NULL,
    car          TEXT    NOT NULL,          -- e.g. "BMW X5 xDrive40i (2024–2026)"
    mode         TEXT    NOT NULL CHECK (mode IN ('distance', 'fuel')),
    km_month     REAL    NOT NULL,
    city_share   REAL    NOT NULL,
    fuel_price   REAL    NOT NULL,
    total_kg     REAL    NOT NULL,          -- yearly CO2 at the time of saving
    fuel_cost    REAL    NOT NULL,          -- yearly fuel cost in rupees
    note         TEXT                        -- optional, e.g. "after switching to metro"
);

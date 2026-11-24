import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Scanner;

/**
 * Carbon Footprint Estimation and Recommendation System - Java console version.
 *
 * Estimates the yearly CO2, fuel and fuel cost of a BMW or Mercedes-Benz car
 * and recommends how to cut it. Same data and formulas as the Python version:
 *   data/processed/bmw_mercedes_models.csv   (petrol and diesel model variants)
 *   data/processed/bmw_mercedes_evs.csv      (electric models)
 *   data/emission_factors.csv                (emission factors)
 *
 * It also fits a simple linear regression (least squares) in plain Java:
 *   CO2 (g/km) = a + b * fuel consumption (L/100 km)
 *
 * Compile (from the project folder):  javac -d java/out java/CarbonFootprintApp.java
 * Run:                                java -cp java/out CarbonFootprintApp
 * Run with the sample car:            java -cp java/out CarbonFootprintApp --demo
 */
public class CarbonFootprintApp {

    static final int EV_MIN_YEAR = 2024;   // only suggest electric models still on sale

    /** One BMW or Mercedes-Benz model variant from the dataset. */
    static class Vehicle {
        int id, yearTo; String make, model, years, vehicleClass, transmissionName, fuelType, fuelName;
        double engineL, fuelCity, fuelHwy, fuelComb, co2;
    }

    /** One electric BMW or Mercedes-Benz model (latest model year). */
    static class Ev {
        int id, modelYear; String make, model, vehicleClass;
        double kwhCity, kwhHwy, kwhComb;
    }

    /** Answers given by the user. */
    static class Profile {
        Vehicle car;
        String mode = "distance";      // "distance" or "fuel"
        double kmMonth = 1000;         // kilometres driven per month
        double fuelSpendMonth = 10000; // rupees spent on fuel per month (mode "fuel")
        double cityShare = 55;         // % of driving in the city (55 = the official combined rating)
        double fuelPrice = 100;        // rupees per litre
        double elecPrice = 8;          // rupees per kWh
    }

    static class Tip {
        String title, text; double savingKg, savingRupees;
        Tip(String t, String x, double kg, double rs) { title = t; text = x; savingKg = kg; savingRupees = rs; }
    }

    // ------------------------------------------------------------ loading

    /** Splits one CSV line, respecting "quoted, fields". */
    static List<String> splitCsv(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                if (quoted && i + 1 < line.length() && line.charAt(i + 1) == '"') { cur.append('"'); i++; }
                else quoted = !quoted;
            } else if (c == ',' && !quoted) { out.add(cur.toString()); cur.setLength(0); }
            else cur.append(c);
        }
        out.add(cur.toString());
        return out;
    }

    static Path find(String relative) throws IOException {
        for (String base : new String[] {"", "../", "../../"}) {
            Path p = Paths.get(base + relative);
            if (Files.exists(p)) return p;
        }
        throw new IOException("Cannot find " + relative
                + ". Run this program from the project folder, after python/1_prepare_data.py.");
    }

    static List<Map<String, String>> readCsv(String relative) throws IOException {
        List<String> lines = Files.readAllLines(find(relative), StandardCharsets.UTF_8);
        List<String> header = splitCsv(lines.get(0));
        List<Map<String, String>> rows = new ArrayList<>();
        for (String line : lines.subList(1, lines.size())) {
            if (line.trim().isEmpty()) continue;
            List<String> cells = splitCsv(line);
            Map<String, String> row = new HashMap<>();
            for (int i = 0; i < header.size() && i < cells.size(); i++) row.put(header.get(i), cells.get(i));
            rows.add(row);
        }
        return rows;
    }

    /** Plain ASCII for any console: 2024–2026 -> 2024-2026, 20″ -> 20". */
    static String plain(String s) {
        return s == null ? "" : s.replace('\u2013', '-').replace('\u2033', '"');
    }

    static List<Vehicle> loadVehicles() throws IOException {
        List<Vehicle> list = new ArrayList<>();
        for (Map<String, String> r : readCsv("data/processed/bmw_mercedes_models.csv")) {
            Vehicle v = new Vehicle();
            v.id = Integer.parseInt(r.get("id"));
            v.make = r.get("make"); v.model = plain(r.get("model")); v.years = plain(r.get("years"));
            v.yearTo = Integer.parseInt(r.get("year_to"));
            v.vehicleClass = r.get("vehicle_class");
            v.transmissionName = r.get("transmission_name");
            v.fuelType = r.get("fuel_type"); v.fuelName = r.get("fuel_name");
            v.engineL = Double.parseDouble(r.get("engine_l"));
            v.fuelCity = Double.parseDouble(r.get("fuel_city"));
            v.fuelHwy = Double.parseDouble(r.get("fuel_hwy"));
            v.fuelComb = Double.parseDouble(r.get("fuel_comb"));
            v.co2 = Double.parseDouble(r.get("co2_g_km"));
            list.add(v);
        }
        return list;
    }

    static List<Ev> loadEvs() throws IOException {
        List<Ev> list = new ArrayList<>();
        for (Map<String, String> r : readCsv("data/processed/bmw_mercedes_evs.csv")) {
            Ev e = new Ev();
            e.id = Integer.parseInt(r.get("id"));
            e.make = r.get("make"); e.model = plain(r.get("model")); e.vehicleClass = r.get("vehicle_class");
            e.modelYear = Integer.parseInt(r.get("model_year"));
            e.kwhCity = Double.parseDouble(r.get("kwh_city"));
            e.kwhHwy = Double.parseDouble(r.get("kwh_hwy"));
            e.kwhComb = Double.parseDouble(r.get("kwh_comb"));
            list.add(e);
        }
        return list;
    }

    static Map<String, Double> loadFactors() throws IOException {
        Map<String, Double> f = new HashMap<>();
        for (Map<String, String> r : readCsv("data/emission_factors.csv"))
            f.put(r.get("key"), Double.parseDouble(r.get("value")));
        return f;
    }

    /** The sample car: the newest BMW X5 xDrive40i. */
    static Vehicle defaultCar(List<Vehicle> all) {
        Vehicle best = null;
        for (Vehicle v : all)
            if (v.model.equalsIgnoreCase("X5 xDrive40i") && (best == null || v.yearTo > best.yearTo)) best = v;
        return best != null ? best : all.get(0);
    }

    // ------------------------------------------------------------ estimation

    /** Fuel (L/100 km) of a car for a given % of city driving. */
    static double blendedFuel(Vehicle v, double cityShare) {
        double s = Math.min(100, Math.max(0, cityShare)) / 100;
        return s * v.fuelCity + (1 - s) * v.fuelHwy;
    }

    /** CO2 (g/km) for that driving mix: the rated CO2 scaled by the fuel ratio. */
    static double blendedCo2(Vehicle v, double cityShare) {
        return v.co2 * blendedFuel(v, cityShare) / v.fuelComb;
    }

    /** kWh per 100 km of an electric car for a given % of city driving. */
    static double blendedKwh(Ev e, double cityShare) {
        double s = Math.min(100, Math.max(0, cityShare)) / 100;
        return s * e.kwhCity + (1 - s) * e.kwhHwy;
    }

    /** Kilometres a month: given, or worked out from the monthly fuel bill. */
    static double kmPerMonth(Profile p) {
        if (p.mode.equals("fuel")) return (p.fuelSpendMonth / p.fuelPrice) * 100 / blendedFuel(p.car, p.cityShare);
        return p.kmMonth;
    }

    static String band(double totalKg) {
        if (totalKg < 1500) return "Low";
        if (totalKg < 3000) return "Moderate";
        if (totalKg < 5000) return "High";
        return "Very high";
    }

    // ------------------------------------------------------------ recommendation

    /** Cleanest BMW / Mercedes-Benz car in the same class (E85 flex-fuel ratings are skipped). */
    static Vehicle bestAlternative(Vehicle car, List<Vehicle> all) {
        Vehicle best = null;
        for (Vehicle v : all) {
            if (!v.vehicleClass.equals(car.vehicleClass) || v.fuelType.equals("E") || v.co2 >= car.co2) continue;
            if (best == null || v.co2 < best.co2 || (v.co2 == best.co2 && v.id < best.id)) best = v;
        }
        return best;
    }

    static String bodyType(String vehicleClass, String model) {
        boolean suv = vehicleClass.matches("(?i).*(SUV|SPECIAL).*")
                || model.matches(".*\\bSUV\\b.*") || model.startsWith("iX") || model.startsWith("EQB") || model.startsWith("G 580");
        return suv ? "suv" : "car";
    }

    /** Most efficient current electric model in the same class, or else of the same body type. */
    static Ev bestEv(Vehicle car, List<Ev> evs) {
        List<Ev> pool = new ArrayList<>();
        for (Ev e : evs) if (e.modelYear >= EV_MIN_YEAR && e.vehicleClass.equals(car.vehicleClass)) pool.add(e);
        if (pool.isEmpty()) {
            String want = bodyType(car.vehicleClass, car.model);
            for (Ev e : evs) if (e.modelYear >= EV_MIN_YEAR && bodyType(e.vehicleClass, e.model).equals(want)) pool.add(e);
        }
        pool.sort(Comparator.comparingDouble((Ev e) -> e.kwhComb)
                .thenComparingInt(e -> e.make.equals(car.make) ? 0 : 1)
                .thenComparingInt(e -> e.id));
        return pool.isEmpty() ? null : pool.get(0);
    }

    static List<Tip> recommend(Profile p, Map<String, Double> f, List<Vehicle> all, List<Ev> evs) {
        List<Tip> tips = new ArrayList<>();
        double kmMonth = kmPerMonth(p), kmYear = kmMonth * 12;
        double fuel = blendedFuel(p.car, p.cityShare), co2 = blendedCo2(p.car, p.cityShare);
        double totalKg = co2 * kmYear / 1000, cost = fuel * kmYear / 100 * p.fuelPrice;

        Ev ev = bestEv(p.car, evs);
        if (ev != null) {
            double kwhYear = blendedKwh(ev, p.cityShare) * kmYear / 100;
            double evKg = kwhYear * f.get("grid_india"), evCost = kwhYear * p.elecPrice;
            tips.add(new Tip("Switch to an electric car", String.format(Locale.US,
                    "The %s %s (%d) uses %.1f kWh per 100 km. Charged from India's grid it would emit about %.0f kg of CO2 a year instead of %.0f kg.",
                    ev.make, ev.model, ev.modelYear, ev.kwhComb, evKg, totalKg), totalKg - evKg, cost - evCost));
        }
        Vehicle a = bestAlternative(p.car, all);
        if (a != null) tips.add(new Tip("Choose a cleaner car next time", String.format(Locale.US,
                "In the same class, the %s %s (%s) is rated %.0f g/km against %.0f g/km for your car.",
                a.make, a.model, a.years, a.co2, p.car.co2),
                (co2 - blendedCo2(a, p.cityShare)) * kmYear / 1000,
                (fuel - blendedFuel(a, p.cityShare)) * kmYear / 100 * p.fuelPrice));
        if (kmMonth >= 800) tips.add(new Tip("Move one trip in five to bus or metro",
                "Taking the bus or metro for a fifth of your kilometres still cuts emissions after counting the bus.",
                0.20 * kmYear * (co2 / 1000 - f.get("bus")), 0.20 * cost));
        tips.add(new Tip("Drive smoothly",
                "Accelerate gently, keep the tyres at the right pressure and switch off instead of idling.",
                f.get("eco_driving") * totalKg, f.get("eco_driving") * cost));
        tips.add(new Tip("Combine short trips", "Plan errands into one round and skip one drive in ten.",
                0.10 * totalKg, 0.10 * cost));
        if (p.cityShare >= 70) {
            double city = p.car.co2 * p.car.fuelCity / p.car.fuelComb, hwy = p.car.co2 * p.car.fuelHwy / p.car.fuelComb;
            tips.add(new Tip("Avoid rush-hour traffic", String.format(Locale.US,
                    "Your car emits %.0f g/km in city traffic and %.0f g/km on open roads.", city, hwy),
                    0.10 * (p.cityShare / 100) * kmYear * (city - hwy) / 1000,
                    0.10 * (p.cityShare / 100) * kmYear * (p.car.fuelCity - p.car.fuelHwy) / 100 * p.fuelPrice));
        }
        tips.removeIf(t -> t.savingKg <= 0.5);
        tips.sort(Comparator.comparingDouble((Tip t) -> -t.savingKg));
        return tips;
    }

    // ------------------------------------------------------------ machine learning

    /** Least-squares line y = a + b x. Returns {a, b, r2}. */
    static double[] linearRegression(double[] x, double[] y) {
        int n = x.length;
        double mx = Arrays.stream(x).average().orElse(0), my = Arrays.stream(y).average().orElse(0);
        double sxy = 0, sxx = 0, syy = 0;
        for (int i = 0; i < n; i++) {
            sxy += (x[i] - mx) * (y[i] - my);
            sxx += (x[i] - mx) * (x[i] - mx);
            syy += (y[i] - my) * (y[i] - my);
        }
        double b = sxy / sxx, a = my - b * mx;
        return new double[] {a, b, (sxy * sxy) / (sxx * syy)};
    }

    static void printRegression(List<Vehicle> all) {
        List<Vehicle> petrol = new ArrayList<>();
        for (Vehicle v : all) if (v.fuelType.equals("Z")) petrol.add(v);
        double[] x = petrol.stream().mapToDouble(v -> v.fuelComb).toArray();
        double[] y = petrol.stream().mapToDouble(v -> v.co2).toArray();
        double[] m = linearRegression(x, y);
        System.out.printf(Locale.US,
                "%nLinear regression on %d petrol cars:%n  CO2 (g/km) = %.2f + %.2f x fuel (L/100 km)   R2 = %.4f%n",
                x.length, m[0], m[1], m[2]);
        System.out.printf(Locale.US, "  Example: a car using 9.0 L/100 km is predicted to emit %.0f g/km%n",
                m[0] + m[1] * 9.0);
    }

    // ------------------------------------------------------------ console

    static double ask(Scanner in, String text, double def) {
        System.out.printf(Locale.US, "%s [%s]: ", text, def == Math.rint(def) ? String.valueOf((long) def) : String.valueOf(def));
        String raw = in.hasNextLine() ? in.nextLine().trim() : "";
        if (raw.isEmpty()) return def;
        try { return Double.parseDouble(raw); }
        catch (NumberFormatException e) { System.out.println("  Not a number, using the default."); return def; }
    }

    static Vehicle chooseCar(Scanner in, List<Vehicle> all) {
        while (true) {
            System.out.print("Search your car model (e.g. X5, C 300, GLA): ");
            String word = in.hasNextLine() ? in.nextLine().trim().toUpperCase(Locale.ROOT) : "X5";
            List<Vehicle> hits = new ArrayList<>();
            if (!word.isEmpty())
                for (Vehicle v : all) if (v.model.toUpperCase(Locale.ROOT).contains(word) && hits.size() < 20) hits.add(v);
            if (hits.isEmpty()) { System.out.println("  No BMW / Mercedes-Benz model matches. Try a shorter name."); continue; }
            for (Vehicle v : hits)
                System.out.printf(Locale.US, "  %4d  %s %s (%s)  %.1fL %s  %.0f g/km%n",
                        v.id, v.make, v.model, v.years, v.engineL, v.transmissionName, v.co2);
            int id = (int) ask(in, "Type the id of your car", hits.get(0).id);
            for (Vehicle v : all) if (v.id == id) return v;
            return hits.get(0);
        }
    }

    static void show(Profile p, Map<String, Double> f, List<Vehicle> all, List<Ev> evs) {
        double s = Math.min(100, Math.max(0, p.cityShare)) / 100, kmMonth = kmPerMonth(p), kmYear = kmMonth * 12;
        double perLitre = p.car.co2 / p.car.fuelComb;
        double city = s * kmYear * p.car.fuelCity * perLitre / 1000;
        double hwy = (1 - s) * kmYear * p.car.fuelHwy * perLitre / 1000;
        double total = city + hwy, litres = blendedFuel(p.car, p.cityShare) * kmYear / 100;

        System.out.printf(Locale.US, "%n================ %s %s (%s) ================%n", p.car.make, p.car.model, p.car.years);
        if (p.mode.equals("fuel")) System.out.printf(Locale.US, "Your fuel bill means about %.0f km a month in this car.%n", kmMonth);
        System.out.printf(Locale.US, "In your driving mix: %.1f g CO2/km, %.2f L/100 km%n",
                blendedCo2(p.car, p.cityShare), blendedFuel(p.car, p.cityShare));
        Map<String, Double> parts = new LinkedHashMap<>();
        parts.put("City driving", city); parts.put("Highway driving", hwy);
        for (Map.Entry<String, Double> e : parts.entrySet()) {
            int len = (int) Math.round(40 * e.getValue() / Math.max(total, 1));
            System.out.printf(Locale.US, "%-16s%9.1f kg  %s%n", e.getKey(), e.getValue(), "#".repeat(len));
        }
        System.out.printf(Locale.US, "%-16s%9.1f kg CO2 per year = %.2f tonnes  (%s)%n", "TOTAL", total, total / 1000, band(total));
        System.out.printf(Locale.US, "Fuel: %.0f litres a year, about Rs %,.0f%n", litres, litres * p.fuelPrice);
        long cleaner = all.stream().filter(v -> v.co2 < p.car.co2).count();
        System.out.println(cleaner + " of " + all.size() + " BMW / Mercedes-Benz models are rated lower.");

        System.out.println("\nThat is like:");
        System.out.printf(Locale.US, "  - the CO2 that %.0f mature trees absorb in a year%n", total / f.get("tree_per_year"));
        System.out.printf(Locale.US, "  - %.0f%% of an average Indian's total yearly CO2%n", 100 * total / f.get("india_per_capita"));
        System.out.printf(Locale.US, "  - burning %.0f domestic LPG cylinders%n", total / f.get("lpg_cylinder"));

        System.out.println("\n================ RECOMMENDATIONS ================");
        int n = 1;
        for (Tip t : recommend(p, f, all, evs))
            System.out.printf(Locale.US, "%d. %s: saves about %.0f kg CO2 and Rs %,.0f a year.%n   %s%n",
                    n++, t.title, t.savingKg, t.savingRupees, t.text);
    }

    public static void main(String[] args) throws IOException {
        List<Vehicle> vehicles = loadVehicles();
        List<Ev> evs = loadEvs();
        Map<String, Double> factors = loadFactors();
        System.out.println("Car Carbon Footprint Estimation and Recommendation System (BMW / Mercedes-Benz)");
        System.out.println("Loaded " + vehicles.size() + " model variants and " + evs.size() + " electric models.");

        Profile p = new Profile();
        if (args.length > 0 && args[0].equals("--demo")) {
            p.car = defaultCar(vehicles);
            System.out.println("Demo profile: " + p.car.make + " " + p.car.model + " (" + p.car.years
                    + "), 1000 km a month, 55% city driving.");
        } else {
            System.out.println("Press Enter to accept the value in [brackets].\n");
            Scanner in = new Scanner(System.in);
            p.car = chooseCar(in, vehicles);
            p.fuelPrice = ask(in, "Fuel price in rupees per litre", p.fuelPrice);
            System.out.print("Do you know your monthly fuel bill? Type it in rupees, or press Enter to give kilometres: ");
            String spend = in.hasNextLine() ? in.nextLine().trim() : "";
            if (!spend.isEmpty()) {
                try { p.fuelSpendMonth = Double.parseDouble(spend); p.mode = "fuel"; }
                catch (NumberFormatException e) { System.out.println("  Not a number, asking for kilometres instead."); }
            }
            if (!p.mode.equals("fuel")) p.kmMonth = ask(in, "Kilometres driven per month", p.kmMonth);
            p.cityShare = ask(in, "How much of your driving is in the city, in % (0-100)", p.cityShare);
            p.elecPrice = ask(in, "Electricity price in rupees per kWh (for the electric-car suggestion)", p.elecPrice);
        }
        show(p, factors, vehicles, evs);
        printRegression(vehicles);
    }
}

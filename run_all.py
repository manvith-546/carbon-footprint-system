"""
Runs the whole pipeline in order: prepare data -> train models -> export web data -> build database.

Run:  python run_all.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STEPS = ["python/1_prepare_data.py", "python/2_train_models.py",
         "python/4_export_web_data.py", "sql/build_database.py"]

for step in STEPS:
    print(f"\n{'=' * 70}\n>>> {step}\n{'=' * 70}")
    result = subprocess.run([sys.executable, str(ROOT / step)], cwd=ROOT)
    if result.returncode != 0:
        sys.exit(f"Step failed: {step}")

print("\nAll steps finished.")
print("Next:  python python/3_estimate_cli.py     (terminal estimator)")
print("       python python/app.py                (website at http://127.0.0.1:8000)")

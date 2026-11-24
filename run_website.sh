#!/usr/bin/env bash
# Carbon Footprint Estimation and Recommendation System - start the website on macOS or Linux.
# Run from the project folder:  ./run_website.sh   (or: bash run_website.sh)
# First run: creates a virtual environment, installs the packages and trains the models.
set -e
cd "$(dirname "$0")"
echo
echo "  Carbon Footprint Estimation and Recommendation System"
echo

if [ ! -x .venv/bin/python ]; then
  PY=$(command -v python3 || command -v python || true)
  if [ -z "$PY" ]; then
    echo "  Python was not found. Install Python 3.10 or newer from https://www.python.org/downloads/"
    exit 1
  fi
  echo "  Creating a virtual environment in .venv ..."
  "$PY" -m venv .venv || { echo "  Could not create it. On Ubuntu/Debian run: sudo apt install python3-venv"; exit 1; }
fi

echo "  Installing the packages (only slow the first time) ..."
.venv/bin/python -m pip install --disable-pip-version-check -q -r requirements.txt
exec .venv/bin/python python/app.py

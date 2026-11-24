@echo off
rem Carbon Footprint Estimation and Recommendation System - start the website on Windows.
rem Double-click this file, or run it from the VS Code terminal:  .\run_website.bat
rem First run: creates a virtual environment, installs the packages and trains the models.
cd /d "%~dp0"
echo.
echo  Carbon Footprint Estimation and Recommendation System
echo.

if not exist ".venv\Scripts\python.exe" (
  echo  Creating a virtual environment in .venv ...
  py -3 -m venv .venv 2>nul || python -m venv .venv
)
if not exist ".venv\Scripts\python.exe" (
  echo.
  echo  Python was not found. Install Python 3.10 or newer from https://www.python.org/downloads/
  echo  and tick "Add python.exe to PATH" during the installation. Then run this file again.
  pause
  exit /b 1
)

echo  Installing the packages (only slow the first time) ...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt
if errorlevel 1 (
  echo.
  echo  Installing the packages failed. Check your internet connection and run this file again.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" python\app.py
pause

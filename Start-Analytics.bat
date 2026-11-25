@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto python
py -3 tools\platform_server.py
goto done
:python
python tools\platform_server.py
:done
if errorlevel 1 pause

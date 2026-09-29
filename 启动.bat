@echo off
REM ===========================================
REM   LocalAgent v1.1.9 - One-Click Launcher
REM   PURE ASCII — no Chinese chars in this file.
REM   Why: cmd.exe default codepage is GBK on Chinese Windows;
REM         if this file is saved as UTF-8 (no BOM), every Chinese
REM         char / goto label / echo gets mangled -> script breaks.
REM   Workaround: use powershell for ALL Chinese output, and keep
REM         batch labels ASCII.
REM
REM   v1.1.9+: auto-install Python / Node via winget if missing
REM            (Win10 1809+ / Win11; user-scope)
REM ===========================================

cd /d "%~dp0"

REM --- msg helper: print Chinese via PowerShell (UTF-8) ---
set "PSMSG=powershell -NoProfile -Command "Write-Host""

echo.
echo ============================================================
echo   LocalAgent v1.1.9  (local AI Agent platform)
echo ============================================================
echo.

REM ===== Check Python =====
%PSMSG% "[1/6] Checking Python ..." -ForegroundColor Cyan
where python >nul 2>&1
if errorlevel 1 goto no_python
python --version
goto python_ok

:no_python
%PSMSG% "  -> Python not found. Auto-install via winget? (Y/n)" -ForegroundColor Yellow
set /p "PY_CHOICE="
if /I "%PY_CHOICE%"=="n" goto manual_python

where winget >nul 2>&1
if errorlevel 1 (
    %PSMSG% "  [ERROR] winget is not available (Windows too old, need 1809+)." -ForegroundColor Red
    %PSMSG% "  Please install Python 3.11+ manually: https://www.python.org/downloads/" -ForegroundColor Yellow
    %PSMSG% "  IMPORTANT: tick 'Add Python to PATH' during install." -ForegroundColor Yellow
    pause
    exit /b 1
)

%PSMSG% "  [AUTO] Installing Python 3.11 via winget (user-scope, ~30MB, 1-2 min) ..." -ForegroundColor Cyan
winget install -e --id Python.Python.3.11 --scope user --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    %PSMSG% "  [ERROR] winget install failed. Please install Python manually." -ForegroundColor Red
    pause
    exit /b 1
)
%PSMSG% "  [OK] Python 3.11 installed. Configuring PATH ..." -ForegroundColor Green
REM winget Python 3.11 user-scope path
set "PATH=%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python311\Scripts;%PATH%"
where python >nul 2>&1
if errorlevel 1 (
    %PSMSG% "  [WARN] Python installed but PATH not refreshed (Windows quirk)." -ForegroundColor Yellow
    %PSMSG% "  Please re-run this script to pick it up." -ForegroundColor Yellow
    pause
    exit /b 1
)
python --version
goto python_ok

:manual_python
%PSMSG% "  Please install Python 3.11+ from https://www.python.org/downloads/" -ForegroundColor Yellow
%PSMSG% "  IMPORTANT: tick 'Add Python to PATH'. Then re-run this script." -ForegroundColor Yellow
pause
exit /b 1

:python_ok

REM ===== Check Node.js =====
echo.
%PSMSG% "[2/6] Checking Node.js ..." -ForegroundColor Cyan
where node >nul 2>&1
if errorlevel 1 goto no_node
node --version
goto node_ok

:no_node
%PSMSG% "  -> Node.js not found. Auto-install via winget? (Y/n)" -ForegroundColor Yellow
set /p "NODE_CHOICE="
if /I "%NODE_CHOICE%"=="n" goto manual_node

where winget >nul 2>&1
if errorlevel 1 (
    %PSMSG% "  [ERROR] winget is not available." -ForegroundColor Red
    %PSMSG% "  Please install Node.js 20+ manually: https://nodejs.org/" -ForegroundColor Yellow
    pause
    exit /b 1
)

%PSMSG% "  [AUTO] Installing Node.js 20 LTS via winget (user-scope, ~30MB, 1 min) ..." -ForegroundColor Cyan
winget install -e --id OpenJS.NodeJS.LTS --scope user --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    %PSMSG% "  [ERROR] winget install failed. Please install Node.js manually." -ForegroundColor Red
    pause
    exit /b 1
)
%PSMSG% "  [OK] Node.js installed. Configuring PATH ..." -ForegroundColor Green
REM winget Node.js LTS user-scope path
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
    %PSMSG% "  [WARN] Node.js installed but PATH not refreshed (Windows quirk)." -ForegroundColor Yellow
    %PSMSG% "  Please re-run this script to pick it up." -ForegroundColor Yellow
    pause
    exit /b 1
)
node --version
goto node_ok

:manual_node
%PSMSG% "  Please install Node.js 20 LTS from https://nodejs.org/" -ForegroundColor Yellow
%PSMSG% "  Then re-run this script." -ForegroundColor Yellow
pause
exit /b 1

:node_ok

REM ===== Install backend deps if needed =====
echo.
%PSMSG% "[3/6] Checking backend dependencies ..." -ForegroundColor Cyan
python -c "import importlib.util; m=['fastapi','uvicorn','openai','sqlalchemy','duckduckgo_search','bs4','dotenv','multipart','aiofiles','httpx','sse_starlette','pydantic_settings']; x=[n for n in m if importlib.util.find_spec(n) is None]; print('OK' if not x else 'MISS:'+','.join(x))" 2>nul > "%TEMP%\zx-c.txt"
set /p "CR=" < "%TEMP%\zx-c.txt" >nul
del "%TEMP%\zx-c.txt" >nul 2>&1
if not "%CR%"=="OK" goto need_install_backend
%PSMSG% "  [OK] Already installed" -ForegroundColor Green
goto backend_done

:need_install_backend
%PSMSG% "  Installing backend dependencies (1-3 min) ..." -ForegroundColor Cyan
python -m pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple >nul 2>&1
python -m pip install -r backend\requirements.txt > "%TEMP%\zx-backend.log" 2>&1
if errorlevel 1 goto backend_fail
%PSMSG% "  [OK] Backend deps installed" -ForegroundColor Green
goto backend_done

:backend_fail
%PSMSG% "  [FAIL] Backend install error." -ForegroundColor Red
%PSMSG% "  Last 10 lines of log:" -ForegroundColor Yellow
powershell -NoProfile -Command "Get-Content '%TEMP%\zx-backend.log' -Tail 10"
echo.
echo   Full log: %TEMP%\zx-backend.log
pause
exit /b 1

:backend_done

REM ===== Verify optional packages =====
echo.
%PSMSG% "[INFO] Optional packages (RAG):" -ForegroundColor Cyan
python -c "import chromadb" 2>nul
if errorlevel 1 (
    echo    chromadb: NOT installed
) else (
    echo    chromadb: OK
)
python -c "import sentence_transformers" 2>nul
if errorlevel 1 (
    echo    sentence-transformers: NOT installed
) else (
    echo    sentence-transformers: OK
)
python -c "import duckduckgo_search" 2>nul
if errorlevel 1 (
    echo    duckduckgo-search: NOT installed
) else (
    echo    duckduckgo-search: OK
)

REM ===== Install frontend deps if needed =====
echo.
%PSMSG% "[4/6] Checking frontend dependencies ..." -ForegroundColor Cyan
if exist "frontend\node_modules" goto frontend_done
%PSMSG% "  Installing frontend dependencies (2-5 min) ..." -ForegroundColor Cyan
call npm config set registry https://registry.npmmirror.com >nul 2>&1
cd frontend
call npm install --no-audit --no-fund --ignore-scripts > "%TEMP%\zx-frontend.log" 2>&1
if errorlevel 1 goto frontend_fail
cd ..
%PSMSG% "  [OK] Frontend deps installed" -ForegroundColor Green
goto frontend_done

:frontend_fail
cd ..
%PSMSG% "  [FAIL] Frontend install error." -ForegroundColor Red
%PSMSG% "  Last 10 lines of log:" -ForegroundColor Yellow
powershell -NoProfile -Command "Get-Content '%TEMP%\zx-frontend.log' -Tail 10"
echo.
echo   Full log: %TEMP%\zx-frontend.log
pause
exit /b 1

:frontend_done

REM ===== Check .env =====
echo.
%PSMSG% "[5/6] Checking configuration ..." -ForegroundColor Cyan
if exist "backend\.env" goto env_ok
if exist ".env" goto copy_env
if exist ".env.example" goto create_env
%PSMSG% "  [WARN] No .env found, backend may not work." -ForegroundColor Yellow
goto env_ok

:copy_env
copy /Y ".env" "backend\.env" >nul
%PSMSG% "  [OK] .env copied to backend\" -ForegroundColor Green
goto env_ok

:create_env
copy /Y ".env.example" "backend\.env" >nul
%PSMSG% "  [OK] .env created from template" -ForegroundColor Green
goto env_ok

:env_ok

REM ===== Ensure LLM_FALLBACK_MODELS exists =====
findstr /C:"LLM_FALLBACK_MODELS" "backend\.env" >nul 2>&1
if errorlevel 1 (
    %PSMSG% "  [INFO] Adding LLM_FALLBACK_MODELS to backend\.env ..." -ForegroundColor Cyan
    >> "backend\.env" echo.
    >> "backend\.env" echo # Auto-fallback models (v0.6.2+)
    >> "backend\.env" echo LLM_FALLBACK_MODELS=minimax/minimax-m2,minimax/minimax-m1,qwen/qwen-2.5-72b-instruct,meta-llama/llama-3.1-8b-instruct,deepseek/deepseek-chat
)

REM ===== Kill old processes =====
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 "') do taskkill /F /PID %%a >nul 2>&1

REM ===== Start backend + frontend =====
echo.
%PSMSG% "[6/6] Starting services ..." -ForegroundColor Cyan
echo.
%PSMSG% "  Starting backend on port 8000 ..." -ForegroundColor Cyan
cd /d "%~dp0backend"
start "Agent-Backend" cmd /K "python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
cd /d "%~dp0"

%PSMSG% "  Starting frontend on port 3000 ..." -ForegroundColor Cyan
cd /d "%~dp0frontend"
start "Agent-Frontend" cmd /K "npm run dev"
cd /d "%~dp0"

echo.
echo ============================================================
%PSMSG% "  [DONE] Services starting" -ForegroundColor Green
echo ============================================================
echo.
%PSMSG% "  Wait 5-10 seconds, then open browser:" -ForegroundColor Yellow
echo.
echo       http://localhost:3000
echo.
%PSMSG% "  Two service windows should be open:" -ForegroundColor Cyan
%PSMSG% "    Agent-Backend  (do not close)" -ForegroundColor Cyan
%PSMSG% "    Agent-Frontend (do not close)" -ForegroundColor Cyan
echo.
%PSMSG% "  To stop later, run the stop script." -ForegroundColor Cyan
echo.
timeout /t 5 /nobreak >nul
exit /b 0
@echo off
REM ===========================================
REM   LocalAgent v0.1.7 - One-Click Launcher
REM   NO chcp (causes flash close in Win11 Chinese)
REM   Pure ASCII, no BOM
REM
REM   v0.1.7+: 自动检测 Python / Node, 没装就用 winget 装 (Win10 1809+/Win11 自带)
REM ===========================================

cd /d "%~dp0"

echo.
echo ============================================
echo   LocalAgent v0.1.7
echo   (本地化 AI Agent 平台)
echo ============================================
echo.
echo Working dir: %CD%
echo.

REM ===== Check Python =====
echo [1/6] Checking Python...
where python >nul 2>&1
if errorlevel 1 goto no_python
python --version
goto python_ok

:no_python
echo.
echo ============================================================
echo  Python 没装, 但启动.bat 可以自动帮你装 (推荐)
echo ============================================================
echo.
echo  1) 自动装 (用 winget, Win10 1809+/Win11 自带, 不用管理员权限, ~30MB, 1-2 min)
echo  2) 手动装 — 我自己来
echo.
set /p "PY_CHOICE=选择 [默认 1]: "
if "%PY_CHOICE%"=="2" goto manual_python

where winget >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] winget 不可用 — 你的 Windows 太旧 (Win10 1809 以下)
    echo 请手动装 Python 3.11+: https://www.python.org/downloads/
    echo 关键: 安装时勾 'Add Python to PATH'
    echo.
    pause
    exit /b 1
)

echo.
echo [自动装 Python 3.11] 用 winget 安装中 ...
winget install -e --id Python.Python.3.11 --scope user --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo.
    echo [ERROR] winget 装失败, 请手动装: https://www.python.org/downloads/
    echo 关键: 勾 'Add Python to PATH', 装完重新跑 启动.bat
    pause
    exit /b 1
)
echo.
echo [OK] Python 3.11 装完, 配置 PATH ...

REM winget Python 3.11 user scope 安装路径
set "PATH=%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python311\Scripts;%PATH%"
where python >nul 2>&1
if errorlevel 1 (
    echo.
    echo [WARN] Python 装好了, 但 PATH 没刷新 (这是 Windows 已知问题)
    echo 请直接重新跑 启动.bat 即可
    pause
    exit /b 1
)
python --version
goto python_ok

:manual_python
echo.
echo 请打开 https://www.python.org/downloads/ 下载 Python 3.11+
echo 关键: 安装时勾 'Add Python to PATH'
echo 装完重新跑 启动.bat
pause
exit /b 1

:python_ok

REM ===== Check Node.js =====
echo.
echo [2/6] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 goto no_node
node --version
goto node_ok

:no_node
echo.
echo ============================================================
echo  Node.js 没装, 但启动.bat 可以自动帮你装 (推荐)
echo ============================================================
echo.
echo  1) 自动装 (用 winget, 用户级, ~30MB, 1 min)
echo  2) 手动装 — 我自己来
echo.
set /p "NODE_CHOICE=选择 [默认 1]: "
if "%NODE_CHOICE%"=="2" goto manual_node

where winget >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] winget 不可用
    echo 请手动装 Node.js 20+: https://nodejs.org/
    pause
    exit /b 1
)

echo.
echo [自动装 Node.js 20 LTS] 用 winget 安装中 ...
winget install -e --id OpenJS.NodeJS.LTS --scope user --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo.
    echo [ERROR] winget 装失败, 请手动装: https://nodejs.org/
    echo 装完重新跑 启动.bat
    pause
    exit /b 1
)
echo.
echo [OK] Node.js 装完, 配置 PATH ...

REM winget OpenJS.NodeJS.LTS user scope 安装路径
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo [WARN] Node.js 装好了, 但 PATH 没刷新 (Windows 已知问题)
    echo 请直接重新跑 启动.bat 即可
    pause
    exit /b 1
)
node --version
goto node_ok

:manual_node
echo.
echo 请打开 https://nodejs.org/ 下载 Node.js 20 LTS
echo 装完重新跑 启动.bat
pause
exit /b 1

:node_ok

REM ===== Install backend deps if needed =====
echo.
echo [3/6] Checking backend dependencies (no actual import)...
python -c "import importlib.util; m=['fastapi','uvicorn','openai','sqlalchemy','duckduckgo_search','bs4','dotenv','multipart','aiofiles','httpx','sse_starlette','pydantic_settings']; x=[n for n in m if importlib.util.find_spec(n) is None]; print('OK' if not x else 'MISS:'+','.join(x))" 2>nul > "%TEMP%\zx-c.txt"
set /p "CR=" < "%TEMP%\zx-c.txt" >nul
del "%TEMP%\zx-c.txt" >nul 2>&1
if not "%CR%"=="OK" goto need_install_backend
echo [OK] Already installed
goto backend_done

:need_install_backend
echo Installing backend dependencies (1-3 min)...
python -m pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple >nul 2>&1
python -m pip install -r backend\requirements.txt > "%TEMP%\zx-backend.log" 2>&1
if errorlevel 1 goto backend_fail
echo [OK] Backend deps installed
goto backend_done

:backend_fail
echo.
echo [FAIL] Backend install error
echo.
echo Last 10 lines of log:
powershell -Command "Get-Content '%TEMP%\zx-backend.log' -Tail 10" 2>nul
echo.
echo Full log: %TEMP%\zx-backend.log
pause
exit /b 1

:backend_done

REM ===== Verify optional packages =====
echo.
echo [INFO] Checking optional packages (RAG)...
python -c "import chromadb" 2>nul
if errorlevel 1 (
    echo        chromadb: NOT installed
) else (
    echo        chromadb: OK
)
python -c "import sentence_transformers" 2>nul
if errorlevel 1 (
    echo        sentence-transformers: NOT installed
) else (
    echo        sentence-transformers: OK
)
python -c "import duckduckgo_search" 2>nul
if errorlevel 1 (
    echo        duckduckgo-search: NOT installed
) else (
    echo        duckduckgo-search: OK
)

REM ===== Install frontend deps if needed =====
echo.
echo [4/6] Checking frontend dependencies...
if exist "frontend\node_modules" goto frontend_done
echo Installing frontend dependencies (2-5 min)...
call npm config set registry https://registry.npmmirror.com >nul 2>&1
cd frontend
call npm install --no-audit --no-fund --ignore-scripts > "%TEMP%\zx-frontend.log" 2>&1
if errorlevel 1 goto frontend_fail
cd ..
echo [OK] Frontend deps installed
goto frontend_done

:frontend_fail
cd ..
echo.
echo [FAIL] Frontend install error
echo.
echo Last 10 lines of log:
powershell -Command "Get-Content '%TEMP%\zx-frontend.log' -Tail 10" 2>nul
echo.
echo Full log: %TEMP%\zx-frontend.log
pause
exit /b 1

:frontend_done

REM ===== Check .env =====
echo.
echo [5/6] Checking configuration...
if exist "backend\.env" goto env_ok
if exist ".env" goto copy_env
if exist ".env.example" goto create_env
echo [WARN] No .env found, backend may not work
goto env_ok

:copy_env
copy /Y ".env" "backend\.env" >nul
echo [OK] .env copied to backend
goto env_ok

:create_env
copy /Y ".env.example" "backend\.env" >nul
echo [OK] .env created from template
goto env_ok

:env_ok

REM ===== Ensure LLM_FALLBACK_MODELS exists =====
findstr /C:"LLM_FALLBACK_MODELS" "backend\.env" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Adding LLM_FALLBACK_MODELS to backend\.env ...
    >> "backend\.env" echo.
    >> "backend\.env" echo # Auto-fallback models (v0.6.2+)
    >> "backend\.env" echo LLM_FALLBACK_MODELS=minimax/minimax-m2,minimax/minimax-m1,qwen/qwen-2.5-72b-instruct,meta-llama/llama-3.1-8b-instruct,deepseek/deepseek-chat
)

REM ===== Kill old processes =====
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 "') do taskkill /F /PID %%a >nul 2>&1

REM ===== Start backend =====
echo.
echo [6/6] Starting services...
echo.
echo [START] Backend on port 8000...
cd /d "%~dp0backend"
start "Agent-Backend" cmd /K "python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
cd /d "%~dp0"

REM ===== Start frontend =====
echo [START] Frontend on port 3000...
cd /d "%~dp0frontend"
start "Agent-Frontend" cmd /K "npm run dev"
cd /d "%~dp0"

echo.
echo ============================================
echo   [DONE] Services starting
echo ============================================
echo.
echo   Wait 5-10 seconds, then open browser:
echo.
echo       http://localhost:3000
echo.
echo   Two service windows should be open:
echo     Agent-Backend  (do not close)
echo     Agent-Frontend (do not close)
echo.
echo   To stop later, run the stop script.
echo.
timeout /t 5 /nobreak >nul
exit /b 0
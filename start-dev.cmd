@echo off
chcp 65001 >nul
setlocal EnableExtensions
title PromptHelper V5 - Development

cd /d "%~dp0"

set "PROMPT_HELPER_DEFAULT_DATA_FILE=D:\Data\SynologyDrive\Codes\AI\prompt_helper_数据库在这里别删\dist\prompts_data.json"
if not exist "%PROMPT_HELPER_DEFAULT_DATA_FILE%" (
    echo [WARN] Default data file was not found. Select another folder on the startup screen:
    echo %PROMPT_HELPER_DEFAULT_DATA_FILE%
    echo.
)

if exist "C:\Users\Raydio\.cargo\bin\cargo.exe" (
    set "PATH=C:\Users\Raydio\.cargo\bin;%PATH%"
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found. Please install Node.js first.
    goto :failed
)

where cargo >nul 2>nul
if errorlevel 1 (
    echo [ERROR] cargo was not found. Please install Rust first.
    goto :failed
)

if not exist "node_modules\." (
    echo [PromptHelper] Installing project dependencies...
    call npm install
    if errorlevel 1 goto :failed
)

if /i "%~1"=="--check" (
    echo [PromptHelper] Environment check passed.
    echo [PromptHelper] Default data file: %PROMPT_HELPER_DEFAULT_DATA_FILE%
    echo [PromptHelper] The database folder can be changed and remembered on the startup screen.
    exit /b 0
)

echo [PromptHelper] Starting Tauri development mode...
echo [PromptHelper] Frontend changes in src will update automatically.
echo [PromptHelper] Press Ctrl+C to stop.
echo.

call npm run tauri dev
set "APP_EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%APP_EXIT_CODE%"=="0" (
    echo [ERROR] Development mode exited with code %APP_EXIT_CODE%.
) else (
    echo [PromptHelper] Development mode has stopped.
)
echo Press any key to close this window.
pause >nul
exit /b %APP_EXIT_CODE%

:failed
echo.
echo [ERROR] Startup failed. Review the message above.
echo Press any key to close this window.
pause >nul
exit /b 1

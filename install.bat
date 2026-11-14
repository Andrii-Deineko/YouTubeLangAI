@echo off
chcp 65001 >nul
echo ===================================================
echo [YouTube Lang AI] Установка зависимостей (Windows)
echo ===================================================
call npm.cmd install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Ошибка при установке зависимостей.
    pause
    exit /b %ERRORLEVEL%
)
echo [OK] Зависимости успешно установлены.
pause

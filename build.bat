@echo off
chcp 65001 >nul
echo ===================================================
echo [YouTube Lang AI] Сборка расширения Chrome (MV3)
echo ===================================================
call npm.cmd run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Сборка завершилась ошибкой.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo ===================================================
echo [УСПЕХ] Сборка готова в папке:
echo   %CD%\dist
echo.
echo Инструкция по загрузке в браузер (Chrome / Edge / Brave):
echo   1. Откройте chrome://extensions/ (или edge://extensions/)
echo   2. Включите переключатель "Режим разработчика" (Developer mode)
echo   3. Нажмите "Загрузить распакованное" (Load unpacked)
echo   4. Выберите папку: %CD%\dist
echo ===================================================
pause

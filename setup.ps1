# PowerShell скрипт быстрой настройки и сборки YouTube Lang AI на Windows
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host " [YouTube Lang AI] Настройка окружения на Windows" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

# 1. Проверка наличия Node.js
try {
    $nodeVer = node -v
    Write-Host "[OK] Node.js найден: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js не найден в PATH. Установите Node.js (https://nodejs.org/) перед продолжением." -ForegroundColor Red
    exit 1
}

# 2. Установка зависимостей
Write-Host "`n[1/3] Установка зависимостей (npm install)..." -ForegroundColor Yellow
npm.cmd install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Ошибка при установке зависимостей!" -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "[OK] Зависимости установлены." -ForegroundColor Green

# 3. Проверка типов
Write-Host "`n[2/3] Проверка типов TypeScript (typecheck)..." -ForegroundColor Yellow
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Ошибка в проверке типов!" -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "[OK] Типы проверены без ошибок." -ForegroundColor Green

# 4. Сборка проекта
Write-Host "`n[3/3] Сборка расширения (npm run build)..." -ForegroundColor Yellow
npm.cmd run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Ошибка сборки!" -ForegroundColor Red
    exit $LASTEXITCODE
}

$distPath = Join-Path $PSScriptRoot "dist"
Write-Host "`n===================================================" -ForegroundColor Green
Write-Host "[УСПЕХ] Проект успешно собран под Windows!" -ForegroundColor Green
Write-Host "Распакованное расширение находится здесь:" -ForegroundColor White
Write-Host "  $distPath" -ForegroundColor Cyan
Write-Host "`nИнструкция по загрузке в браузер (Chrome / Edge / Brave / Yandex):" -ForegroundColor White
Write-Host "  1. Откройте chrome://extensions/ (или edge://extensions/)" -ForegroundColor Gray
Write-Host "  2. Включите переключатель 'Режим разработчика' (Developer mode)" -ForegroundColor Gray
Write-Host "  3. Нажмите кнопку 'Загрузить распакованное' (Load unpacked)" -ForegroundColor Gray
Write-Host "  4. Укажите папку: $distPath" -ForegroundColor Gray
Write-Host "===================================================" -ForegroundColor Green

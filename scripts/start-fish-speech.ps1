<#
.SYNOPSIS
    Fish Speech S2-Pro API サーバーを起動する
.DESCRIPTION
    setup-fish-speech.ps1 で生成された設定を読み込み、
    Fish Speech の API サーバーを起動する。
.PARAMETER Port
    APIサーバーのポート番号 (デフォルト: 設定ファイルの値 or 8080)
.EXAMPLE
    pwsh -NoProfile -File scripts/start-fish-speech.ps1
    pwsh -NoProfile -File scripts/start-fish-speech.ps1 -Port 9090
#>
param(
    [int]$Port = 0
)

$ErrorActionPreference = "Stop"

# --- パス設定 ---
$projectRoot = Split-Path $PSScriptRoot -Parent
$configPath = Join-Path $projectRoot ".state" "fish-speech.json"

# --- 設定読み込み ---
if (-not (Test-Path $configPath)) {
    Write-Host ""
    Write-Host "  ERROR: Fish Speech is not set up yet." -ForegroundColor Red
    Write-Host "  Run setup first:" -ForegroundColor Yellow
    Write-Host "    npm run fish-speech:setup" -ForegroundColor Cyan
    Write-Host "    or: pwsh -NoProfile -File scripts/setup-fish-speech.ps1" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json

$fishSpeechDir = $config.fishSpeechDir
$venvPython    = $config.venvPython
$checkpointPath = $config.checkpointPath
$codecPath     = $config.codecPath
$halfFlag      = $config.halfFlag
$serverPort    = if ($Port -gt 0) { $Port } else { $config.port }

# --- 前提チェック ---
if (-not (Test-Path $fishSpeechDir)) {
    Write-Host "  ERROR: Fish Speech directory not found: $fishSpeechDir" -ForegroundColor Red
    Write-Host "  Run setup: npm run fish-speech:setup" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $venvPython)) {
    Write-Host "  ERROR: Python venv not found: $venvPython" -ForegroundColor Red
    Write-Host "  Run setup: npm run fish-speech:setup" -ForegroundColor Yellow
    exit 1
}

# --- サーバー起動 ---
Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   Fish Speech S2-Pro API Server      ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Endpoint : http://127.0.0.1:$serverPort" -ForegroundColor White
Write-Host "  Model    : $checkpointPath" -ForegroundColor White
Write-Host "  FP8      : $(if ($halfFlag) { 'Yes' } else { 'No' })" -ForegroundColor White
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

Push-Location $fishSpeechDir
try {
    $args_ = @(
        "tools/api_server.py",
        "--llama-checkpoint-path", $checkpointPath,
        "--decoder-checkpoint-path", $codecPath,
        "--listen", "127.0.0.1:$serverPort"
    )
    if ($halfFlag) {
        $args_ += $halfFlag
    }

    & $venvPython @args_
} finally {
    Pop-Location
}

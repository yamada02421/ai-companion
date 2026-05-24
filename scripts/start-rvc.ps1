# RVC サーバー起動スクリプト
# GPU にモデルをロードして常駐。以降の変換は数秒で完了。
$projectRoot = Split-Path $PSScriptRoot -Parent
$python = Join-Path $projectRoot "rvc_env\Scripts\python.exe"
$server = Join-Path $projectRoot "scripts\rvc_server.py"

if (-not (Test-Path $python)) {
    Write-Host "Error: Python venv not found at $python" -ForegroundColor Red
    exit 1
}

Write-Host "Starting RVC server (GPU model loading may take 20-30s)..." -ForegroundColor Cyan
& $python $server 8090

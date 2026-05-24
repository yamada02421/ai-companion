# =============================================================================
# Fish Speech S2-Pro セットアップスクリプト
# =============================================================================
#
# 使い方:
#   .\scripts\setup-fish-speech.ps1                 # フルモデル (24GB+ VRAM)
#   .\scripts\setup-fish-speech.ps1 -UseFP8         # FP8 量子化 (~12GB VRAM)
#   .\scripts\setup-fish-speech.ps1 -CudaVersion 128  # CUDA 12.8 指定
#   .\scripts\setup-fish-speech.ps1 -SkipModel      # モデルDL をスキップ
#
# 前提:
#   - Python 3.12 がインストール済み
#   - NVIDIA GPU + CUDA ドライバーがインストール済み
#   - Git / Git LFS がインストール済み
#   - huggingface-cli がインストール済み (pip install huggingface-hub)
#
# =============================================================================

param(
    [switch]$UseFP8,
    [ValidateSet("126", "128", "129")]
    [string]$CudaVersion = "126",
    [switch]$SkipModel,
    [switch]$SkipClone,
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"

# --- パス設定 ---
$projectRoot = Split-Path $PSScriptRoot -Parent
$fishSpeechDir = Join-Path $projectRoot "models" "fish-speech"
$checkpointsDir = Join-Path $fishSpeechDir "checkpoints"
$venvDir = Join-Path $fishSpeechDir ".venv"
$referenceDir = Join-Path $projectRoot "reference"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Fish Speech S2-Pro Setup" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Project root : $projectRoot"
Write-Host "  Fish Speech  : $fishSpeechDir"
Write-Host "  CUDA version : $CudaVersion"
Write-Host "  Model        : $(if ($UseFP8) { 'FP8 (~12GB VRAM)' } else { 'Full (~24GB VRAM)' })"
Write-Host "  Port         : $Port"
Write-Host ""

# =============================================================================
# Step 0: 前提チェック
# =============================================================================
Write-Host "[0/6] Checking prerequisites..." -ForegroundColor Yellow

# Python チェック
$pythonCmd = $null
foreach ($cmd in @("python3.12", "python3", "python")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($ver -match "3\.12") {
            $pythonCmd = $cmd
            Write-Host "  OK: $cmd ($ver)" -ForegroundColor Green
            break
        }
    } catch {}
}
if (-not $pythonCmd) {
    Write-Host "  ERROR: Python 3.12 not found. Please install Python 3.12." -ForegroundColor Red
    Write-Host "  Download: https://www.python.org/downloads/" -ForegroundColor Yellow
    exit 1
}

# Git チェック
try {
    $gitVer = git --version 2>&1
    Write-Host "  OK: git ($gitVer)" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Git not found." -ForegroundColor Red
    exit 1
}

# NVIDIA GPU チェック
try {
    $nvidiaSmi = nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>&1
    Write-Host "  OK: GPU detected" -ForegroundColor Green
    $nvidiaSmi -split "`n" | ForEach-Object {
        Write-Host "      $_" -ForegroundColor Gray
    }
} catch {
    Write-Host "  WARNING: nvidia-smi not found. GPU may not be available." -ForegroundColor Yellow
}

# huggingface-cli チェック
try {
    $hfVer = huggingface-cli version 2>&1
    Write-Host "  OK: huggingface-cli available" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: huggingface-cli not found. Will install with dependencies." -ForegroundColor Yellow
}

Write-Host ""

# =============================================================================
# Step 1: リポジトリクローン
# =============================================================================
Write-Host "[1/6] Cloning Fish Speech repository..." -ForegroundColor Yellow

if (-not $SkipClone) {
    if (Test-Path $fishSpeechDir) {
        Write-Host "  Directory already exists: $fishSpeechDir" -ForegroundColor Gray
        Write-Host "  Pulling latest changes..." -ForegroundColor Gray
        Push-Location $fishSpeechDir
        try {
            git pull --ff-only 2>&1 | Out-Null
            Write-Host "  Updated to latest." -ForegroundColor Green
        } catch {
            Write-Host "  Could not pull (may have local changes). Continuing..." -ForegroundColor Yellow
        }
        Pop-Location
    } else {
        # models ディレクトリを作成
        $modelsDir = Join-Path $projectRoot "models"
        if (-not (Test-Path $modelsDir)) {
            New-Item -ItemType Directory -Force $modelsDir | Out-Null
        }

        Write-Host "  Cloning to $fishSpeechDir ..." -ForegroundColor Gray
        git clone https://github.com/fishaudio/fish-speech.git $fishSpeechDir
        Write-Host "  Clone complete." -ForegroundColor Green
    }
} else {
    Write-Host "  Skipped (--SkipClone)." -ForegroundColor Gray
}
Write-Host ""

# =============================================================================
# Step 2: Python 仮想環境と依存関係
# =============================================================================
Write-Host "[2/6] Setting up Python virtual environment..." -ForegroundColor Yellow

if (-not (Test-Path $venvDir)) {
    Write-Host "  Creating venv at $venvDir ..." -ForegroundColor Gray
    & $pythonCmd -m venv $venvDir
    Write-Host "  venv created." -ForegroundColor Green
} else {
    Write-Host "  venv already exists." -ForegroundColor Gray
}

# venv の python を使う
$venvPython = Join-Path $venvDir "Scripts" "python.exe"
if (-not (Test-Path $venvPython)) {
    # Linux/WSL パス
    $venvPython = Join-Path $venvDir "bin" "python"
}

Write-Host "  Installing dependencies (cu$CudaVersion)..." -ForegroundColor Gray
Push-Location $fishSpeechDir
try {
    & $venvPython -m pip install --upgrade pip 2>&1 | Select-Object -Last 3
    & $venvPython -m pip install -e ".[cu$CudaVersion]" 2>&1 | Select-Object -Last 5
    Write-Host "  Dependencies installed." -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Failed to install dependencies." -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host ""

# =============================================================================
# Step 3: モデルダウンロード
# =============================================================================
Write-Host "[3/6] Downloading model weights..." -ForegroundColor Yellow

if (-not $SkipModel) {
    # huggingface-cli がvenv内にあるか確認
    $hfCli = Join-Path $venvDir "Scripts" "huggingface-cli.exe"
    if (-not (Test-Path $hfCli)) {
        $hfCli = "huggingface-cli"
    }

    if ($UseFP8) {
        $modelId = "drbaph/s2-pro-fp8"
        $localDir = Join-Path $checkpointsDir "s2-pro-fp8"
        Write-Host "  Downloading FP8 quantized model (~4GB)..." -ForegroundColor Gray
        Write-Host "  Model: $modelId" -ForegroundColor Gray
    } else {
        $modelId = "fishaudio/s2-pro"
        $localDir = Join-Path $checkpointsDir "s2-pro"
        Write-Host "  Downloading full model (~8GB)..." -ForegroundColor Gray
        Write-Host "  Model: $modelId" -ForegroundColor Gray
    }

    if (-not (Test-Path $checkpointsDir)) {
        New-Item -ItemType Directory -Force $checkpointsDir | Out-Null
    }

    try {
        & $hfCli download $modelId --local-dir $localDir
        Write-Host "  Model downloaded to $localDir" -ForegroundColor Green
    } catch {
        Write-Host "  ERROR: Model download failed." -ForegroundColor Red
        Write-Host "  You may need to login: huggingface-cli login" -ForegroundColor Yellow
        Write-Host "  Or download manually from: https://huggingface.co/$modelId" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Skipped (--SkipModel)." -ForegroundColor Gray
}
Write-Host ""

# =============================================================================
# Step 4: リファレンス音声ディレクトリ
# =============================================================================
Write-Host "[4/6] Setting up reference audio directory..." -ForegroundColor Yellow

if (-not (Test-Path $referenceDir)) {
    New-Item -ItemType Directory -Force $referenceDir | Out-Null
    Write-Host "  Created: $referenceDir" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next step: Place reference audio files here." -ForegroundColor Cyan
    Write-Host "  - WAV format, 5-15 seconds of character voice" -ForegroundColor Gray
    Write-Host "  - Include a transcript of the spoken content" -ForegroundColor Gray
    Write-Host "  - Example: reference/rei_sample.wav" -ForegroundColor Gray
} else {
    $wavCount = (Get-ChildItem $referenceDir -Filter "*.wav" -ErrorAction SilentlyContinue).Count
    Write-Host "  Directory exists: $referenceDir ($wavCount wav files found)" -ForegroundColor Green
}
Write-Host ""

# =============================================================================
# Step 5: 設定ファイル生成
# =============================================================================
Write-Host "[5/6] Writing configuration..." -ForegroundColor Yellow

# モデルパス決定
if ($UseFP8) {
    $checkpointPath = "checkpoints/s2-pro-fp8"
    $codecPath = "checkpoints/s2-pro-fp8/codec.pth"
    $halfFlag = "--half"
} else {
    $checkpointPath = "checkpoints/s2-pro"
    $codecPath = "checkpoints/s2-pro/codec.pth"
    $halfFlag = ""
}

# 設定を .state/fish-speech.json に保存（start-fish-speech.ps1 が読む）
$configDir = Join-Path $projectRoot ".state"
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Force $configDir | Out-Null
}
$configPath = Join-Path $configDir "fish-speech.json"
$config = @{
    fishSpeechDir     = $fishSpeechDir
    venvPython        = $venvPython
    checkpointPath    = $checkpointPath
    codecPath         = $codecPath
    halfFlag          = $halfFlag
    port              = $Port
}
$config | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8
Write-Host "  Config saved: $configPath" -ForegroundColor Green

# =============================================================================
# Step 6: 音声エンジン切替
# =============================================================================
Write-Host ""
Write-Host "[6/6] Switching voice engine to fish-speech..." -ForegroundColor Yellow

try {
    $switchScript = Join-Path $projectRoot "scripts" "switch-voice-engine.ts"
    if (Test-Path $switchScript) {
        & npx tsx $switchScript fish-speech
        Write-Host "  Voice engine switched to fish-speech in rei.yaml" -ForegroundColor Green
    } else {
        Write-Host "  switch-voice-engine.ts not found. Skipping voice engine switch." -ForegroundColor Yellow
        Write-Host "  You can switch manually: npx tsx scripts/switch-voice-engine.ts fish-speech" -ForegroundColor Gray
    }
} catch {
    Write-Host "  WARNING: Voice engine switch failed: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Yellow
Write-Host "  1. Place reference audio in: $referenceDir" -ForegroundColor White
Write-Host "  2. Start the server:" -ForegroundColor White
Write-Host "     npm run fish-speech:start" -ForegroundColor Cyan
Write-Host "  3. Test the server:" -ForegroundColor White
Write-Host "     curl http://127.0.0.1:$Port/v1/health" -ForegroundColor Cyan
Write-Host "  4. Register reference voice:" -ForegroundColor White
Write-Host "     curl -X POST http://127.0.0.1:${Port}/v1/references/add \" -ForegroundColor Cyan
Write-Host "       -F 'reference_id=rei-voice' \" -ForegroundColor Cyan
Write-Host "       -F 'audio=@reference/rei_sample.wav' \" -ForegroundColor Cyan
Write-Host "       -F 'text=sample transcript here'" -ForegroundColor Cyan
Write-Host ""

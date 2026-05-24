<#
.SYNOPSIS
    AI コンパニオン一括起動スクリプト
.DESCRIPTION
    Dashboard, Pet Idle, 音声会話 を一括起動する。
    音声会話はフォアグラウンドで実行し、Ctrl+C で全体を停止する。
.PARAMETER vad
    音声入力を VAD モードで起動する（デフォルトは PTT モード）
.PARAMETER fishSpeech
    Fish Speech S2-Pro サーバーもバックグラウンドで起動する
.EXAMPLE
    pwsh -NoProfile -File scripts/start-all.ps1
    pwsh -NoProfile -File scripts/start-all.ps1 -vad
    pwsh -NoProfile -File scripts/start-all.ps1 -fishSpeech
    pwsh -NoProfile -File scripts/start-all.ps1 -vad -fishSpeech
#>
param(
    [switch]$vad,
    [switch]$fishSpeech
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- パス定義 ---
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StateDir    = Join-Path $ProjectRoot ".state"
$PidsFile    = Join-Path $StateDir "pids.json"
$DashboardPort = 3456

# --- ヘルパー関数 ---
function Write-Status {
    param([string]$Icon, [string]$Message)
    Write-Host "  $Icon  $Message" -ForegroundColor Cyan
}

function Write-Err {
    param([string]$Message)
    Write-Host "  ✗  $Message" -ForegroundColor Red
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  ✓  $Message" -ForegroundColor Green
}

function Test-PortInUse {
    param([int]$Port)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Stop-TrackedProcesses {
    param([string]$PidsFilePath)
    if (Test-Path $PidsFilePath) {
        try {
            $pids = Get-Content $PidsFilePath -Raw | ConvertFrom-Json
            foreach ($entry in $pids.PSObject.Properties) {
                $pid_ = $entry.Value
                try {
                    $proc = Get-Process -Id $pid_ -ErrorAction Stop
                    # tree-kill: 子プロセスも含めて停止
                    Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
                    # 子プロセスも探して停止
                    Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $pid_ } | ForEach-Object {
                        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                    }
                    Write-Status "■" "停止: $($entry.Name) (PID: $pid_)"
                } catch {
                    # 既に停止済み
                }
            }
        } catch {
            Write-Err "PIDファイルの読み込みに失敗: $_"
        }
        Remove-Item $PidsFilePath -Force -ErrorAction SilentlyContinue
    }
}

# --- バナー ---
Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "  ║     AI Companion — 一括起動          ║" -ForegroundColor Magenta
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# --- ヘルスチェック (Doctor) ---
Write-Status "🏥" "システム診断を実行中..."
Write-Host ""
$doctorResult = & npx tsx "$ProjectRoot/scripts/doctor.ts" 2>&1
$doctorExitCode = $LASTEXITCODE

# Doctor の出力を表示
foreach ($line in $doctorResult) {
    Write-Host $line
}

if ($doctorExitCode -ne 0) {
    Write-Host ""
    Write-Err "システム診断でエラーが検出されました。上記の問題を修正してから再実行してください。"
    exit 1
}
Write-Host ""

# --- .state ディレクトリ確保 ---
if (-not (Test-Path $StateDir)) {
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
}

# --- 既存プロセスのクリーンアップ ---
if (Test-Path $PidsFile) {
    Write-Status "♻" "既存プロセスを停止中..."
    Stop-TrackedProcesses $PidsFile
    Write-Host ""
}

# --- ポートチェック ---
if (Test-PortInUse $DashboardPort) {
    Write-Err "ポート $DashboardPort は既に使用中です。"
    Write-Err "別のプロセスがダッシュボードを実行中か確認してください。"
    Write-Err "停止するには: pwsh -NoProfile -File scripts/stop-all.ps1"
    exit 1
}

# --- PID 記録用ハッシュ ---
$pids = @{}

# --- 1. ダッシュボード起動 ---
Write-Status "▶" "ダッシュボード起動中 (localhost:$DashboardPort)..."
try {
    $dashProc = Start-Process -FilePath "npx" `
        -ArgumentList "tsx", "packages/dashboard/src/server.ts" `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput (Join-Path $StateDir "dashboard.log") `
        -RedirectStandardError  (Join-Path $StateDir "dashboard.err.log")

    $pids["dashboard"] = $dashProc.Id
    Write-Ok "ダッシュボード起動完了 (PID: $($dashProc.Id))"
} catch {
    Write-Err "ダッシュボード起動失敗: $_"
    exit 1
}

# --- 2. ペットアイドルアニメーション起動 ---
Write-Status "▶" "ペットアイドルアニメーション起動中..."
try {
    $petProc = Start-Process -FilePath "python" `
        -ArgumentList "scripts/pet_idle.py" `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput (Join-Path $StateDir "pet_idle.log") `
        -RedirectStandardError  (Join-Path $StateDir "pet_idle.err.log")

    $pids["pet_idle"] = $petProc.Id
    Write-Ok "ペットアイドル起動完了 (PID: $($petProc.Id))"
} catch {
    Write-Err "ペットアイドル起動失敗: $_"
    # ダッシュボードを停止してから終了
    Stop-Process -Id $dashProc.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

# --- 3. スケジューラ起動 ---
Write-Status "▶" "スケジューラ起動中 (定期タスク管理)..."
try {
    $schedulerProc = Start-Process -FilePath "npx" `
        -ArgumentList "tsx", "scripts/scheduler.ts" `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput (Join-Path $StateDir "scheduler.log") `
        -RedirectStandardError  (Join-Path $StateDir "scheduler.err.log")

    $pids["scheduler"] = $schedulerProc.Id
    Write-Ok "スケジューラ起動完了 (PID: $($schedulerProc.Id))"
} catch {
    Write-Err "スケジューラ起動失敗: $_"
    # 致命的ではないので続行
}

# --- 4. Fish Speech サーバー起動 (オプション) ---
if ($fishSpeech) {
    Write-Status "▶" "Fish Speech S2-Pro サーバー起動中..."
    $fishConfigPath = Join-Path $ProjectRoot ".state" "fish-speech.json"
    if (-not (Test-Path $fishConfigPath)) {
        Write-Err "Fish Speech が未セットアップです。先に実行: npm run fish-speech:setup"
    } else {
        try {
            $fishProc = Start-Process -FilePath "pwsh" `
                -ArgumentList "-NoProfile", "-File", (Join-Path $ProjectRoot "scripts" "start-fish-speech.ps1") `
                -WorkingDirectory $ProjectRoot `
                -WindowStyle Hidden `
                -PassThru `
                -RedirectStandardOutput (Join-Path $StateDir "fish-speech.log") `
                -RedirectStandardError  (Join-Path $StateDir "fish-speech.err.log")

            $pids["fish_speech"] = $fishProc.Id
            Write-Ok "Fish Speech サーバー起動完了 (PID: $($fishProc.Id))"
        } catch {
            Write-Err "Fish Speech 起動失敗: $_"
            # 致命的ではないので続行
        }
    }
}

# --- PID ファイル保存 ---
$pids | ConvertTo-Json | Set-Content -Path $PidsFile -Encoding UTF8
Write-Host ""
Write-Status "📋" "PID 記録: $PidsFile"

# --- 4. 音声会話起動 (フォアグラウンド) ---
$talkMode = if ($vad) { "VAD" } else { "PTT (右Alt)" }
Write-Host ""
Write-Status "▶" "音声会話起動中 ($talkMode モード)..."
Write-Host ""
Write-Host "  ──────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "   Ctrl+C で全プロセスを停止します" -ForegroundColor Yellow
Write-Host "  ──────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# Ctrl+C ハンドラー: フォアグラウンド終了時にバックグラウンドも停止
try {
    $talkArgs = @("scripts/ptt.py")
    if ($vad) {
        $talkArgs += "--vad"
    }

    # python をフォアグラウンドで実行（Ctrl+C で中断される）
    & python @talkArgs
} finally {
    # フォアグラウンドプロセスが終了したら、バックグラウンドも停止
    Write-Host ""
    Write-Status "■" "バックグラウンドプロセスを停止中..."
    Stop-TrackedProcesses $PidsFile
    Write-Ok "全プロセスを停止しました"
    Write-Host ""
}

<#
.SYNOPSIS
    AI コンパニオン一括停止スクリプト
.DESCRIPTION
    .state/pids.json に記録された全プロセスを停止する。
.EXAMPLE
    pwsh -NoProfile -File scripts/stop-all.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- パス定義 ---
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StateDir    = Join-Path $ProjectRoot ".state"
$PidsFile    = Join-Path $StateDir "pids.json"

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

# --- バナー ---
Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "  ║     AI Companion — 一括停止          ║" -ForegroundColor Magenta
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# --- PID ファイル確認 ---
if (-not (Test-Path $PidsFile)) {
    Write-Err "PID ファイルが見つかりません: $PidsFile"
    Write-Err "起動中のプロセスがないか、既に停止済みです。"
    Write-Host ""
    exit 0
}

# --- PID 読み込みと停止 ---
try {
    $pids = Get-Content $PidsFile -Raw | ConvertFrom-Json
    $stopped = 0
    $notFound = 0

    foreach ($entry in $pids.PSObject.Properties) {
        $name = $entry.Name
        $pid_ = $entry.Value

        try {
            $proc = Get-Process -Id $pid_ -ErrorAction Stop

            # 子プロセスも含めて停止
            $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $pid_ }
            foreach ($child in $children) {
                try {
                    Stop-Process -Id $child.ProcessId -Force -ErrorAction Stop
                    Write-Status "■" "子プロセス停止: $($child.Name) (PID: $($child.ProcessId))"
                } catch {
                    # 既に停止済み
                }
            }

            Stop-Process -Id $pid_ -Force -ErrorAction Stop
            Write-Ok "停止: $name (PID: $pid_)"
            $stopped++
        } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
            Write-Status "·" "既に停止済み: $name (PID: $pid_)"
            $notFound++
        } catch {
            Write-Status "·" "既に停止済み: $name (PID: $pid_)"
            $notFound++
        }
    }

    # PID ファイル削除
    Remove-Item $PidsFile -Force -ErrorAction SilentlyContinue

    # ログファイルは残す（デバッグ用）
    Write-Host ""
    Write-Ok "完了: ${stopped} プロセス停止, ${notFound} 件は既に停止済み"

    # ログファイルの場所を案内
    $logFiles = Get-ChildItem $StateDir -Filter "*.log" -ErrorAction SilentlyContinue
    if ($logFiles) {
        Write-Host ""
        Write-Status "📋" "ログファイル:"
        foreach ($log in $logFiles) {
            Write-Host "      $($log.FullName)" -ForegroundColor DarkGray
        }
    }
} catch {
    Write-Err "プロセス停止中にエラー: $_"
    exit 1
}

Write-Host ""

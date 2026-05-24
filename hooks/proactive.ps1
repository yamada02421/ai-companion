$projectRoot = Split-Path $PSScriptRoot -Parent
$cooldownFile = Join-Path $projectRoot ".state/last-stop-hook.txt"

# クールダウン: 60秒以内に再度呼ばれた場合はスキップ
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
try {
    $lastRun = [long](Get-Content $cooldownFile -ErrorAction Stop)
    if (($now - $lastRun) -lt 60) { exit 0 }
} catch {}
$now | Out-File $cooldownFile -Force

# タスク完了通知 — AI が作業内容を見てコメント
try {
    & npx tsx "$projectRoot/packages/terminal/src/summarize-work.ts" 2>$null
} catch {}

# プロアクティブ発言（25% の確率）
if ((Get-Random -Maximum 4) -ne 0) { exit 0 }

try {
    Set-Location $projectRoot
    $modes = @("news", "qiita", "work", "casual")
    $mode = $modes[(Get-Random -Maximum $modes.Length)]
    & npx tsx "packages/terminal/src/proactive.ts" $mode 2>$null
} catch {
    exit 0
}

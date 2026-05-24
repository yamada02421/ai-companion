$projectRoot = Split-Path $PSScriptRoot -Parent
$cooldownFile = Join-Path $projectRoot ".state/last-stop-hook.txt"

# クールダウン: 60秒以内に再度呼ばれた場合はスキップ
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
try {
    $lastRun = [long](Get-Content $cooldownFile -ErrorAction Stop)
    if (($now - $lastRun) -lt 60) { exit 0 }
} catch {}
$now | Out-File $cooldownFile -Force

# --- 開発モード: 短い完了通知のみ（AIなし・音声なし） ---
# 通常モードに戻すには DEV_MODE の行を削除する
$DEV_MODE = $true

if ($DEV_MODE) {
    try {
        $ipcPath = Join-Path $env:APPDATA "OpenPets\runtime\ipc.json"
        if (-not (Test-Path $ipcPath)) { exit 0 }
        $ipc = Get-Content $ipcPath -Raw | ConvertFrom-Json
        $pipeName = $ipc.endpoint -replace '^\\\\\.\\pipe\\', ''
        if (-not $pipeName) { exit 0 }

        function Send-Req {
            param([string]$PipeName, [string]$Method, [hashtable]$Params)
            $p = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
            try {
                $p.Connect(2000)
                $w = [System.IO.StreamWriter]::new($p); $r = [System.IO.StreamReader]::new($p); $w.AutoFlush = $true
                $w.WriteLine((@{ id=[guid]::NewGuid().ToString(); version=$ipc.protocolVersion; token=$ipc.token; method=$Method; params=$Params } | ConvertTo-Json -Compress))
                return ($r.ReadLine() | ConvertFrom-Json)
            } finally { $p.Dispose() }
        }

        $lease = Send-Req -PipeName $pipeName -Method "lease.acquire" -Params @{}
        if ($lease.ok) {
            Send-Req -PipeName $pipeName -Method "pet.say" -Params @{
                message = "タスク完了"
                reaction = "success"
                leaseId = $lease.result.leaseId
            } | Out-Null
        }
    } catch {}
    exit 0
}

# --- 通常モード ---
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

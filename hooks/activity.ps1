$input = $null
try { $input = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }

$toolName = $input.tool_name
if (-not $toolName) { exit 0 }

$messages = @{
    "Read"       = "ファイルを確認中..."
    "Edit"       = "コードを修正中..."
    "Write"      = "ファイルを作成中..."
    "Bash"       = "コマンドを実行中..."
    "PowerShell" = "コマンドを実行中..."
    "Grep"       = "コードを検索中..."
    "Glob"       = "ファイルを探索中..."
    "Agent"      = "調査を依頼中..."
    "WebSearch"  = "ネットで調査中..."
    "WebFetch"   = "情報を取得中..."
}

$msg = $messages[$toolName]
if (-not $msg) { exit 0 }

# --- OpenPets IPC (pure PowerShell, no Node.js) ---
try {
    $ipcPath = Join-Path $env:APPDATA "OpenPets\runtime\ipc.json"
    if (-not (Test-Path $ipcPath)) { exit 0 }

    $ipc = Get-Content $ipcPath -Raw | ConvertFrom-Json
    $endpoint = $ipc.endpoint
    $token = $ipc.token
    $version = $ipc.protocolVersion

    # Extract pipe name from \\.\pipe\<name>
    $pipeName = $endpoint -replace '^\\\\\.\\pipe\\', ''
    if (-not $pipeName) { exit 0 }

    # Helper: send a request and read response
    function Send-OpenPetsRequest {
        param(
            [string]$PipeName,
            [string]$Method,
            [hashtable]$Params
        )
        $pipeClient = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
        try {
            $pipeClient.Connect(3000)  # 3 second timeout
            $writer = [System.IO.StreamWriter]::new($pipeClient)
            $reader = [System.IO.StreamReader]::new($pipeClient)
            $writer.AutoFlush = $true

            $request = @{
                id      = [guid]::NewGuid().ToString()
                version = $version
                token   = $token
                method  = $Method
                params  = $Params
            } | ConvertTo-Json -Compress

            $writer.WriteLine($request)
            $response = $reader.ReadLine()
            return ($response | ConvertFrom-Json)
        }
        finally {
            $pipeClient.Dispose()
        }
    }

    # 1. Acquire lease
    $leaseRes = Send-OpenPetsRequest -PipeName $pipeName -Method "lease.acquire" -Params @{}
    if (-not $leaseRes.ok) { exit 0 }
    $leaseId = $leaseRes.result.leaseId

    # 2. Send say
    $sayParams = @{
        message  = $msg
        reaction = "working"
        leaseId  = $leaseId
    }
    Send-OpenPetsRequest -PipeName $pipeName -Method "pet.say" -Params $sayParams | Out-Null
}
catch {
    # Silently fail - don't block Claude Code
    exit 0
}

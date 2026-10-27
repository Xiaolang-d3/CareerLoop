param(
    [string]$BinaryPath = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $repoRoot "backend/data/minio-server"
if (-not $BinaryPath) {
    $BinaryPath = Join-Path $runtimeDir "minio.exe"
}
if (-not (Test-Path -LiteralPath $BinaryPath -PathType Leaf)) {
    throw "未找到 MinIO 程序。请先安装或从官方源码构建，并通过 -BinaryPath 指定程序路径。"
}

$credentials = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $repoRoot "backend/.env")) {
    if ($line -match '^\s*(MINIO_ACCESS_KEY|MINIO_SECRET_KEY)\s*=\s*(.*?)\s*$') {
        $credentials[$matches[1]] = $matches[2].Trim('"').Trim("'")
    }
}
if (-not $credentials["MINIO_ACCESS_KEY"] -or -not $credentials["MINIO_SECRET_KEY"]) {
    throw "请先在 backend/.env 配置 MINIO_ACCESS_KEY 和 MINIO_SECRET_KEY。"
}

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 9000,9001 -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    $pidFile = Join-Path $runtimeDir "server.pid"
    $recordedPid = if (Test-Path -LiteralPath $pidFile) { [int](Get-Content -LiteralPath $pidFile) } else { 0 }
    $process = if ($recordedPid) { Get-Process -Id $recordedPid -ErrorAction SilentlyContinue } else { $null }
    if ($process -and $process.Path -eq (Resolve-Path -LiteralPath $BinaryPath).Path -and
        @($listeners | Where-Object { $_.OwningProcess -ne $recordedPid }).Count -eq 0) {
        Write-Output "本项目 MinIO 已在运行。"
        return
    }
    throw "9000 或 9001 端口已被其他服务使用，未启动新的 MinIO。"
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$logDir = Join-Path $repoRoot "backend/logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$previousUser = $env:MINIO_ROOT_USER
$previousPassword = $env:MINIO_ROOT_PASSWORD
try {
    $env:MINIO_ROOT_USER = $credentials["MINIO_ACCESS_KEY"]
    $env:MINIO_ROOT_PASSWORD = $credentials["MINIO_SECRET_KEY"]
    $server = Start-Process -FilePath $BinaryPath -ArgumentList @(
        "server", ('"' + (Join-Path $runtimeDir "objects") + '"'),
        "--address", "127.0.0.1:9000", "--console-address", "127.0.0.1:9001"
    ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "minio.out.log") `
      -RedirectStandardError (Join-Path $logDir "minio.err.log") -PassThru
    Set-Content -LiteralPath (Join-Path $runtimeDir "server.pid") -Value $server.Id
    Write-Output "MinIO 已启动；存储地址 http://127.0.0.1:9000，管理地址 http://127.0.0.1:9001。"
} finally {
    $env:MINIO_ROOT_USER = $previousUser
    $env:MINIO_ROOT_PASSWORD = $previousPassword
}

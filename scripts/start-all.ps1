# Start gnodev (if needed) + web UI for gnomemepad local review.
# On Windows, gnodev workspace should be under C:\dev\gnomemepad (not %USERPROFILE%).
$ErrorActionPreference = "Continue"
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"

$chainRoot = if (Test-Path "C:\dev\gnomemepad\gnowork.toml") { "C:\dev\gnomemepad" } else { "C:\Users\Hi\gnomemepad" }
$webRoot = "C:\Users\Hi\gnomemepad\web"
$webLog = Join-Path $webRoot "server.log"
$webErr = Join-Path $webRoot "server.err.log"

function Test-Rpc {
  try {
    $null = Invoke-RestMethod "http://127.0.0.1:26657/status" -TimeoutSec 2
    return $true
  } catch { return $false }
}

function Test-Ui {
  try {
    $null = Invoke-RestMethod "http://127.0.0.1:5173/api/health" -TimeoutSec 2
    return $true
  } catch { return $false }
}

# --- gnodev ---
if (-not (Test-Rpc)) {
  Write-Host "Starting gnodev from $chainRoot ..."
  if (-not (Get-Command gnodev -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: gnodev not in PATH. Install: go install from gno/contribs/gnodev"
    exit 1
  }
  Start-Process -FilePath "gnodev" -ArgumentList @(
    "local", "-no-examples", "-no-watch",
    "-web-listener", "127.0.0.1:8888",
    "-node-rpc-listener", "127.0.0.1:26657",
    "-web-home", "/r/gnomemepad/pad",
    "./gno.land/p/gnomemepad/ammmath",
    "./gno.land/r/gnomemepad/pad",
    "./gno.land/p/nt/avl/v0",
    "./gno.land/p/nt/seqid/v0",
    "./gno.land/p/nt/ufmt/v0",
    "./gno.land/p/nt/cford32/v0"
  ) -WorkingDirectory $chainRoot -WindowStyle Minimized

  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Rpc) { break }
  }
  if (-not (Test-Rpc)) {
    Write-Host "ERROR: gnodev RPC did not come up on :26657"
    exit 1
  }
  Write-Host "gnodev RPC OK"
} else {
  Write-Host "gnodev already running on :26657"
}

# --- web UI ---
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 400

Write-Host "Starting web UI ..."
Start-Process -FilePath "node" -ArgumentList "server.mjs" `
  -WorkingDirectory $webRoot `
  -RedirectStandardOutput $webLog `
  -RedirectStandardError $webErr `
  -WindowStyle Hidden

Start-Sleep 1
if (Test-Ui) {
  Write-Host ""
  Write-Host "========================================"
  Write-Host "  UI:     http://127.0.0.1:5173"
  Write-Host "  gnoweb: http://127.0.0.1:8888/r/gnomemepad/pad"
  Write-Host "  RPC:    http://127.0.0.1:26657"
  Write-Host "========================================"
  Write-Host "Logs: $webLog"
  try { Start-Process "http://127.0.0.1:5173" } catch {}
} else {
  Write-Host "ERROR: UI failed. See:"
  Write-Host "  $webLog"
  Write-Host "  $webErr"
  if (Test-Path $webErr) { Get-Content $webErr }
  exit 1
}

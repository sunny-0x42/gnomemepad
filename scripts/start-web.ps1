# Start gnomemepad web UI (requires gnodev RPC on 127.0.0.1:26657)
$ErrorActionPreference = "Stop"
$env:PATH = "$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -ErrorAction SilentlyContinue
$web = Join-Path (Split-Path $PSScriptRoot -Parent) "web"
if (-not (Test-Path (Join-Path $web "server.mjs"))) {
    $web = "C:\Users\Hi\gnomemepad\web"
}

# Free port 5173
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

# Quick RPC check
try {
    $null = Invoke-RestMethod "http://127.0.0.1:26657/status" -TimeoutSec 2
    Write-Host "RPC OK on :26657"
} catch {
    Write-Host "WARNING: gnodev RPC not reachable on 127.0.0.1:26657"
    Write-Host "Start chain first (from C:\dev\gnomemepad on Windows):"
    Write-Host "  gnodev local -no-examples -no-watch ..."
}

Set-Location $web
Write-Host "Starting UI at http://127.0.0.1:5173"
node server.mjs

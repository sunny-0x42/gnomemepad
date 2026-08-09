# Start web UI pointed at Gno Sapphire (after on-chain deploy).
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$KeyName = "deploykey",
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"

$env:RPC_URL = "https://rpc.sapphire.testnets.gno.land:443"
$env:CHAIN_ID = "sapphire-1"
$env:PKG = "gno.land/r/$Address/gnomemepad/pad"
$env:GNOKEY_NAME = $KeyName
$env:SIGNER_ADDR = $Address
$env:PORT = "$Port"

Write-Host "UI -> Sapphire"
Write-Host "  RPC  $env:RPC_URL"
Write-Host "  PKG  $env:PKG"
Write-Host "  KEY  $KeyName / $Address"
Write-Host "  http://127.0.0.1:$Port"
Write-Host ""
Write-Host "For Create/Buy/Sell from UI, set password once in this shell (not committed):"
Write-Host '  $env:GNOKEY_PASS = "your-deploykey-password"'
Write-Host "Then re-run this script. Leave unset for read-only UI."
Write-Host ""

if (-not $env:GNOKEY_PASS) {
  Write-Host "WARNING: GNOKEY_PASS not set - markets load OK, txs will fail until set."
}

Set-Location (Join-Path $ROOT "web")
node server.mjs

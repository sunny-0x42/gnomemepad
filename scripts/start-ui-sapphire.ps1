# Start web UI pointed at Gno Sapphire (after on-chain deploy).
param(
  [string]$Address = "g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl",
  [string]$KeyName = "mykey",
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

Write-Host "UI → Sapphire"
Write-Host "  RPC  $env:RPC_URL"
Write-Host "  PKG  $env:PKG"
Write-Host "  KEY  $KeyName / $Address"
Write-Host "  http://127.0.0.1:$Port"
Write-Host ""

Set-Location (Join-Path $ROOT "web")
node server.mjs

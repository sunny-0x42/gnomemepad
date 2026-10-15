# One-shot: Init padv18 only (skips addpkg / hub).
# Requires GNOKEY_PASS for deploykey (or .env.deploy).
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedInit = 30000000
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
Set-Location $ROOT

. "$PSScriptRoot\gnokey-common.ps1"
Initialize-GnokeyPath
Import-DotEnvDeploy -Root $ROOT

if ($env:GNOKEY_NAME) { $KeyName = $env:GNOKEY_NAME }
if ($env:GNOKEY_ADDR) { $Address = $env:GNOKEY_ADDR }

Assert-DeployKeyExists -KeyName $KeyName -ExpectedAddress $Address

$padPath = "gno.land/r/$Address/gnomemepad/padv18"

$initCheck = gnokey query vm/qeval --data "$padPath.ProtocolAddress()" -remote $Remote 2>&1 | Out-String
if ($initCheck -match 'g1[a-z0-9]{38,}') {
  Write-Host "Already inited: $initCheck" -ForegroundColor Green
  exit 0
}

$pass = Get-GnokeyPassword -PromptIfMissing
if (-not $pass) { throw "GNOKEY_PASS required (set env or create .env.deploy)." }
$env:GNOKEY_PASS = $pass

Write-Host "=== Init padv18 ===" -ForegroundColor Cyan
Write-Host "  Path: $padPath"
Write-Host "  Key : $KeyName -> protocol treasury will be this caller"

Invoke-Gnokey -StepName "Init padv18" -Password $pass -Args @(
  "maketx", "call",
  "-pkgpath", $padPath,
  "-func", "Init",
  "-gas-fee", $GasFee,
  "-gas-wanted", "$GasWantedInit",
  "-broadcast", "-chainid", $ChainId, "-remote", $Remote,
  $KeyName
)

$after = gnokey query vm/qeval --data "$padPath.ProtocolAddress()" -remote $Remote 2>&1 | Out-String
Write-Host ""
Write-Host "ProtocolAddress: $after"
if ($after -match 'g1[a-z0-9]{38,}') {
  Write-Host "OK — Create token should work now. Hard-refresh the site." -ForegroundColor Green
} else {
  Write-Host "WARN — still empty; Init may have failed." -ForegroundColor Yellow
}

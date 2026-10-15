# Deploy padv15 using the existing gnokey key "deploykey" (same as prior Sapphire deploys).
#
# Setup once:
#   copy .env.deploy.example .env.deploy
#   notepad .env.deploy   # set GNOKEY_PASS to deploykey password
#
# Or session-only:
#   $env:GNOKEY_PASS = 'your-password'
#   .\scripts\deploy-v15-now.ps1
#
# Interactive (type password when asked):
#   .\scripts\deploy-v15-now.ps1

param(
  [string]$KeyName = ""
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
Set-Location $ROOT

. "$PSScriptRoot\gnokey-common.ps1"
Initialize-GnokeyPath
Import-DotEnvDeploy -Root $ROOT

$cfg = Get-DeployKeyConfig -KeyName $KeyName
$KeyName = $cfg.KeyName
$Address = $cfg.Address

Write-Host "=== Sapphire deploy identity ===" -ForegroundColor Cyan
Write-Host "  KeyName : $KeyName"
Write-Host "  Address : $Address"
Write-Host "  Home    : $($script:GnoDeployDefaults.Home)"
Write-Host ""

Assert-DeployKeyExists -KeyName $KeyName -ExpectedAddress $Address

# Ensure password available
$pass = Get-GnokeyPassword -PromptIfMissing
if (-not $pass) { throw "GNOKEY_PASS required (env, .env.deploy, or prompt)." }
$env:GNOKEY_PASS = $pass

Write-Host "=== Verify password unlocks $KeyName ===" -ForegroundColor Cyan
$ok = Test-GnokeyPassword -KeyName $KeyName -SelfAddress $Address
if (-not $ok) {
  throw @"
Password failed for '$KeyName'.

This is the password you set when creating the key:
  gnokey add deploykey

Not your Adena password. Fix:
  1) Edit .env.deploy  GNOKEY_PASS=...
  2) Or: `$env:GNOKEY_PASS = 'correct-password'
  3) Or recover: gnokey add deploykey --recover  (same mnemonic as g1mv0052...)
"@
}

Write-Host "=== Deploy padv15 ===" -ForegroundColor Cyan
& "$PSScriptRoot\deploy-sapphire-v15.ps1" -KeyName $KeyName -Address $Address
if ($LASTEXITCODE -ne 0) { throw "deploy-sapphire-v15 failed" }

Write-Host ""
Write-Host "=== Done. Next ===" -ForegroundColor Green
Write-Host "1. Redeploy UI:  npx netlify-cli deploy --prod"
Write-Host "2. Create a NEW token on padv15 (old padv14 launches stay on padv14)."
Write-Host "3. Buy: Deposit, then Transfer WUGNOT to pad, then Buy."
Write-Host ""

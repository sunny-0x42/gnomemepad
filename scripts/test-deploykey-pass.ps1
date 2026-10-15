# Verify password unlocks deploykey (no chain write).
param([string]$KeyName = "")

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
Set-Location $ROOT

. "$PSScriptRoot\gnokey-common.ps1"
Initialize-GnokeyPath
Import-DotEnvDeploy -Root $ROOT

$cfg = Get-DeployKeyConfig -KeyName $KeyName
Assert-DeployKeyExists -KeyName $cfg.KeyName -ExpectedAddress $cfg.Address

$ok = Test-GnokeyPassword -KeyName $cfg.KeyName -SelfAddress $cfg.Address
if (-not $ok) { exit 1 }
exit 0

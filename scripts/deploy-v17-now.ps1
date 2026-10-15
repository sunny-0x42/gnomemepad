param([string]$KeyName = "")
$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
Set-Location $ROOT
. "$PSScriptRoot\gnokey-common.ps1"
Initialize-GnokeyPath
Import-DotEnvDeploy -Root $ROOT
$cfg = Get-DeployKeyConfig -KeyName $KeyName
Assert-DeployKeyExists -KeyName $cfg.KeyName -ExpectedAddress $cfg.Address
$pass = Get-GnokeyPassword -PromptIfMissing
if (-not $pass) { throw "GNOKEY_PASS required" }
$env:GNOKEY_PASS = $pass
if (-not (Test-GnokeyPassword -KeyName $cfg.KeyName -SelfAddress $cfg.Address)) {
  throw "Password failed for $($cfg.KeyName)"
}
& "$PSScriptRoot\deploy-sapphire-v17.ps1" -KeyName $cfg.KeyName -Address $cfg.Address
Write-Host "Next: set netlify.toml PKG to padv17 then: npx netlify-cli deploy --prod"
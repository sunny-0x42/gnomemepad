# Deploy bond policy realm + optional StartPromo + hub SetModule bond=
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDeposit = "20000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWanted = 80000000,
  [string]$HubPath = "",
  # Promo: 20 GNOT ugnot (~$20 if GNOT≈$1). Adjust after price check.
  [int64]$PromoUgnot = 20000000,
  # 10 days in seconds
  [int64]$PromoDurationSec = 864000,
  [switch]$SkipInit,
  [switch]$SkipPromo,
  [switch]$SkipHub
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Users\Hi\tools;$env:USERPROFILE\go\bin;$env:PATH"
Set-Location $ROOT

& "$PSScriptRoot\prepare-sapphire-bond.ps1" -Address $Address

$bondDir = Join-Path $ROOT "deploy\sapphire-bond\r\$Address\gnomemepad\bond"
$bondPath = "gno.land/r/$Address/gnomemepad/bond"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hubv2" }

Write-Host "=== Deploy bond policy ==="
Write-Host "Pkg: $bondPath"

function Assert-Ok([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "Failed: $Step" }
}
function Invoke-GnokeyDeploy {
  param([string[]]$GnokeyCmd, [string]$StepName)
  if ($env:GNOKEY_PASS) {
    $env:GNOKEY_PASS | & gnokey @GnokeyCmd -insecure-password-stdin
  } else {
    Write-Host "Enter password for '$KeyName'..."
    & gnokey @GnokeyCmd
  }
  Assert-Ok $StepName
}

$existing = gnokey query vm/qpaths --data $bondPath -remote $Remote 2>&1 | Out-String
if ($existing -match [regex]::Escape($bondPath)) {
  Write-Host "bond already on chain, skip addpkg"
} else {
  Invoke-GnokeyDeploy -StepName "addpkg bond" -GnokeyCmd @(
    "maketx","addpkg",$KeyName,"-pkgpath",$bondPath,"-pkgdir",$bondDir,
    "-max-deposit",$MaxDeposit,"-gas-fee",$GasFee,"-gas-wanted","$GasWanted",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

if (-not $SkipInit) {
  try {
    Invoke-GnokeyDeploy -StepName "Init bond" -GnokeyCmd @(
      "maketx","call",$KeyName,"-pkgpath",$bondPath,"-func","Init",
      "-gas-fee",$GasFee,"-gas-wanted","30000000",
      "-broadcast","-chainid",$ChainId,"-remote",$Remote
    )
  } catch {
    Write-Host "Init: $($_.Exception.Message) (ok if already)"
  }
}

if (-not $SkipPromo) {
  Write-Host "=== StartPromo ugnot=$PromoUgnot duration=${PromoDurationSec}s ==="
  try {
    Invoke-GnokeyDeploy -StepName "StartPromo" -GnokeyCmd @(
      "maketx","call",$KeyName,"-pkgpath",$bondPath,"-func","StartPromo",
      "-gas-fee",$GasFee,"-gas-wanted","30000000",
      "-broadcast","-chainid",$ChainId,"-remote",$Remote,
      "-args","$PromoUgnot","-args","$PromoDurationSec"
    )
  } catch {
    Write-Host "StartPromo: $($_.Exception.Message)"
  }
}

if (-not $SkipHub) {
  Write-Host "=== hub SetModule bond ==="
  try {
    Invoke-GnokeyDeploy -StepName "SetModule bond" -GnokeyCmd @(
      "maketx","call",$KeyName,"-pkgpath",$HubPath,"-func","SetModule",
      "-gas-fee",$GasFee,"-gas-wanted","30000000",
      "-broadcast","-chainid",$ChainId,"-remote",$Remote,
      "-args","bond","-args",$bondPath
    )
  } catch {
    Write-Host "Hub: $($_.Exception.Message)"
  }
}

Write-Host ""
Write-Host "OK $bondPath"
Write-Host "  CurrentBondUgnot() used by padv9 Create"
Write-Host "  EndPromo() when you want bond = 2 GNOT"
Write-Host "  SetPromoBond(ugnot) to re-target ~`$20 if GNOT price moves"

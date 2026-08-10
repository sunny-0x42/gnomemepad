# Deploy pointsv2, Init, register on hub, optionally AllowPad for active pad.
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDeposit = "25000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPkg = 80000000,
  [int]$GasWantedCall = 30000000,
  [string]$HubPath = "",
  [string]$AllowPadPath = "",
  [switch]$SkipHub,
  [switch]$SkipInit
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Users\Hi\tools;$env:USERPROFILE\go\bin;$env:PATH"
Set-Location $ROOT

& "$PSScriptRoot\prepare-sapphire-pointsv2.ps1" -Address $Address

$ptsDir = Join-Path $ROOT "deploy\sapphire-pointsv2\r\$Address\gnomemepad\pointsv2"
$ptsPath = "gno.land/r/$Address/gnomemepad/pointsv2"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hubv2" }

Write-Host "=== Deploy pointsv2 ==="
Write-Host "Pkg: $ptsPath"

function Assert-Ok([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "Failed: $Step" }
}
function Invoke-GnokeyDeploy {
  param([string[]]$GnokeyCmd, [string]$StepName)
  if ($env:GNOKEY_PASS) {
    $env:GNOKEY_PASS | & gnokey @GnokeyCmd -insecure-password-stdin
  } else {
    Write-Host "Enter password for '$KeyName' (hidden)..."
    & gnokey @GnokeyCmd
  }
  Assert-Ok $StepName
}

$existing = gnokey query vm/qpaths --data $ptsPath -remote $Remote 2>&1 | Out-String
if ($existing -match [regex]::Escape($ptsPath)) {
  Write-Host "pointsv2 already on chain, skip addpkg"
} else {
  Invoke-GnokeyDeploy -StepName "addpkg pointsv2" -GnokeyCmd @(
    "maketx","addpkg",$KeyName,"-pkgpath",$ptsPath,"-pkgdir",$ptsDir,
    "-max-deposit",$MaxDeposit,"-gas-fee",$GasFee,"-gas-wanted","$GasWantedPkg",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

if (-not $SkipInit) {
  try {
    Invoke-GnokeyDeploy -StepName "Init pointsv2" -GnokeyCmd @(
      "maketx","call",$KeyName,"-pkgpath",$ptsPath,"-func","Init",
      "-gas-fee",$GasFee,"-gas-wanted","$GasWantedCall",
      "-broadcast","-chainid",$ChainId,"-remote",$Remote
    )
  } catch {
    Write-Host "Init: $($_.Exception.Message) (ok if already)"
  }
}

if (-not $SkipHub) {
  Write-Host "=== hub SetModule points=pointsv2 ==="
  $list = [System.Collections.Generic.List[string]]::new()
  $list.AddRange([string[]]@(
    "maketx","call",$KeyName,"-pkgpath",$HubPath,"-func","SetModule",
    "-gas-fee",$GasFee,"-gas-wanted","$GasWantedCall",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  ))
  foreach ($a in @("points", $ptsPath)) { $list.Add("-args"); $list.Add($a) }
  Invoke-GnokeyDeploy -StepName "hub points" -GnokeyCmd $list.ToArray()
}

if ($AllowPadPath) {
  Write-Host "=== AllowPad $AllowPadPath ==="
  $list2 = [System.Collections.Generic.List[string]]::new()
  $list2.AddRange([string[]]@(
    "maketx","call",$KeyName,"-pkgpath",$ptsPath,"-func","AllowPad",
    "-gas-fee",$GasFee,"-gas-wanted","$GasWantedCall",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  ))
  $list2.Add("-args"); $list2.Add($AllowPadPath)
  Invoke-GnokeyDeploy -StepName "AllowPad" -GnokeyCmd $list2.ToArray()
}

Write-Host "OK $ptsPath"
Write-Host "Next: deploy padv6, AllowPad(padv6), SetPointsEnabled(true) on padv6"

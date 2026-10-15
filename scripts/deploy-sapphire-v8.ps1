# Deploy padv8: remaining tokens + raised → liquid; auto Gnoswap CreatePool+Mint.
# Testnet: hub pad points only to padv8 (legacy pads ignored).
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDepositPad = "80000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPad = 250000000,
  [int]$GasWantedInit = 30000000,
  [string]$HubPath = "",
  [string]$PointsPath = "",
  [switch]$SkipHub,
  [switch]$SkipInit,
  [switch]$EnablePoints
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Users\Hi\tools;$env:USERPROFILE\go\bin;$env:PATH"
Set-Location $ROOT

& "$PSScriptRoot\prepare-sapphire-v8.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\sapphire-v8\r\$Address\gnomemepad\padv8"
$padPath = "gno.land/r/$Address/gnomemepad/padv8"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hubv2" }
if (-not $PointsPath) { $PointsPath = "gno.land/r/$Address/gnomemepad/pointsv2" }

Write-Host "=== Deploy padv8 (Gnoswap auto-list) ==="
Write-Host "Pkg: $padPath"
Write-Host "After deploy: fund pad with WUGNOT (and optional GNS) for CreatePool fee + LP"

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

$existing = gnokey query vm/qpaths --data $padPath -remote $Remote 2>&1 | Out-String
if ($existing -match [regex]::Escape($padPath)) {
  Write-Host "padv8 already on chain, skip addpkg"
} else {
  Invoke-GnokeyDeploy -StepName "addpkg padv8" -GnokeyCmd @(
    "maketx","addpkg",$KeyName,"-pkgpath",$padPath,"-pkgdir",$padDir,
    "-max-deposit",$MaxDepositPad,"-gas-fee",$GasFee,"-gas-wanted","$GasWantedPad",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

if (-not $SkipInit) {
  try {
    Invoke-GnokeyDeploy -StepName "Init padv8" -GnokeyCmd @(
      "maketx","call",$KeyName,"-pkgpath",$padPath,"-func","Init",
      "-gas-fee",$GasFee,"-gas-wanted","$GasWantedInit",
      "-broadcast","-chainid",$ChainId,"-remote",$Remote
    )
  } catch {
    Write-Host "Init: $($_.Exception.Message) (ok if already)"
  }
}

if (-not $SkipHub) {
  function Call-Hub([string[]]$FuncArgs, [string]$Label) {
    Write-Host "=== $Label ==="
    $list = [System.Collections.Generic.List[string]]::new()
    $list.AddRange([string[]]@(
      "maketx","call",$KeyName,"-pkgpath",$HubPath,"-func","SetModule",
      "-gas-fee",$GasFee,"-gas-wanted","30000000",
      "-broadcast","-chainid",$ChainId,"-remote",$Remote
    ))
    foreach ($a in $FuncArgs) { $list.Add("-args"); $list.Add($a) }
    Invoke-GnokeyDeploy -StepName $Label -GnokeyCmd $list.ToArray()
  }
  # Testnet: only padv8 is the active pad module (legacy pads unused).
  Call-Hub @("pad", $padPath) "hub SetModule pad=padv8"
}

try {
  Write-Host "=== pointsv2 AllowPad padv8 ==="
  $list = [System.Collections.Generic.List[string]]::new()
  $list.AddRange([string[]]@(
    "maketx","call",$KeyName,"-pkgpath",$PointsPath,"-func","AllowPad",
    "-gas-fee",$GasFee,"-gas-wanted","30000000",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  ))
  $list.Add("-args"); $list.Add($padPath)
  Invoke-GnokeyDeploy -StepName "AllowPad" -GnokeyCmd $list.ToArray()
} catch {
  Write-Host "AllowPad: $($_.Exception.Message)"
}

if ($EnablePoints) {
  $listE = [System.Collections.Generic.List[string]]::new()
  $listE.AddRange([string[]]@(
    "maketx","call",$KeyName,"-pkgpath",$padPath,"-func","SetPointsEnabled",
    "-gas-fee",$GasFee,"-gas-wanted","30000000",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote,
    "-args","true"
  ))
  try {
    Invoke-GnokeyDeploy -StepName "SetPointsEnabled" -GnokeyCmd $listE.ToArray()
  } catch {
    Write-Host "SetPointsEnabled: $($_.Exception.Message)"
  }
}

Write-Host ""
Write-Host "OK $padPath"
Write-Host "Ops checklist:"
Write-Host "  1. Wrap GNOT → WUGNOT (EOA Deposit on gno.land/r/gnoland/wugnot)"
Write-Host "  2. Transfer WUGNOT to pad package address (enough for raised + ~GNS fee per listing)"
Write-Host "  3. Optional: Transfer GNS to pad to skip fee swap"
Write-Host "  4. Point Netlify PKG / hub pad to padv8"
Write-Host "  5. Graduate auto-lists on Gnoswap when inventory is sufficient"

# Deploy padv9 + hub SetModule pad=padv9 (testnet; legacy pads unused).
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDepositPad = "80000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPad = 280000000,
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

& "$PSScriptRoot\prepare-sapphire-v9.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\sapphire-v9\r\$Address\gnomemepad\padv9"
$padPath = "gno.land/r/$Address/gnomemepad/padv9"
$ammDir = Join-Path $ROOT "deploy\sapphire-v9\p\$Address\gnomemepad\ammmathv2"
$ammPath = "gno.land/p/$Address/gnomemepad/ammmathv2"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hubv2" }
if (-not $PointsPath) { $PointsPath = "gno.land/r/$Address/gnomemepad/pointsv2" }

Write-Host "=== Deploy padv9 ==="
Write-Host "Pkg: $padPath"
Write-Host "ammmathv2: $ammPath (old ammmath lacks MaxNetInForTokenOut)"
Write-Host "Prerequisite: bond realm live + Init (+ StartPromo). Run deploy-sapphire-bond.ps1 first."
Write-Host "Init wallet becomes protocol treasury (Admin UI)."

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

# 1) pure math first (pad depends on it)
$ammExisting = gnokey query vm/qpaths --data $ammPath -remote $Remote 2>&1 | Out-String
if ($ammExisting -match [regex]::Escape($ammPath)) {
  Write-Host "ammmathv2 already on chain, skip addpkg"
} else {
  Write-Host "=== addpkg ammmathv2 ==="
  Invoke-GnokeyDeploy -StepName "addpkg ammmathv2" -GnokeyCmd @(
    "maketx","addpkg",$KeyName,"-pkgpath",$ammPath,"-pkgdir",$ammDir,
    "-max-deposit","20000000ugnot","-gas-fee",$GasFee,"-gas-wanted","80000000",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

# 2) pad
$existing = gnokey query vm/qpaths --data $padPath -remote $Remote 2>&1 | Out-String
if ($existing -match [regex]::Escape($padPath)) {
  Write-Host "padv9 already on chain, skip addpkg"
} else {
  Write-Host "=== addpkg padv9 ==="
  Invoke-GnokeyDeploy -StepName "addpkg padv9" -GnokeyCmd @(
    "maketx","addpkg",$KeyName,"-pkgpath",$padPath,"-pkgdir",$padDir,
    "-max-deposit",$MaxDepositPad,"-gas-fee",$GasFee,"-gas-wanted","$GasWantedPad",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

if (-not $SkipInit) {
  try {
    Invoke-GnokeyDeploy -StepName "Init padv9" -GnokeyCmd @(
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
  Call-Hub @("pad", $padPath) "hub SetModule pad=padv9"
}

try {
  Write-Host "=== pointsv2 AllowPad padv9 ==="
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
Write-Host "Netlify: set PKG=$padPath (or rely on hub GetModule pad)"
Write-Host "UI: connect deploy wallet → nav Admin console"
Write-Host "Ops funding (price-safe auto-list):"
Write-Host "  1) WUGNOT on pad >= raised per listing (LP bucket, never sold for fee)"
Write-Host "  2) Preferred: >=100 GNS per listing on pad (skips fee swap)"
Write-Host "  3) Else: extra WUGNOT surplus for ExactOut fee (~1000+ GNOT @ ~10 GNOT/GNS)"
Write-Host "  4) Re-quote: node scripts/probe-gns-price.mjs"

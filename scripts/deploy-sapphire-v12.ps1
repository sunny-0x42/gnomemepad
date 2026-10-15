# Deploy padv12 + hub SetModule pad=padv12
# RetryListGnoswap for graduated internal-CPMM → Gnoswap after inventory fund.
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDepositPad = "80000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPad = 300000000,
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

& "$PSScriptRoot\prepare-sapphire-v12.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\sapphire-v12\r\$Address\gnomemepad\padv12"
$padPath = "gno.land/r/$Address/gnomemepad/padv12"
$ammDir = Join-Path $ROOT "deploy\sapphire-v12\p\$Address\gnomemepad\ammmathv2"
$ammPath = "gno.land/p/$Address/gnomemepad/ammmathv2"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hubv2" }
if (-not $PointsPath) { $PointsPath = "gno.land/r/$Address/gnomemepad/pointsv2" }

Write-Host "=== Deploy padv12 (RetryListGnoswap) ==="
Write-Host "Pkg: $padPath"

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

$existing = gnokey query vm/qpaths --data $padPath -remote $Remote 2>&1 | Out-String
if ($existing -match [regex]::Escape($padPath)) {
  Write-Host "padv12 already on chain, skip addpkg"
} else {
  Write-Host "=== addpkg padv12 ==="
  Invoke-GnokeyDeploy -StepName "addpkg padv12" -GnokeyCmd @(
    "maketx","addpkg",$KeyName,"-pkgpath",$padPath,"-pkgdir",$padDir,
    "-max-deposit",$MaxDepositPad,"-gas-fee",$GasFee,"-gas-wanted","$GasWantedPad",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

if (-not $SkipInit) {
  try {
    Invoke-GnokeyDeploy -StepName "Init padv12" -GnokeyCmd @(
      "maketx","call",$KeyName,"-pkgpath",$padPath,"-func","Init",
      "-gas-fee",$GasFee,"-gas-wanted","$GasWantedInit",
      "-broadcast","-chainid",$ChainId,"-remote",$Remote
    )
  } catch {
    Write-Host "Init note (may already be inited): $_"
  }
}

if (-not $SkipHub) {
  Write-Host "=== hubv2 SetModule pad -> padv12 ==="
  Invoke-GnokeyDeploy -StepName "hub SetModule pad" -GnokeyCmd @(
    "maketx","call",$KeyName,"-pkgpath",$HubPath,"-func","SetModule",
    "-args","pad","-args",$padPath,
    "-gas-fee",$GasFee,"-gas-wanted","30000000",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

if ($EnablePoints) {
  Write-Host "=== padv12 SetPointsEnabled true ==="
  Invoke-GnokeyDeploy -StepName "SetPointsEnabled" -GnokeyCmd @(
    "maketx","call",$KeyName,"-pkgpath",$padPath,"-func","SetPointsEnabled",
    "-args","true",
    "-gas-fee",$GasFee,"-gas-wanted","20000000",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

Write-Host ""
Write-Host "Done. Set Netlify PKG=$padPath"
Write-Host ""
Write-Host "Gnoswap inventory (before graduate OR before RetryListGnoswap):"
Write-Host "  Pad package address: query padAddr after deploy (or qeval .padAddr)"
Write-Host "  1) EOA Deposit ugnot on gno.land/r/gnoland/wugnot"
Write-Host "  2) Transfer WUGNOT to pad (>= raised / PoolUgnot per listing)"
Write-Host "  3) Prefer transfer >=100 GNS for CreatePool fee (else surplus WUGNOT for ExactOut)"
Write-Host "  4) Call RetryListGnoswap(id) if already graduated on internal CPMM"
Write-Host ""
Write-Host "NOTE: Gnomies on padv11 cannot RetryList (immutable). New launches use padv12."

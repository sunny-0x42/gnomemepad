# Deploy padv5 + optionally register on hub (and legacy_padv4).
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDepositPad = "50000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPad = 150000000,
  [int]$GasWantedInit = 30000000,
  [string]$HubPath = "",
  [switch]$SkipHub,
  [switch]$SkipInit
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Users\Hi\tools;$env:USERPROFILE\go\bin;$env:PATH"
Set-Location $ROOT

& "$PSScriptRoot\prepare-sapphire-v5.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\sapphire-v5\r\$Address\gnomemepad\padv5"
$padPath = "gno.land/r/$Address/gnomemepad/padv5"
$padv4 = "gno.land/r/$Address/gnomemepad/padv4"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hub" }

Write-Host "=== Deploy padv5 ==="
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

$existing = gnokey query vm/qpaths --data $padPath -remote $Remote 2>&1 | Out-String
if ($existing -match [regex]::Escape($padPath)) {
  Write-Host "padv5 already on chain, skip addpkg"
} else {
  Invoke-GnokeyDeploy -StepName "addpkg padv5" -GnokeyCmd @(
    "maketx","addpkg",$KeyName,"-pkgpath",$padPath,"-pkgdir",$padDir,
    "-max-deposit",$MaxDepositPad,"-gas-fee",$GasFee,"-gas-wanted","$GasWantedPad",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

if (-not $SkipInit) {
  try {
    Invoke-GnokeyDeploy -StepName "Init" -GnokeyCmd @(
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
  Call-Hub @("legacy_padv4", $padv4) "hub SetModule legacy_padv4"
  Call-Hub @("pad", $padPath) "hub SetModule pad=padv5"
}

Write-Host "OK $padPath"
Write-Host "Create bond = 2 GNOT, graduate = 100 GNOT"

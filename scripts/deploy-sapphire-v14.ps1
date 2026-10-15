# Deploy padv14 (WUGNOT curve) + hub SetModule pad=padv14
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDepositPad = "90000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPad = 350000000,
  [int]$GasWantedInit = 30000000,
  [string]$HubPath = "",
  [switch]$SkipHub,
  [switch]$SkipInit
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Users\Hi\tools;$env:USERPROFILE\go\bin;$env:PATH"
Set-Location $ROOT

$stuck = @(Get-Process -Name gnokey -ErrorAction SilentlyContinue)
if ($stuck.Count -gt 0) {
  Write-Host "Stopping stuck gnokey: $($stuck.Id -join ', ')"
  $stuck | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

& "$PSScriptRoot\prepare-sapphire-v14.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\sapphire-v14\r\$Address\gnomemepad\padv14"
$padPath = "gno.land/r/$Address/gnomemepad/padv14"
$ammDir = Join-Path $ROOT "deploy\sapphire-v14\p\$Address\gnomemepad\ammmathv2"
$ammPath = "gno.land/p/$Address/gnomemepad/ammmathv2"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hubv2" }

Write-Host "=== Deploy padv14 (WUGNOT raise + auto Gnoswap list) ==="
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
  Write-Host "padv14 already on chain, skip addpkg"
} else {
  Write-Host "=== addpkg padv14 ==="
  Invoke-GnokeyDeploy -StepName "addpkg padv14" -GnokeyCmd @(
    "maketx","addpkg",$KeyName,"-pkgpath",$padPath,"-pkgdir",$padDir,
    "-max-deposit",$MaxDepositPad,"-gas-fee",$GasFee,"-gas-wanted","$GasWantedPad",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

if (-not $SkipInit) {
  $initCheck = gnokey query vm/qeval --data "$padPath.ProtocolAddress()" -remote $Remote 2>&1 | Out-String
  if ($initCheck -match 'g1[a-z0-9]{38,}') {
    Write-Host "Already inited: $initCheck"
  } else {
    Write-Host "=== Init padv14 (no -args; Init takes no parameters) ==="
    try {
      Invoke-GnokeyDeploy -StepName "Init padv14" -GnokeyCmd @(
        "maketx","call",$KeyName,
        "-pkgpath",$padPath,
        "-func","Init",
        "-gas-fee",$GasFee,
        "-gas-wanted","$GasWantedInit",
        "-broadcast","-chainid",$ChainId,"-remote",$Remote
      )
    } catch {
      Write-Host "Init note (may already be inited): $_"
    }
  }
}

if (-not $SkipHub) {
  Write-Host "=== hub SetModule pad -> padv14 ==="
  try {
    Invoke-GnokeyDeploy -StepName "hub SetModule" -GnokeyCmd @(
      "maketx","call",$KeyName,
      "-pkgpath",$HubPath,
      "-func","SetModule",
      "-args","pad",
      "-args",$padPath,
      "-gas-fee",$GasFee,
      "-gas-wanted","30000000",
      "-broadcast","-chainid",$ChainId,"-remote",$Remote
    )
  } catch {
    Write-Host "SetModule note: $_"
  }
}

Write-Host ""
Write-Host "Done padv14."
Write-Host "  PKG=$padPath"
Write-Host "  Prefund ~100 GNS on pad for fee-free auto-list (optional but recommended)."
Write-Host "  Buy path: Deposit + Approve(pad) + Buy(id, amountWugnot, minOut)"

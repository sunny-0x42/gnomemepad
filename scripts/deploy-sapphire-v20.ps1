# Deploy padv20 + Init + hub SetModule pad=padv20
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
Set-Location $ROOT

. "$PSScriptRoot\gnokey-common.ps1"
Initialize-GnokeyPath
Import-DotEnvDeploy -Root $ROOT

if ($env:GNOKEY_NAME) { $KeyName = $env:GNOKEY_NAME }
if ($env:GNOKEY_ADDR) { $Address = $env:GNOKEY_ADDR }

Assert-DeployKeyExists -KeyName $KeyName -ExpectedAddress $Address

$stuck = @(Get-Process -Name gnokey -ErrorAction SilentlyContinue)
if ($stuck.Count -gt 0) {
  Write-Host "Stopping stuck gnokey: $($stuck.Id -join ', ')"
  $stuck | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

& "$PSScriptRoot\prepare-sapphire-v20.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\sapphire-v20\r\$Address\gnomemepad\padv20"
$padPath = "gno.land/r/$Address/gnomemepad/padv20"
$ammDir = Join-Path $ROOT "deploy\sapphire-v20\p\$Address\gnomemepad\ammmathv2"
$ammPath = "gno.land/p/$Address/gnomemepad/ammmathv2"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hubv2" }

Write-Host "=== Deploy padv20 ==="
Write-Host "  Key : $KeyName"
Write-Host "  Pkg : $padPath"

function Invoke-GnokeyDeploy {
  param([string[]]$GnokeyCmd, [string]$StepName)
  Invoke-Gnokey -Args $GnokeyCmd -StepName $StepName
}

$ammExisting = gnokey query vm/qpaths --data $ammPath -remote $Remote 2>&1 | Out-String
if ($ammExisting -match [regex]::Escape($ammPath)) {
  Write-Host "ammmathv2 already on chain, skip addpkg"
} else {
  Write-Host "=== addpkg ammmathv2 ==="
  Invoke-GnokeyDeploy -StepName "addpkg ammmathv2" -GnokeyCmd @(
    "maketx", "addpkg",
    "-pkgpath", $ammPath, "-pkgdir", $ammDir,
    "-max-deposit", "20000000ugnot", "-gas-fee", $GasFee, "-gas-wanted", "80000000",
    "-broadcast", "-chainid", $ChainId, "-remote", $Remote,
    $KeyName
  )
}

$existing = gnokey query vm/qpaths --data $padPath -remote $Remote 2>&1 | Out-String
if ($existing -match [regex]::Escape($padPath)) {
  Write-Host "padv20 already on chain, skip addpkg"
} else {
  Write-Host "=== addpkg padv20 ==="
  Invoke-GnokeyDeploy -StepName "addpkg padv20" -GnokeyCmd @(
    "maketx", "addpkg",
    "-pkgpath", $padPath, "-pkgdir", $padDir,
    "-max-deposit", $MaxDepositPad, "-gas-fee", $GasFee, "-gas-wanted", "$GasWantedPad",
    "-broadcast", "-chainid", $ChainId, "-remote", $Remote,
    $KeyName
  )
}

if (-not $SkipInit) {
  $initCheck = gnokey query vm/qeval --data "$padPath.ProtocolAddress()" -remote $Remote 2>&1 | Out-String
  if ($initCheck -match 'g1[a-z0-9]{38,}') {
    Write-Host "Already inited: $initCheck"
  } else {
    Write-Host "=== Init padv20 ==="
    try {
      Invoke-GnokeyDeploy -StepName "Init padv20" -GnokeyCmd @(
        "maketx", "call",
        "-pkgpath", $padPath,
        "-func", "Init",
        "-gas-fee", $GasFee,
        "-gas-wanted", "$GasWantedInit",
        "-broadcast", "-chainid", $ChainId, "-remote", $Remote,
        $KeyName
      )
    } catch {
      Write-Host "Init note: $_"
    }
  }
}

if (-not $SkipHub) {
  Write-Host "=== hub SetModule pad -> padv20 ==="
  Start-Sleep -Seconds 2
  try {
    Invoke-GnokeyDeploy -StepName "hub SetModule" -GnokeyCmd @(
      "maketx", "call",
      "-pkgpath", $HubPath,
      "-func", "SetModule",
      "-args", "pad",
      "-args", $padPath,
      "-gas-fee", $GasFee,
      "-gas-wanted", "30000000",
      "-broadcast", "-chainid", $ChainId, "-remote", $Remote,
      $KeyName
    )
  } catch {
    Write-Host "SetModule note: $_"
    Start-Sleep -Seconds 3
    Invoke-GnokeyDeploy -StepName "hub SetModule retry" -GnokeyCmd @(
      "maketx", "call",
      "-pkgpath", $HubPath,
      "-func", "SetModule",
      "-args", "pad",
      "-args", $padPath,
      "-gas-fee", $GasFee,
      "-gas-wanted", "30000000",
      "-broadcast", "-chainid", $ChainId, "-remote", $Remote,
      $KeyName
    )
  }
}

Write-Host ""
Write-Host "Done padv20."
Write-Host "  PKG=$padPath"
Write-Host "  Create: Transfer 100 GNS free -> Create(bond ugnot)"
Write-Host "  List: RetryList after graduate (escrowed GNS)"

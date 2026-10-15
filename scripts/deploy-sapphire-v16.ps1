# Deploy padv16 (WUGNOT push-pay) + hub SetModule pad=padv16
# Always uses gnokey key "deploykey" @ g1mv0052... unless -KeyName overridden.
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

# Prefer env overrides from .env.deploy
if ($env:GNOKEY_NAME) { $KeyName = $env:GNOKEY_NAME }
if ($env:GNOKEY_ADDR) { $Address = $env:GNOKEY_ADDR }

Assert-DeployKeyExists -KeyName $KeyName -ExpectedAddress $Address

$stuck = @(Get-Process -Name gnokey -ErrorAction SilentlyContinue)
if ($stuck.Count -gt 0) {
  Write-Host "Stopping stuck gnokey: $($stuck.Id -join ', ')"
  $stuck | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

& "$PSScriptRoot\prepare-sapphire-v16.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\sapphire-v16\r\$Address\gnomemepad\padv16"
$padPath = "gno.land/r/$Address/gnomemepad/padv16"
$ammDir = Join-Path $ROOT "deploy\sapphire-v16\p\$Address\gnomemepad\ammmathv2"
$ammPath = "gno.land/p/$Address/gnomemepad/ammmathv2"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hubv2" }

Write-Host "=== Deploy padv16 ==="
Write-Host "  Key : $KeyName"
Write-Host "  Addr: $Address"
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
  Write-Host "padv16 already on chain, skip addpkg"
} else {
  Write-Host "=== addpkg padv16 ==="
  Invoke-GnokeyDeploy -StepName "addpkg padv16" -GnokeyCmd @(
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
    Write-Host "=== Init padv16 ==="
    try {
      Invoke-GnokeyDeploy -StepName "Init padv16" -GnokeyCmd @(
        "maketx", "call",
        "-pkgpath", $padPath,
        "-func", "Init",
        "-gas-fee", $GasFee,
        "-gas-wanted", "$GasWantedInit",
        "-broadcast", "-chainid", $ChainId, "-remote", $Remote,
        $KeyName
      )
    } catch {
      Write-Host "Init note (may already be inited): $_"
    }
  }
}

if (-not $SkipHub) {
  Write-Host "=== hub SetModule pad -> padv16 ==="
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
  }
}

Write-Host ""
Write-Host "Done padv16."
Write-Host "  PKG=$padPath"
Write-Host "  Buy path (padv16): Deposit -> Transfer(pad, amount) -> Buy"

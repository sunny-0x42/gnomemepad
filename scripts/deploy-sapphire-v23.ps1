# Deploy padv23 (seamless graduate) + Init + hub SetModule
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
  $stuck | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

& "$PSScriptRoot\prepare-sapphire-v23.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\sapphire-v23\r\$Address\gnomemepad\padv23"
$padPath = "gno.land/r/$Address/gnomemepad/padv23"
$ammDir = Join-Path $ROOT "deploy\sapphire-v23\p\$Address\gnomemepad\ammmathv2"
$ammPath = "gno.land/p/$Address/gnomemepad/ammmathv2"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hubv2" }

Write-Host "=== Deploy padv23 (seamless graduate LP) ==="

function Invoke-GnokeyDeploy {
  param([string[]]$GnokeyCmd, [string]$StepName)
  Invoke-Gnokey -Args $GnokeyCmd -StepName $StepName
}

$ammExisting = gnokey query vm/qpaths --data $ammPath -remote $Remote 2>&1 | Out-String
if ($ammExisting -notmatch [regex]::Escape($ammPath)) {
  Invoke-GnokeyDeploy -StepName "addpkg ammmathv2" -GnokeyCmd @(
    "maketx", "addpkg", "-pkgpath", $ammPath, "-pkgdir", $ammDir,
    "-max-deposit", "20000000ugnot", "-gas-fee", $GasFee, "-gas-wanted", "80000000",
    "-broadcast", "-chainid", $ChainId, "-remote", $Remote, $KeyName
  )
} else { Write-Host "ammmathv2 skip" }

$existing = gnokey query vm/qpaths --data $padPath -remote $Remote 2>&1 | Out-String
if ($existing -notmatch [regex]::Escape($padPath)) {
  Invoke-GnokeyDeploy -StepName "addpkg padv23" -GnokeyCmd @(
    "maketx", "addpkg", "-pkgpath", $padPath, "-pkgdir", $padDir,
    "-max-deposit", $MaxDepositPad, "-gas-fee", $GasFee, "-gas-wanted", "$GasWantedPad",
    "-broadcast", "-chainid", $ChainId, "-remote", $Remote, $KeyName
  )
} else { Write-Host "padv23 already on chain" }

if (-not $SkipInit) {
  $initCheck = gnokey query vm/qeval --data "$padPath.ProtocolAddress()" -remote $Remote 2>&1 | Out-String
  if ($initCheck -notmatch 'g1[a-z0-9]{38,}') {
    Invoke-GnokeyDeploy -StepName "Init padv23" -GnokeyCmd @(
      "maketx", "call", "-pkgpath", $padPath, "-func", "Init",
      "-gas-fee", $GasFee, "-gas-wanted", "$GasWantedInit",
      "-broadcast", "-chainid", $ChainId, "-remote", $Remote, $KeyName
    )
  } else { Write-Host "Already inited" }
}

if (-not $SkipHub) {
  Start-Sleep -Seconds 2
  Invoke-GnokeyDeploy -StepName "hub SetModule padv23" -GnokeyCmd @(
    "maketx", "call", "-pkgpath", $HubPath, "-func", "SetModule",
    "-args", "pad", "-args", $padPath,
    "-gas-fee", $GasFee, "-gas-wanted", "30000000",
    "-broadcast", "-chainid", $ChainId, "-remote", $Remote, $KeyName
  )
}

Write-Host "Done padv23. Seamless LP + GraduationThreshold=10k GNOT. PKG=$padPath"
Write-Host "NOTE: existing padv22 listed pools keep dump seed; only NEW launches on padv23 get seamless price."

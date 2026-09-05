# Deploy padv23 to Pearl (pearl-1): 10_000 GNOT raise default, bond 100 GNOT
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.pearl.testnets.gno.land:443",
  [string]$ChainId = "pearl-1",
  [string]$MaxDepositPad = "90000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPad = 350000000,
  [int]$GasWantedInit = 30000000,
  [string]$HubPath = "",
  [string]$BondPath = "",
  [switch]$SkipHub,
  [switch]$SkipInit,
  [switch]$SkipBondInit
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
Set-Location $ROOT

. "$PSScriptRoot\gnokey-common.ps1"
Initialize-GnokeyPath
Import-DotEnvDeploy -Root $ROOT

if ($env:GNOKEY_NAME) { $KeyName = $env:GNOKEY_NAME }
if ($env:GNOKEY_ADDR) { $Address = $env:GNOKEY_ADDR }
if ($env:RPC_URL) { $Remote = $env:RPC_URL }
if ($env:CHAIN_ID) { $ChainId = $env:CHAIN_ID }

Assert-DeployKeyExists -KeyName $KeyName -ExpectedAddress $Address

& "$PSScriptRoot\prepare-pearl-v23.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\pearl-v23\r\$Address\gnomemepad\padv23"
$padPath = "gno.land/r/$Address/gnomemepad/padv23"
$ammDir = Join-Path $ROOT "deploy\pearl-v23\p\$Address\gnomemepad\ammmathv2"
$ammPath = "gno.land/p/$Address/gnomemepad/ammmathv2"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hubv2" }
if (-not $BondPath) { $BondPath = "gno.land/r/$Address/gnomemepad/bond" }

Write-Host "=== Deploy Pearl padv23 (raise 10_000 GNOT, bond 100 GNOT) ==="
Write-Host "  chain=$ChainId remote=$Remote"

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
  } else { Write-Host "pad already inited" }
}

if (-not $SkipBondInit) {
  $bondAdmin = gnokey query vm/qeval --data "$BondPath.Admin()" -remote $Remote 2>&1 | Out-String
  if ($bondAdmin -notmatch 'g1[a-z0-9]{38,}') {
    Write-Host "NOTE: bond must be deployed+Init separately (prepare-sapphire-bond / pearl bond). Skipping SetNormalBond."
  } else {
    Invoke-GnokeyDeploy -StepName "bond SetNormalBond 100 GNOT" -GnokeyCmd @(
      "maketx", "call", "-pkgpath", $BondPath, "-func", "SetNormalBond",
      "-args", "100000000",
      "-gas-fee", $GasFee, "-gas-wanted", "30000000",
      "-broadcast", "-chainid", $ChainId, "-remote", $Remote, $KeyName
    )
  }
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

Write-Host "Done Pearl padv23."
Write-Host "  PKG=$padPath"
Write-Host "  Default raise=10_000 GNOT (Admin SetGraduationThreshold to change)"
Write-Host "  Bond=100 GNOT via SetNormalBond (Admin SetNormalBond to change)"
Write-Host "  Faucet: https://pearl.testnets.gno.land/faucet"

# Deploy gnomemepad padv4 (security fixes) to Sapphire.
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDepositPad = "50000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPad = 150000000,
  [int]$GasWantedInit = 30000000,
  [switch]$SkipInit
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"
Set-Location $ROOT

& "$PSScriptRoot\prepare-sapphire-v4.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\sapphire-v4\r\$Address\gnomemepad\padv4"
$padPath = "gno.land/r/$Address/gnomemepad/padv4"
$mathPath = "gno.land/p/$Address/gnomemepad/ammmath"
$regPath = "gno.land/r/demo/defi/grc20reg"

Write-Host ""
Write-Host "=== Sapphire V4 deploy (security fixes / padv4) ==="
Write-Host "Key:  $KeyName"
Write-Host "Pkg:  $padPath"
Write-Host "Dir:  $padDir"
Write-Host ""

if (-not (Test-Path $padDir)) { throw "Package dir missing: $padDir" }

Write-Host "--- balance ---"
gnokey query bank/balances/$Address -remote $Remote
Write-Host ""

$q = gnokey query vm/qpaths --data $mathPath -remote $Remote 2>&1 | Out-String
if ($q -notmatch [regex]::Escape($mathPath)) { throw "Missing $mathPath on chain." }
Write-Host "OK dependency $mathPath"

$q2 = gnokey query vm/qpaths --data $regPath -remote $Remote 2>&1 | Out-String
if ($q2 -notmatch [regex]::Escape($regPath)) { throw "Missing $regPath on chain." }
Write-Host "OK dependency $regPath"
Write-Host ""

function Assert-Ok([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "Failed: $Step (exit $LASTEXITCODE)" }
}

function Invoke-GnokeyDeploy {
  param([string[]]$GnokeyCmd, [string]$StepName)
  if ($env:GNOKEY_PASS) {
    Write-Host "(using GNOKEY_PASS from env)"
    $env:GNOKEY_PASS | & gnokey @GnokeyCmd -insecure-password-stdin
  } else {
    Write-Host "Enter password for '$KeyName' (hidden)..."
    & gnokey @GnokeyCmd
  }
  Assert-Ok $StepName
}

$existing = gnokey query vm/qpaths --data $padPath -remote $Remote 2>&1 | Out-String
if ($existing -match [regex]::Escape($padPath)) {
  Write-Host "=== addpkg === already on chain, skip"
} else {
  Write-Host "=== 1/2 addpkg padv4 ==="
  Invoke-GnokeyDeploy -StepName "addpkg" -GnokeyCmd @(
    "maketx", "addpkg", $KeyName,
    "-pkgpath", $padPath,
    "-pkgdir", $padDir,
    "-max-deposit", $MaxDepositPad,
    "-gas-fee", $GasFee,
    "-gas-wanted", "$GasWantedPad",
    "-broadcast",
    "-chainid", $ChainId,
    "-remote", $Remote
  )
}

if (-not $SkipInit) {
  Write-Host "=== 2/2 Init ==="
  Invoke-GnokeyDeploy -StepName "Init" -GnokeyCmd @(
    "maketx", "call", $KeyName,
    "-pkgpath", $padPath,
    "-func", "Init",
    "-gas-fee", $GasFee,
    "-gas-wanted", "$GasWantedInit",
    "-broadcast",
    "-chainid", $ChainId,
    "-remote", $Remote
  )
}

Write-Host ""
Write-Host "OK Render: https://sapphire.testnets.gno.land/r/$Address/gnomemepad/padv4"
Write-Host "PKG=$padPath"

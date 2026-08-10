# Deploy hub + profile, then register paths on hub (padv4 + profile).
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDeposit = "25000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPkg = 80000000,
  [int]$GasWantedCall = 30000000,
  [string]$PadPath = "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv4"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"
Set-Location $ROOT

& "$PSScriptRoot\prepare-sapphire-modules.ps1" -Address $Address

$hubPath = "gno.land/r/$Address/gnomemepad/hub"
$profPath = "gno.land/r/$Address/gnomemepad/profile"
$hubDir = Join-Path $ROOT "deploy\sapphire-modules\r\$Address\gnomemepad\hub"
$profDir = Join-Path $ROOT "deploy\sapphire-modules\r\$Address\gnomemepad\profile"

Write-Host ""
Write-Host "=== Sapphire modules: hub + profile ==="
Write-Host "Hub:     $hubPath"
Write-Host "Profile: $profPath"
Write-Host "Pad:     $PadPath"
Write-Host ""

function Assert-Ok([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "Failed: $Step (exit $LASTEXITCODE)" }
}

function Invoke-GnokeyDeploy {
  param([string[]]$GnokeyCmd, [string]$StepName)
  if ($env:GNOKEY_PASS) {
    Write-Host "(using GNOKEY_PASS)"
    $env:GNOKEY_PASS | & gnokey @GnokeyCmd -insecure-password-stdin
  } else {
    Write-Host "Enter password for '$KeyName' (hidden)..."
    & gnokey @GnokeyCmd
  }
  Assert-Ok $StepName
}

function Ensure-AddPkg([string]$PkgPath, [string]$PkgDir, [string]$Label) {
  $existing = gnokey query vm/qpaths --data $PkgPath -remote $Remote 2>&1 | Out-String
  if ($existing -match [regex]::Escape($PkgPath)) {
    Write-Host "=== $Label already on chain, skip addpkg ==="
    return
  }
  Write-Host "=== addpkg $Label ==="
  Invoke-GnokeyDeploy -StepName "addpkg $Label" -GnokeyCmd @(
    "maketx", "addpkg", $KeyName,
    "-pkgpath", $PkgPath,
    "-pkgdir", $PkgDir,
    "-max-deposit", $MaxDeposit,
    "-gas-fee", $GasFee,
    "-gas-wanted", "$GasWantedPkg",
    "-broadcast",
    "-chainid", $ChainId,
    "-remote", $Remote
  )
}

function Ensure-Call([string]$PkgPath, [string]$Func, [string[]]$Args, [string]$Label) {
  Write-Host "=== call $Label ==="
  $cmd = @(
    "maketx", "call", $KeyName,
    "-pkgpath", $PkgPath,
    "-func", $Func,
    "-gas-fee", $GasFee,
    "-gas-wanted", "$GasWantedCall",
    "-broadcast",
    "-chainid", $ChainId,
    "-remote", $Remote
  )
  foreach ($a in $Args) {
    $cmd += @("-args", $a)
  }
  Invoke-GnokeyDeploy -StepName $Label -GnokeyCmd $cmd
}

gnokey query bank/balances/$Address -remote $Remote
Write-Host ""

Ensure-AddPkg $hubPath $hubDir "hub"
Ensure-AddPkg $profPath $profDir "profile"

# Init (ignore if already inited — may fail; user can re-run with care)
try {
  Ensure-Call $hubPath "Init" @() "hub.Init"
} catch {
  Write-Host "hub.Init: $($_.Exception.Message) (ok if already inited)"
}
try {
  Ensure-Call $profPath "Init" @() "profile.Init"
} catch {
  Write-Host "profile.Init: $($_.Exception.Message) (ok if already inited)"
}

# Register modules on hub
Ensure-Call $hubPath "SetModule" @("pad", $PadPath) "hub.SetModule pad"
Ensure-Call $hubPath "SetModule" @("profile", $profPath) "hub.SetModule profile"
Ensure-Call $hubPath "SetModule" @("legacy_padv3", "gno.land/r/$Address/gnomemepad/padv3") "hub.SetModule legacy_padv3"

Write-Host ""
Write-Host "OK hub:     https://sapphire.testnets.gno.land/r/$Address/gnomemepad/hub"
Write-Host "OK profile: https://sapphire.testnets.gno.land/r/$Address/gnomemepad/profile"
Write-Host "HUB=$hubPath"
Write-Host "PROFILE=$profPath"
Write-Host "Verify: gnokey query vm/qeval --data `"${hubPath}.ListModules()`" -remote $Remote"

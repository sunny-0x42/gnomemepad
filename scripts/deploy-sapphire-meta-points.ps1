# Deploy meta + points, register on hub.
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDeposit = "25000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPkg = 80000000,
  [int]$GasWantedCall = 30000000
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Users\Hi\tools;$env:USERPROFILE\go\bin;C:\Program Files\nodejs;$env:PATH"
Set-Location $ROOT

& "$PSScriptRoot\prepare-sapphire-meta-points.ps1" -Address $Address

$hubPath = "gno.land/r/$Address/gnomemepad/hub"
$metaPath = "gno.land/r/$Address/gnomemepad/meta"
$ptsPath = "gno.land/r/$Address/gnomemepad/points"
$metaDir = Join-Path $ROOT "deploy\sapphire-meta-points\r\$Address\gnomemepad\meta"
$ptsDir = Join-Path $ROOT "deploy\sapphire-meta-points\r\$Address\gnomemepad\points"

Write-Host ""
Write-Host "=== Deploy meta + points ==="
Write-Host "Meta:   $metaPath"
Write-Host "Points: $ptsPath"
Write-Host "Hub:    $hubPath"
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

function Ensure-Call {
  param(
    [string]$PkgPath,
    [string]$Func,
    [string[]]$FuncArgs = @(),
    [string]$Label
  )
  Write-Host "=== call $Label ==="
  if ($FuncArgs.Count -gt 0) { Write-Host "    args: $($FuncArgs -join ' | ')" }
  $cmd = [System.Collections.Generic.List[string]]::new()
  $cmd.AddRange([string[]]@(
    "maketx", "call", $KeyName,
    "-pkgpath", $PkgPath,
    "-func", $Func,
    "-gas-fee", $GasFee,
    "-gas-wanted", "$GasWantedCall",
    "-broadcast",
    "-chainid", $ChainId,
    "-remote", $Remote
  ))
  foreach ($a in $FuncArgs) {
    $cmd.Add("-args"); $cmd.Add([string]$a)
  }
  Invoke-GnokeyDeploy -StepName $Label -GnokeyCmd $cmd.ToArray()
}

gnokey query bank/balances/$Address -remote $Remote
Write-Host ""

Ensure-AddPkg -PkgPath $metaPath -PkgDir $metaDir -Label "meta"
Ensure-AddPkg -PkgPath $ptsPath -PkgDir $ptsDir -Label "points"

try { Ensure-Call -PkgPath $metaPath -Func "Init" -FuncArgs @() -Label "meta.Init" } catch { Write-Host "meta.Init: $($_.Exception.Message)" }
try { Ensure-Call -PkgPath $ptsPath -Func "Init" -FuncArgs @() -Label "points.Init" } catch { Write-Host "points.Init: $($_.Exception.Message)" }

# Register on hub (hub must already be live)
Ensure-Call -PkgPath $hubPath -Func "SetModule" -FuncArgs @("meta", $metaPath) -Label "hub.SetModule meta"
Ensure-Call -PkgPath $hubPath -Func "SetModule" -FuncArgs @("points", $ptsPath) -Label "hub.SetModule points"

Write-Host ""
Write-Host "--- ListModules ---"
gnokey query vm/qeval --data "${hubPath}.ListModules()" -remote $Remote
Write-Host ""
Write-Host "OK meta:   https://sapphire.testnets.gno.land/r/$Address/gnomemepad/meta"
Write-Host "OK points: https://sapphire.testnets.gno.land/r/$Address/gnomemepad/points"

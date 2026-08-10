# Deploy hub + profile, then register paths on hub (padv4 + profile).
# Safe to re-run: skips packages already on-chain; skips Init if already done.
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
$legacyPad = "gno.land/r/$Address/gnomemepad/padv3"

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
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$GnokeyCmd,
    [Parameter(Mandatory = $true)]
    [string]$StepName
  )
  if ($env:GNOKEY_PASS) {
    Write-Host "(using GNOKEY_PASS)"
    $env:GNOKEY_PASS | & gnokey @GnokeyCmd -insecure-password-stdin
  } else {
    Write-Host "Enter password for '$KeyName' (hidden)..."
    & gnokey @GnokeyCmd
  }
  Assert-Ok $StepName
}

function Ensure-AddPkg {
  param(
    [string]$PkgPath,
    [string]$PkgDir,
    [string]$Label
  )
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

# IMPORTANT: always call with -FuncArgs (named). Passing @() positionally
# in PowerShell splats the array into separate parameters (breaks multi-arg calls).
function Ensure-Call {
  param(
    [string]$PkgPath,
    [string]$Func,
    [string[]]$FuncArgs = @(),
    [string]$Label
  )
  Write-Host "=== call $Label ==="
  if ($FuncArgs -and $FuncArgs.Count -gt 0) {
    Write-Host "    args: $($FuncArgs -join ' | ')"
  }
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
    $cmd.Add("-args")
    $cmd.Add([string]$a)
  }
  Invoke-GnokeyDeploy -StepName $Label -GnokeyCmd $cmd.ToArray()
}

function Test-HubInited {
  $r = gnokey query vm/qeval --data "${hubPath}.Inited()" -remote $Remote 2>&1 | Out-String
  return ($r -match '\(true bool\)')
}

function Test-ModuleSet([string]$Name, [string]$ExpectPath) {
  $r = gnokey query vm/qeval --data "${hubPath}.GetModule(`"$Name`")" -remote $Remote 2>&1 | Out-String
  return ($r -match [regex]::Escape($ExpectPath))
}

gnokey query bank/balances/$Address -remote $Remote
Write-Host ""

Ensure-AddPkg -PkgPath $hubPath -PkgDir $hubDir -Label "hub"
Ensure-AddPkg -PkgPath $profPath -PkgDir $profDir -Label "profile"

if (Test-HubInited) {
  Write-Host "=== hub.Init already done, skip ==="
} else {
  Ensure-Call -PkgPath $hubPath -Func "Init" -FuncArgs @() -Label "hub.Init"
}

# profile.Init is optional (lazy init on SetProfile); try once, ignore failure
try {
  $pi = gnokey query vm/qeval --data "${profPath}.ProfileCount()" -remote $Remote 2>&1 | Out-String
  if ($pi -match 'Error|invalid|not found') {
    Ensure-Call -PkgPath $profPath -Func "Init" -FuncArgs @() -Label "profile.Init"
  } else {
    Write-Host "=== profile realm live (Init skip if already done) ==="
    # Still try Init only if never called — check via failed second Init is noisy; skip if count works
  }
} catch {
  try {
    Ensure-Call -PkgPath $profPath -Func "Init" -FuncArgs @() -Label "profile.Init"
  } catch {
    Write-Host "profile.Init: $($_.Exception.Message)"
  }
}

# Register modules (re-run safe if already set)
if (Test-ModuleSet "pad" $PadPath) {
  Write-Host "=== hub pad already = $PadPath ==="
} else {
  Ensure-Call -PkgPath $hubPath -Func "SetModule" -FuncArgs @("pad", $PadPath) -Label "hub.SetModule pad"
}

if (Test-ModuleSet "profile" $profPath) {
  Write-Host "=== hub profile already set ==="
} else {
  Ensure-Call -PkgPath $hubPath -Func "SetModule" -FuncArgs @("profile", $profPath) -Label "hub.SetModule profile"
}

if (Test-ModuleSet "legacy_padv3" $legacyPad) {
  Write-Host "=== hub legacy_padv3 already set ==="
} else {
  Ensure-Call -PkgPath $hubPath -Func "SetModule" -FuncArgs @("legacy_padv3", $legacyPad) -Label "hub.SetModule legacy_padv3"
}

Write-Host ""
Write-Host "--- ListModules ---"
gnokey query vm/qeval --data "${hubPath}.ListModules()" -remote $Remote
Write-Host ""
Write-Host "OK hub:     https://sapphire.testnets.gno.land/r/$Address/gnomemepad/hub"
Write-Host "OK profile: https://sapphire.testnets.gno.land/r/$Address/gnomemepad/profile"
Write-Host "HUB=$hubPath"
Write-Host "PROFILE=$profPath"

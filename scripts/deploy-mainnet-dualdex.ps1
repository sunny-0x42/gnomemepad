# Deploy dual-DEX gnomi pad cut to mainnet gnoland-1 under g1n4pl5.../gnomi/*
# HUMAN YES required. GPAO may PARK MsgAddPackage until EnablePackage.
# Does NOT set MAINNET_PAD_READY / Netlify.
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt",
  [string]$Remote = "https://rpc.onbloc.xyz:443",
  [string]$ChainId = "gnoland-1",
  [string]$GasFee = "2000000ugnot",
  [switch]$SkipPrepare,
  [switch]$SkipInit,
  [switch]$InitOnly
)

$ErrorActionPreference = "Continue"
$ROOT = Split-Path $PSScriptRoot -Parent
Set-Location $ROOT

. "$PSScriptRoot\gnokey-common.ps1"
Initialize-GnokeyPath
Import-DotEnvDeploy -Root $ROOT
if ($env:GNOKEY_NAME) { $KeyName = $env:GNOKEY_NAME }
$Address = "g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt"

Write-Host "=== ANNOUNCE: Mainnet dual-DEX pad deploy (GPAO-aware) ===" -ForegroundColor Cyan
Write-Host "  key=$KeyName expect=$Address"
Write-Host "  chain=$ChainId remote=$Remote"
Write-Host "  paths: gno.land/{p,r}/$Address/gnomi/{ammmath,bond,pointsv2,hubv2,meta,pad}"
Write-Host "  economics: raise 300k GNOT / bond 150 GNOT / list fee 100 GNS / default zdex"

Assert-DeployKeyExists -KeyName $KeyName -ExpectedAddress $Address

if ((-not $SkipPrepare) -and (-not $InitOnly)) {
  node "$ROOT\scripts\prepare-mainnet-gnomi.mjs" --deployer $Address
  if ($LASTEXITCODE -ne 0) { throw "prepare-mainnet-gnomi failed" }
}

$baseR = Join-Path $ROOT "deploy\mainnet-v1\r\$Address\gnomi"
$baseP = Join-Path $ROOT "deploy\mainnet-v1\p\$Address\gnomi"

$steps = @(
  @{ Name = "ammmath"; Dir = (Join-Path $baseP "ammmath"); Path = "gno.land/p/$Address/gnomi/ammmath"; Deposit = "15000000ugnot"; Gas = 60000000; DoInit = $false },
  @{ Name = "bond"; Dir = (Join-Path $baseR "bond"); Path = "gno.land/r/$Address/gnomi/bond"; Deposit = "20000000ugnot"; Gas = 100000000; DoInit = $true },
  @{ Name = "pointsv2"; Dir = (Join-Path $baseR "pointsv2"); Path = "gno.land/r/$Address/gnomi/pointsv2"; Deposit = "25000000ugnot"; Gas = 120000000; DoInit = $true },
  @{ Name = "hubv2"; Dir = (Join-Path $baseR "hubv2"); Path = "gno.land/r/$Address/gnomi/hubv2"; Deposit = "15000000ugnot"; Gas = 80000000; DoInit = $true },
  @{ Name = "meta"; Dir = (Join-Path $baseR "meta"); Path = "gno.land/r/$Address/gnomi/meta"; Deposit = "15000000ugnot"; Gas = 80000000; DoInit = $true },
  @{ Name = "pad"; Dir = (Join-Path $baseR "pad"); Path = "gno.land/r/$Address/gnomi/pad"; Deposit = "50000000ugnot"; Gas = 350000000; DoInit = $true }
)

function Test-PkgExists([string]$PkgPath) {
  try {
    $out = & gnokey query vm/qpaths --data $PkgPath -remote $Remote 2>&1 | Out-String
    return ($out -match [regex]::Escape($PkgPath))
  } catch {
    return $false
  }
}

function Test-PkgCallable([string]$PkgPath) {
  try {
    $probe = "$PkgPath.Render(`"`")"
    if ($PkgPath -match '/pad$') { $probe = "$PkgPath.GraduationThresholdLive()" }
    elseif ($PkgPath -match '/bond$') { $probe = "$PkgPath.NormalBondUgnot()" }
    elseif ($PkgPath -match '/ammmath$') { $probe = "$PkgPath.MulDiv(1,1,1)" }
    $out = & gnokey query vm/qeval --data $probe -remote $Remote 2>&1 | Out-String
    if ($out -match 'invalid package|not found|Name Error|undeclared|parked') { return $false }
    if ($out -match '(?i)error:') { return $false }
    return $true
  } catch {
    return $false
  }
}

if (-not $InitOnly) {
  foreach ($s in $steps) {
    if (-not (Test-Path $s.Dir)) { throw "Missing package dir $($s.Dir)" }
    if (Test-PkgExists $s.Path) {
      Write-Host "SKIP addpkg $($s.Name) (path listed)" -ForegroundColor Yellow
    } else {
      Write-Host "ADD $($s.Path)" -ForegroundColor Green
      try {
        Invoke-Gnokey -StepName "addpkg $($s.Name)" -Args @(
          "maketx", "addpkg",
          "-pkgpath", $s.Path,
          "-pkgdir", $s.Dir,
          "-max-deposit", $s.Deposit,
          "-gas-fee", $GasFee,
          "-gas-wanted", "$($s.Gas)",
          "-broadcast",
          "-chainid", $ChainId,
          "-remote", $Remote,
          $KeyName
        )
      } catch {
        Write-Host "addpkg $($s.Name) note (may be GPAO-parked): $_" -ForegroundColor Yellow
      }
    }
  }
}

if ($SkipInit) {
  Write-Host "SkipInit set - done after addpkg." -ForegroundColor Cyan
  exit 0
}

Write-Host ""
Write-Host "=== Post-GPAO Init / wire (only if packages callable) ===" -ForegroundColor Cyan

foreach ($s in $steps) {
  if (-not $s.DoInit) { continue }
  if (-not (Test-PkgCallable $s.Path)) {
    Write-Host "WAIT Init $($s.Name) - package not callable yet (GPAO?)" -ForegroundColor Yellow
    continue
  }
  # Do not match g1 inside pkg path — only the qeval result value.
  $already = $false
  if ($s.Name -eq "pad") {
    $initProbe = & gnokey query vm/qeval --data "$($s.Path).ProtocolAddress()" -remote $Remote 2>&1 | Out-String
    if ($initProbe -match '\(("[^"]*"|g1[a-z0-9]+) string\)' -and $initProbe -notmatch 'call Init first|not initialized') {
      $already = $true
    }
  } else {
    $adminProbe = & gnokey query vm/qeval --data "$($s.Path).Admin()" -remote $Remote 2>&1 | Out-String
    if ($adminProbe -match '\(("[^"]*"|g1[a-z0-9]+) string\)' -and $adminProbe -notmatch 'call Init first|not initialized') {
      $already = $true
    }
  }
  if ($already) {
    Write-Host "SKIP Init $($s.Name) (already inited)" -ForegroundColor Yellow
  } else {
    Write-Host "INIT $($s.Path)" -ForegroundColor Green
    try {
      Invoke-Gnokey -StepName "Init $($s.Name)" -Args @(
        "maketx", "call",
        "-pkgpath", $s.Path,
        "-func", "Init",
        "-gas-fee", $GasFee,
        "-gas-wanted", "80000000",
        "-broadcast",
        "-chainid", $ChainId,
        "-remote", $Remote,
        $KeyName
      )
    } catch {
      Write-Host "Init $($s.Name) note: $_" -ForegroundColor Yellow
    }
  }
}

$Hub = "gno.land/r/$Address/gnomi/hubv2"
$Pad = "gno.land/r/$Address/gnomi/pad"
$Bond = "gno.land/r/$Address/gnomi/bond"

if (Test-PkgCallable $Hub) {
  $mods = @(
    @{ N = "pad"; P = $Pad },
    @{ N = "bond"; P = $Bond },
    @{ N = "meta"; P = "gno.land/r/$Address/gnomi/meta" },
    @{ N = "points"; P = "gno.land/r/$Address/gnomi/pointsv2" }
  )
  foreach ($m in $mods) {
    try {
      Invoke-Gnokey -StepName ("SetModule " + $m.N) -Args @(
        "maketx", "call",
        "-pkgpath", $Hub,
        "-func", "SetModule",
        "-args", $m.N,
        "-args", $m.P,
        "-gas-fee", $GasFee,
        "-gas-wanted", "40000000",
        "-broadcast",
        "-chainid", $ChainId,
        "-remote", $Remote,
        $KeyName
      )
    } catch {
      Write-Host ("SetModule " + $m.N + ": " + $_) -ForegroundColor Yellow
    }
  }
} else {
  Write-Host "WAIT hub SetModule - hub not callable" -ForegroundColor Yellow
}

if (Test-PkgCallable $Bond) {
  try {
    Invoke-Gnokey -StepName "SetNormalBond 150GNOT" -Args @(
      "maketx", "call",
      "-pkgpath", $Bond,
      "-func", "SetNormalBond",
      "-args", "150000000",
      "-gas-fee", $GasFee,
      "-gas-wanted", "30000000",
      "-broadcast",
      "-chainid", $ChainId,
      "-remote", $Remote,
      $KeyName
    )
  } catch { Write-Host ("bond: " + $_) -ForegroundColor Yellow }
}

if (Test-PkgCallable $Pad) {
  try {
    Invoke-Gnokey -StepName "SetGraduationThreshold 300k" -Args @(
      "maketx", "call",
      "-pkgpath", $Pad,
      "-func", "SetGraduationThreshold",
      "-args", "300000000000",
      "-gas-fee", $GasFee,
      "-gas-wanted", "30000000",
      "-broadcast",
      "-chainid", $ChainId,
      "-remote", $Remote,
      $KeyName
    )
  } catch { Write-Host ("grad: " + $_) -ForegroundColor Yellow }

  try {
    Invoke-Gnokey -StepName "SetDefaultListVenue zdex" -Args @(
      "maketx", "call",
      "-pkgpath", $Pad,
      "-func", "SetDefaultListVenue",
      "-args", "zdex",
      "-gas-fee", $GasFee,
      "-gas-wanted", "30000000",
      "-broadcast",
      "-chainid", $ChainId,
      "-remote", $Remote,
      $KeyName
    )
  } catch { Write-Host ("default venue: " + $_) -ForegroundColor Yellow }

  $venues = @(
    @{ Id = "zdex"; Label = "zdex"; En = "true"; Fee = "ugnot" },
    @{ Id = "gnoswap"; Label = "Gnoswap"; En = "true"; Fee = "GNS" }
  )
  foreach ($v in $venues) {
    try {
      Invoke-Gnokey -StepName ("SetListVenue " + $v.Id) -Args @(
        "maketx", "call",
        "-pkgpath", $Pad,
        "-func", "SetListVenue",
        "-args", $v.Id,
        "-args", $v.Label,
        "-args", $v.En,
        "-args", $v.Fee,
        "-gas-fee", $GasFee,
        "-gas-wanted", "30000000",
        "-broadcast",
        "-chainid", $ChainId,
        "-remote", $Remote,
        $KeyName
      )
    } catch { Write-Host ("venue " + $v.Id + ": " + $_) -ForegroundColor Yellow }
  }
}

Write-Host ""
Write-Host "Done. If packages parked: re-run with -InitOnly after GPAO EnablePackage." -ForegroundColor Cyan
Write-Host "Do NOT set MAINNET_PAD_READY=1 until Init + SetModule verified." -ForegroundColor Yellow

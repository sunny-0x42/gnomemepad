# Deploy dual-DEX pad cut to Pearl under g1n4pl5…/gnomi/*
# HUMAN YES required (caller must confirm). Testnet pearl-1.
# Does NOT replace hub padv23 under g1mv0052 — parallel pad for dual-DEX testing.
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt",
  [string]$Remote = "https://rpc.pearl.testnets.gno.land:443",
  [string]$ChainId = "pearl-1",
  [string]$GasFee = "1000000ugnot",
  [switch]$SkipInit
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
Set-Location $ROOT

. "$PSScriptRoot\gnokey-common.ps1"
Initialize-GnokeyPath
Import-DotEnvDeploy -Root $ROOT
if ($env:GNOKEY_NAME) { $KeyName = $env:GNOKEY_NAME }
# Force address to the key we actually have for this cut
$Address = "g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt"

Write-Host "=== ANNOUNCE: Pearl dual-DEX pad deploy ===" -ForegroundColor Cyan
Write-Host "  key=$KeyName expect=$Address"
Write-Host "  chain=$ChainId remote=$Remote"
Write-Host "  paths: gno.land/{p,r}/$Address/gnomi/{ammmath,bond,pointsv2,pad}"

Assert-DeployKeyExists -KeyName $KeyName -ExpectedAddress $Address

# Refresh tree from source
node "$ROOT\scripts\prepare-mainnet-gnomi.mjs" --deployer $Address
if ($LASTEXITCODE -ne 0) { throw "prepare-mainnet-gnomi failed" }

$baseR = Join-Path $ROOT "deploy\mainnet-v1\r\$Address\gnomi"
$baseP = Join-Path $ROOT "deploy\mainnet-v1\p\$Address\gnomi"

$steps = @(
  @{ Name = "ammmath"; Kind = "p"; Dir = (Join-Path $baseP "ammmath"); Path = "gno.land/p/$Address/gnomi/ammmath"; Deposit = "20000000ugnot"; Gas = 80000000; Init = $false },
  @{ Name = "bond"; Kind = "r"; Dir = (Join-Path $baseR "bond"); Path = "gno.land/r/$Address/gnomi/bond"; Deposit = "30000000ugnot"; Gas = 120000000; Init = $true },
  @{ Name = "pointsv2"; Kind = "r"; Dir = (Join-Path $baseR "pointsv2"); Path = "gno.land/r/$Address/gnomi/pointsv2"; Deposit = "40000000ugnot"; Gas = 150000000; Init = $true },
  @{ Name = "pad"; Kind = "r"; Dir = (Join-Path $baseR "pad"); Path = "gno.land/r/$Address/gnomi/pad"; Deposit = "90000000ugnot"; Gas = 400000000; Init = $true }
)

function Test-PkgExists([string]$PkgPath) {
  $out = & gnokey query vm/qpaths --data $PkgPath -remote $Remote 2>&1 | Out-String
  return ($out -match [regex]::Escape($PkgPath))
}

foreach ($s in $steps) {
  if (-not (Test-Path $s.Dir)) { throw "Missing package dir $($s.Dir)" }
  if (Test-PkgExists $s.Path) {
    Write-Host "SKIP addpkg $($s.Name) (exists)" -ForegroundColor Yellow
  } else {
    Write-Host "ADD $($s.Path)" -ForegroundColor Green
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
  }
  if ($s.Init -and -not $SkipInit) {
    $already = $false
    if ($s.Name -eq "pad") {
      $initProbe = & gnokey query vm/qeval --data "$($s.Path).ProtocolAddress()" -remote $Remote 2>&1 | Out-String
      if ($initProbe -match 'g1[a-z0-9]{38,}') { $already = $true }
    } else {
      $adminProbe = & gnokey query vm/qeval --data "$($s.Path).Admin()" -remote $Remote 2>&1 | Out-String
      if ($adminProbe -match 'g1[a-z0-9]{38,}') { $already = $true }
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
          "-gas-wanted", "50000000",
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
}

$padPath = "gno.land/r/$Address/gnomi/pad"
Write-Host "=== Post-deploy probes ===" -ForegroundColor Cyan
foreach ($expr in @(
  "$padPath.ProtocolAddress()",
  "$padPath.ListVenues()",
  "$padPath.DefaultListVenue()",
  "$padPath.ListFeeRequiredFor(`"zdex`")",
  "$padPath.ListFeeRequiredFor(`"gnoswap`")"
)) {
  $out = & gnokey query vm/qeval --data $expr -remote $Remote 2>&1 | Out-String
  Write-Host "--- $expr"
  Write-Host $out.Substring(0, [Math]::Min(400, $out.Length))
}

# Enable both venues + set defaults for dual-DEX
Write-Host "=== Configure venues ===" -ForegroundColor Cyan
try {
  Invoke-Gnokey -StepName "SetListVenue zdex" -Args @(
    "maketx", "call", "-pkgpath", $padPath, "-func", "SetListVenue",
    "-args", "zdex", "-args", "zdex", "-args", "true", "-args", "ugnot",
    "-gas-fee", $GasFee, "-gas-wanted", "40000000",
    "-broadcast", "-chainid", $ChainId, "-remote", $Remote, $KeyName
  )
} catch { Write-Host "SetListVenue zdex: $_" -ForegroundColor Yellow }
try {
  Invoke-Gnokey -StepName "SetListVenue gnoswap" -Args @(
    "maketx", "call", "-pkgpath", $padPath, "-func", "SetListVenue",
    "-args", "gnoswap", "-args", "Gnoswap", "-args", "true", "-args", "GNS",
    "-gas-fee", $GasFee, "-gas-wanted", "40000000",
    "-broadcast", "-chainid", $ChainId, "-remote", $Remote, $KeyName
  )
} catch { Write-Host "SetListVenue gnoswap: $_" -ForegroundColor Yellow }
try {
  Invoke-Gnokey -StepName "SetDefaultListVenue zdex" -Args @(
    "maketx", "call", "-pkgpath", $padPath, "-func", "SetDefaultListVenue",
    "-args", "zdex",
    "-gas-fee", $GasFee, "-gas-wanted", "30000000",
    "-broadcast", "-chainid", $ChainId, "-remote", $Remote, $KeyName
  )
} catch { Write-Host "SetDefaultListVenue: $_" -ForegroundColor Yellow }

Write-Host "DONE. Point UI Pearl PKG to: $padPath" -ForegroundColor Green
Write-Host "Note: hubv2 under g1mv0052 still points at padv23 until that key SetModule." -ForegroundColor Yellow

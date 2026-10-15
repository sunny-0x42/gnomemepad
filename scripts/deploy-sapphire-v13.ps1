# Deploy padv13 + hub SetModule pad=padv13
# Auto Gnoswap list: caller wraps WUGNOT + Approve; pad TransferFrom + list + reimburse LP ugnot.
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDepositPad = "90000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPad = 320000000,
  [int]$GasWantedInit = 30000000,
  [string]$HubPath = "",
  [switch]$SkipHub,
  [switch]$SkipInit
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Users\Hi\tools;$env:USERPROFILE\go\bin;$env:PATH"
Set-Location $ROOT

# keys.db is exclusive on Windows - a stuck gnokey from a previous run blocks maketx.
$stuck = @(Get-Process -Name gnokey -ErrorAction SilentlyContinue)
if ($stuck.Count -gt 0) {
  Write-Host "Stopping stuck gnokey process(es) holding keys.db: $($stuck.Id -join ', ')"
  $stuck | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

& "$PSScriptRoot\prepare-sapphire-v13.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\sapphire-v13\r\$Address\gnomemepad\padv13"
$padPath = "gno.land/r/$Address/gnomemepad/padv13"
$ammDir = Join-Path $ROOT "deploy\sapphire-v13\p\$Address\gnomemepad\ammmathv2"
$ammPath = "gno.land/p/$Address/gnomemepad/ammmathv2"
if (-not $HubPath) { $HubPath = "gno.land/r/$Address/gnomemepad/hubv2" }

Write-Host "=== Deploy padv13 (caller-funded Gnoswap list) ==="
Write-Host "Pkg: $padPath"

function Assert-Ok([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "Failed: $Step" }
}
function Invoke-GnokeyDeploy {
  param([string[]]$GnokeyCmd, [string]$StepName)
  if ($env:GNOKEY_PASS) {
    $env:GNOKEY_PASS | & gnokey @GnokeyCmd -insecure-password-stdin
  } else {
    Write-Host "Enter password for '$KeyName' (hidden)..."
    & gnokey @GnokeyCmd
  }
  Assert-Ok $StepName
}

$ammExisting = gnokey query vm/qpaths --data $ammPath -remote $Remote 2>&1 | Out-String
if ($ammExisting -match [regex]::Escape($ammPath)) {
  Write-Host "ammmathv2 already on chain, skip addpkg"
} else {
  Write-Host "=== addpkg ammmathv2 ==="
  Invoke-GnokeyDeploy -StepName "addpkg ammmathv2" -GnokeyCmd @(
    "maketx","addpkg",$KeyName,"-pkgpath",$ammPath,"-pkgdir",$ammDir,
    "-max-deposit","20000000ugnot","-gas-fee",$GasFee,"-gas-wanted","80000000",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

$existing = gnokey query vm/qpaths --data $padPath -remote $Remote 2>&1 | Out-String
if ($existing -match [regex]::Escape($padPath)) {
  Write-Host "padv13 already on chain, skip addpkg"
} else {
  Write-Host "=== addpkg padv13 ==="
  Invoke-GnokeyDeploy -StepName "addpkg padv13" -GnokeyCmd @(
    "maketx","addpkg",$KeyName,"-pkgpath",$padPath,"-pkgdir",$padDir,
    "-max-deposit",$MaxDepositPad,"-gas-fee",$GasFee,"-gas-wanted","$GasWantedPad",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

if (-not $SkipInit) {
  try {
    Invoke-GnokeyDeploy -StepName "Init padv13" -GnokeyCmd @(
      "maketx","call",$KeyName,"-pkgpath",$padPath,"-func","Init",
      "-gas-fee",$GasFee,"-gas-wanted","$GasWantedInit",
      "-broadcast","-chainid",$ChainId,"-remote",$Remote
    )
  } catch {
    Write-Host "Init note (may already be inited): $_"
  }
}

if (-not $SkipHub) {
  Write-Host "=== hubv2 SetModule pad -> padv13 ==="
  Invoke-GnokeyDeploy -StepName "hub SetModule pad" -GnokeyCmd @(
    "maketx","call",$KeyName,"-pkgpath",$HubPath,"-func","SetModule",
    "-args","pad","-args",$padPath,
    "-gas-fee",$GasFee,"-gas-wanted","30000000",
    "-broadcast","-chainid",$ChainId,"-remote",$Remote
  )
}

Write-Host ""
Write-Host "Done. Set Netlify PKG=$padPath"
Write-Host ""
Write-Host "=== padv13 economics ==="
Write-Host "  Raise target: 10000 GNOT"
Write-Host "  Virtual: 3500 GNOT / 1.073B tokens (R_max ~10.2k > threshold)"
Write-Host ""
Write-Host "=== AUTO-LIST readiness (fund BEFORE markets hit 10k) ==="
Write-Host "  1) Query padAddr:"
Write-Host "     gnokey query vm/qeval --data `"$padPath.padAddr`" -remote $Remote"
Write-Host "  2) EOA wrap: wugnot.Deposit -send 10000000000ugnot  (10k GNOT)"
Write-Host "  3) Transfer WUGNOT to padAddr (LP inventory; top up each listing)"
Write-Host "  4) Transfer >= 100 GNS to padAddr (CreatePool fee; preferred)"
Write-Host "  5) Graduate auto-lists if inventory OK; else RetryListGnoswap from caller"
Write-Host ""
Write-Host "Without steps 2-4, markets still graduate to internal CPMM (not Gnoswap)."

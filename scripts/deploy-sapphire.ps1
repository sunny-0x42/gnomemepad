# Deploy gnomemepad to Gno.land Sapphire (sapphire-1).
# Interactive: gnokey asks for password each tx (characters hidden - normal).
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDepositMath = "50000000ugnot",
  [string]$MaxDepositPad = "100000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedMath = 50000000,
  [int]$GasWantedPad = 100000000,
  [int]$GasWantedInit = 30000000,
  [switch]$SkipInit,
  [switch]$SkipMath
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"
Set-Location $ROOT

if (-not (Get-Command gnokey -ErrorAction SilentlyContinue)) {
  throw "gnokey not found on PATH"
}

& "$PSScriptRoot\prepare-sapphire-deploy.ps1" -Address $Address

$mathDir = Join-Path $ROOT "deploy\sapphire\p\$Address\gnomemepad\ammmath"
$padDir = Join-Path $ROOT "deploy\sapphire\r\$Address\gnomemepad\pad"
$mathPath = "gno.land/p/$Address/gnomemepad/ammmath"
$padPath = "gno.land/r/$Address/gnomemepad/pad"

Write-Host ""
Write-Host "=== Sapphire deploy (interactive password) ==="
Write-Host "Key:     $KeyName"
Write-Host "Address: $Address"
Write-Host ""
Write-Host "Type password when gnokey prompts (nothing shown), then Enter."
Write-Host ""

Write-Host "--- balance ---"
gnokey query bank/balances/$Address -remote $Remote
Write-Host ""

# Detect already-deployed math
$mathExists = $false
$q = gnokey query vm/qpaths --data $mathPath -remote $Remote 2>&1 | Out-String
if ($q -match [regex]::Escape($mathPath)) { $mathExists = $true }

function Assert-GnokeyOk {
  param([string]$Step)
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed: $Step - see gnokey error output above."
  }
}

if ($SkipMath -or $mathExists) {
  Write-Host "=== 1/3 addpkg ammmath === SKIPPED (already on chain or -SkipMath)"
} else {
  Write-Host "=== 1/3 addpkg ammmath ==="
  gnokey maketx addpkg $KeyName `
    -pkgpath $mathPath `
    -pkgdir $mathDir `
    -max-deposit $MaxDepositMath `
    -gas-fee $GasFee `
    -gas-wanted $GasWantedMath `
    -broadcast `
    -chainid $ChainId `
    -remote $Remote
  Assert-GnokeyOk "1/3 ammmath"
}

Write-Host "=== 2/3 addpkg pad ==="
gnokey maketx addpkg $KeyName `
  -pkgpath $padPath `
  -pkgdir $padDir `
  -max-deposit $MaxDepositPad `
  -gas-fee $GasFee `
  -gas-wanted $GasWantedPad `
  -broadcast `
  -chainid $ChainId `
  -remote $Remote
Assert-GnokeyOk "2/3 pad"

if (-not $SkipInit) {
  Write-Host "=== 3/3 Init ==="
  gnokey maketx call $KeyName `
    -pkgpath $padPath `
    -func Init `
    -gas-fee $GasFee `
    -gas-wanted $GasWantedInit `
    -broadcast `
    -chainid $ChainId `
    -remote $Remote
  Assert-GnokeyOk "3/3 Init"
}

Write-Host ""
Write-Host "Done."
Write-Host "Render: https://sapphire.testnets.gno.land/r/$Address/gnomemepad/pad"
Write-Host "UI:     powershell -ExecutionPolicy Bypass -File scripts\start-ui-sapphire.ps1"

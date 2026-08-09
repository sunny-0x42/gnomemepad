# Deploy gnomemepad padv2 (GRC20) to Sapphire. Interactive gnokey password.
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$MaxDepositPad = "40000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedPad = 120000000,
  [int]$GasWantedInit = 30000000,
  [switch]$SkipInit
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"
Set-Location $ROOT

& "$PSScriptRoot\prepare-sapphire-v2.ps1" -Address $Address

$padDir = Join-Path $ROOT "deploy\sapphire-v2\r\$Address\gnomemepad\padv2"
$padPath = "gno.land/r/$Address/gnomemepad/padv2"
$mathPath = "gno.land/p/$Address/gnomemepad/ammmath"

Write-Host ""
Write-Host "=== Sapphire V2 deploy (GRC20 / padv2) ==="
Write-Host "Key:  $KeyName"
Write-Host "Pkg:  $padPath"
Write-Host ""

Write-Host "--- balance ---"
gnokey query bank/balances/$Address -remote $Remote
Write-Host ""

$q = gnokey query vm/qpaths --data $mathPath -remote $Remote 2>&1 | Out-String
if ($q -notmatch [regex]::Escape($mathPath)) {
  throw "Missing $mathPath on chain. Deploy ammmath first."
}
Write-Host "OK dependency $mathPath"
Write-Host ""

function Assert-Ok([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "Failed: $Step" }
}

$existing = gnokey query vm/qpaths --data $padPath -remote $Remote 2>&1 | Out-String
if ($existing -match [regex]::Escape($padPath)) {
  Write-Host "=== addpkg === already on chain, skip"
} else {
  Write-Host "=== 1/2 addpkg padv2 ==="
  Write-Host "Enter password for '$KeyName' (hidden)..."
  gnokey maketx addpkg $KeyName `
    -pkgpath $padPath `
    -pkgdir $padDir `
    -max-deposit $MaxDepositPad `
    -gas-fee $GasFee `
    -gas-wanted $GasWantedPad `
    -broadcast `
    -chainid $ChainId `
    -remote $Remote
  Assert-Ok "addpkg"
}

if (-not $SkipInit) {
  Write-Host "=== 2/2 Init ==="
  gnokey maketx call $KeyName `
    -pkgpath $padPath `
    -func Init `
    -gas-fee $GasFee `
    -gas-wanted $GasWantedInit `
    -broadcast `
    -chainid $ChainId `
    -remote $Remote
  Assert-Ok "Init"
}

Write-Host ""
Write-Host "OK Render: https://sapphire.testnets.gno.land/r/$Address/gnomemepad/padv2"
Write-Host "PKG=$padPath"

# Deploy prepared packages to Gno.land Sapphire testnet (sapphire-1) with gnokey.
# Interactive password only — never stores secrets.
# Uses key "mykey" by default (g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl).
param(
  [string]$KeyName = "mykey",
  [string]$Address = "g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  # max-deposit = CAP on storage lock (chain takes only what it needs)
  [string]$MaxDepositMath = "50000000ugnot",
  [string]$MaxDepositPad = "100000000ugnot",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedMath = 50000000,
  [int]$GasWantedPad = 100000000,
  [int]$GasWantedInit = 30000000,
  [switch]$SkipInit
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"

& "$PSScriptRoot\prepare-sapphire-deploy.ps1" -Address $Address

$mathDir = Join-Path $ROOT "deploy\sapphire\p\$Address\gnomemepad\ammmath"
$padDir = Join-Path $ROOT "deploy\sapphire\r\$Address\gnomemepad\pad"
$mathPath = "gno.land/p/$Address/gnomemepad/ammmath"
$padPath = "gno.land/r/$Address/gnomemepad/pad"

Write-Host ""
Write-Host "=== Sapphire deploy ==="
Write-Host "Deployer key: $KeyName"
Write-Host "Address:      $Address"
Write-Host "Remote:       $Remote"
Write-Host "Chain:        $ChainId"
Write-Host "You will be prompted for the key password by gnokey (3 steps)."
Write-Host ""

# Balance check
Write-Host "--- balance ---"
gnokey query bank/balances/$Address -remote $Remote
Write-Host ""

Write-Host "=== 1/3 addpkg ammmath (pure) ==="
gnokey maketx addpkg $KeyName `
  -pkgpath $mathPath `
  -pkgdir $mathDir `
  -max-deposit $MaxDepositMath `
  -gas-fee $GasFee `
  -gas-wanted $GasWantedMath `
  -broadcast `
  -chainid $ChainId `
  -remote $Remote
if ($LASTEXITCODE -ne 0) { throw "ammmath deploy failed (exit $LASTEXITCODE)" }

Write-Host "=== 2/3 addpkg pad (realm) ==="
gnokey maketx addpkg $KeyName `
  -pkgpath $padPath `
  -pkgdir $padDir `
  -max-deposit $MaxDepositPad `
  -gas-fee $GasFee `
  -gas-wanted $GasWantedPad `
  -broadcast `
  -chainid $ChainId `
  -remote $Remote
if ($LASTEXITCODE -ne 0) { throw "pad deploy failed (exit $LASTEXITCODE)" }

if (-not $SkipInit) {
  Write-Host "=== 3/3 Init() (caller = protocol treasury) ==="
  gnokey maketx call $KeyName `
    -pkgpath $padPath `
    -func Init `
    -gas-fee $GasFee `
    -gas-wanted $GasWantedInit `
    -broadcast `
    -chainid $ChainId `
    -remote $Remote
  if ($LASTEXITCODE -ne 0) { throw "Init failed (exit $LASTEXITCODE)" }
}

Write-Host ""
Write-Host "Done."
Write-Host "Render: https://sapphire.testnets.gno.land/r/$Address/gnomemepad/pad"
Write-Host "Pkg:    $padPath"
Write-Host ""
Write-Host "Start UI against Sapphire:"
Write-Host "  cd web"
Write-Host "  `$env:RPC_URL = `"$Remote`""
Write-Host "  `$env:CHAIN_ID = `"$ChainId`""
Write-Host "  `$env:PKG = `"$padPath`""
Write-Host "  `$env:GNOKEY_NAME = `"$KeyName`""
Write-Host "  `$env:SIGNER_ADDR = `"$Address`""
Write-Host "  node server.mjs"

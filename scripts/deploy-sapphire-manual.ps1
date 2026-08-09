# Manual 3-step Sapphire deploy. gnokey prompts for password each step (no *).
# Use this if deploy-sapphire.ps1 still fails on your shell.
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"
Set-Location $ROOT

& "$PSScriptRoot\prepare-sapphire-deploy.ps1" -Address $Address

$mathDir = Join-Path $ROOT "deploy\sapphire\p\$Address\gnomemepad\ammmath"
$padDir = Join-Path $ROOT "deploy\sapphire\r\$Address\gnomemepad\pad"
$mathPath = "gno.land/p/$Address/gnomemepad/ammmath"
$padPath = "gno.land/r/$Address/gnomemepad/pad"

Write-Host "Balance:"
gnokey query bank/balances/$Address -remote $Remote
Write-Host ""
Write-Host "Step 1/3 ammmath - type password when asked (no characters shown), then Enter"
gnokey maketx addpkg $KeyName -pkgpath $mathPath -pkgdir $mathDir -max-deposit "50000000ugnot" -gas-fee "1000000ugnot" -gas-wanted 50000000 -broadcast -chainid $ChainId -remote $Remote
if ($LASTEXITCODE -ne 0) { throw "step 1 failed" }

Write-Host "Step 2/3 pad realm"
gnokey maketx addpkg $KeyName -pkgpath $padPath -pkgdir $padDir -max-deposit "100000000ugnot" -gas-fee "1000000ugnot" -gas-wanted 100000000 -broadcast -chainid $ChainId -remote $Remote
if ($LASTEXITCODE -ne 0) { throw "step 2 failed" }

Write-Host "Step 3/3 Init"
gnokey maketx call $KeyName -pkgpath $padPath -func Init -gas-fee "1000000ugnot" -gas-wanted 30000000 -broadcast -chainid $ChainId -remote $Remote
if ($LASTEXITCODE -ne 0) { throw "step 3 failed" }

Write-Host "OK Render: https://sapphire.testnets.gno.land/r/$Address/gnomemepad/pad"

# Deploy prepared packages to Topaz using gnokey (interactive password).
# Does NOT store secrets. Uses key "mykey" by default (g16p08x…).
param(
  [string]$KeyName = "mykey",
  [string]$Address = "g16p08xxtyt320hjju7769lzguxlvzszwpg8duwl",
  [string]$Remote = "https://rpc.topaz.testnets.gno.land:443",
  [string]$ChainId = "topaz-1"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"

& "$PSScriptRoot\prepare-topaz-deploy.ps1" -Address $Address

$mathDir = Join-Path $ROOT "deploy\topaz\p\$Address\gnomemepad\ammmath"
$padDir = Join-Path $ROOT "deploy\topaz\r\$Address\gnomemepad\pad"
$mathPath = "gno.land/p/$Address/gnomemepad/ammmath"
$padPath = "gno.land/r/$Address/gnomemepad/pad"

Write-Host ""
Write-Host "Deployer key: $KeyName"
Write-Host "Remote:       $Remote"
Write-Host "Chain:        $ChainId"
Write-Host "You will be prompted for the key password by gnokey."
Write-Host ""

Write-Host "=== 1/3 addpkg ammmath ==="
gnokey maketx addpkg $KeyName `
  -pkgpath $mathPath `
  -pkgdir $mathDir `
  -max-deposit "50000000ugnot" `
  -gas-fee "1000000ugnot" `
  -gas-wanted 50000000 `
  -broadcast `
  -chainid $ChainId `
  -remote $Remote
if ($LASTEXITCODE -ne 0) { throw "ammmath deploy failed" }

Write-Host "=== 2/3 addpkg pad realm ==="
gnokey maketx addpkg $KeyName `
  -pkgpath $padPath `
  -pkgdir $padDir `
  -max-deposit "100000000ugnot" `
  -gas-fee "1000000ugnot" `
  -gas-wanted 100000000 `
  -broadcast `
  -chainid $ChainId `
  -remote $Remote
if ($LASTEXITCODE -ne 0) { throw "pad deploy failed" }

Write-Host "=== 3/3 Init() ==="
gnokey maketx call $KeyName `
  -pkgpath $padPath `
  -func Init `
  -gas-fee "1000000ugnot" `
  -gas-wanted 30000000 `
  -broadcast `
  -chainid $ChainId `
  -remote $Remote
if ($LASTEXITCODE -ne 0) { throw "Init failed" }

Write-Host ""
Write-Host "Done."
Write-Host "Render: https://topaz.testnets.gno.land/r/$Address/gnomemepad/pad"
Write-Host "Pkg:    $padPath"

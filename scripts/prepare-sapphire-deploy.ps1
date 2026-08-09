# Rebuild deploy/sapphire tree for the user's personal-address namespace.
# Target: Gno.land Sapphire testnet (chain-id sapphire-1).
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire"
$pMath = Join-Path $OUT "p\$Address\gnomemepad\ammmath"
$rPad = Join-Path $OUT "r\$Address\gnomemepad\pad"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $pMath, $rPad | Out-Null

# Pure package (no tests)
Copy-Item "$ROOT\gno.land\p\gnomemepad\ammmath\*.gno" $pMath
Get-ChildItem $pMath -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

# Realm (no tests); rewrite import path to personal namespace
Copy-Item "$ROOT\gno.land\r\gnomemepad\pad\*.gno" $rPad
Get-ChildItem $rPad -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force

Get-ChildItem $rPad -Filter "*.gno" | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $c = $c -replace 'gno\.land/p/gnomemepad/ammmath', "gno.land/p/$Address/gnomemepad/ammmath"
  [System.IO.File]::WriteAllText($_.FullName, $c)
}

# UTF-8 no BOM for gnomod.toml
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText(
  (Join-Path $pMath "gnomod.toml"),
  "module = `"gno.land/p/$Address/gnomemepad/ammmath`"`ngno = `"0.9`"`n",
  $utf8
)
[System.IO.File]::WriteAllText(
  (Join-Path $rPad "gnomod.toml"),
  "module = `"gno.land/r/$Address/gnomemepad/pad`"`ngno = `"0.9`"`n",
  $utf8
)

Write-Host "Prepared for Sapphire (sapphire-1):"
Write-Host "  gno.land/p/$Address/gnomemepad/ammmath"
Write-Host "  gno.land/r/$Address/gnomemepad/pad"
Write-Host "Dir: $OUT"

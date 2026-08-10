# Prepare deploy/sapphire-meta-points: meta + points modules.
param(
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent
$OUT = Join-Path $ROOT "deploy\sapphire-meta-points"

Remove-Item $OUT -Recurse -Force -ErrorAction SilentlyContinue

function Prepare-Realm([string]$SrcName, [string]$PkgName) {
  $src = Join-Path $ROOT "gno.land\r\gnomemepad\$SrcName"
  $dst = Join-Path $OUT "r\$Address\gnomemepad\$PkgName"
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item "$src\*.gno" $dst
  Get-ChildItem $dst -Filter "*_test.gno" -ErrorAction SilentlyContinue | Remove-Item -Force
  Get-ChildItem $dst -Filter "*.gno" | ForEach-Object {
    $c = Get-Content $_.FullName -Raw
    $c = $c -replace "(?m)^package $SrcName\b", "package $PkgName"
    [System.IO.File]::WriteAllText($_.FullName, $c)
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $pkgPath = "gno.land/r/$Address/gnomemepad/$PkgName"
  [System.IO.File]::WriteAllText(
    (Join-Path $dst "gnomod.toml"),
    "module = `"$pkgPath`"`ngno = `"0.9`"`n",
    $utf8
  )
  Write-Host "  $pkgPath"
}

Write-Host "Prepared Sapphire meta + points:"
Prepare-Realm "meta" "meta"
Prepare-Realm "points" "points"
Write-Host "Dir: $OUT"

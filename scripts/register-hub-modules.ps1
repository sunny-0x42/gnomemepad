# Finish hub module registration only (after hub+profile already addpkg+Init).
# Fixes the PowerShell splat bug that sent only 1 arg to SetModule.
param(
  [string]$KeyName = "deploykey",
  [string]$Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1",
  [string]$GasFee = "1000000ugnot",
  [int]$GasWantedCall = 30000000,
  [string]$PadPath = "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv4"
)

$ErrorActionPreference = "Stop"
$env:PATH = "C:\Users\Hi\tools;$env:PATH"

$hubPath = "gno.land/r/$Address/gnomemepad/hub"
$profPath = "gno.land/r/$Address/gnomemepad/profile"
$legacyPad = "gno.land/r/$Address/gnomemepad/padv3"

function Run-Call([string]$Func, [string[]]$FuncArgs, [string]$Label) {
  Write-Host "=== $Label ==="
  Write-Host "    $($FuncArgs -join ' | ')"
  $list = [System.Collections.Generic.List[string]]::new()
  $list.AddRange([string[]]@(
    "maketx", "call", $KeyName,
    "-pkgpath", $hubPath,
    "-func", $Func,
    "-gas-fee", $GasFee,
    "-gas-wanted", "$GasWantedCall",
    "-broadcast",
    "-chainid", $ChainId,
    "-remote", $Remote
  ))
  foreach ($a in $FuncArgs) {
    $list.Add("-args"); $list.Add($a)
  }
  if ($env:GNOKEY_PASS) {
    $env:GNOKEY_PASS | & gnokey @($list.ToArray()) -insecure-password-stdin
  } else {
    Write-Host "Enter password for '$KeyName' (hidden)..."
    & gnokey @($list.ToArray())
  }
  if ($LASTEXITCODE -ne 0) { throw "Failed: $Label" }
}

Run-Call "SetModule" @("pad", $PadPath) "SetModule pad"
Run-Call "SetModule" @("profile", $profPath) "SetModule profile"
Run-Call "SetModule" @("legacy_padv3", $legacyPad) "SetModule legacy_padv3"

Write-Host ""
Write-Host "--- ListModules ---"
gnokey query vm/qeval --data "${hubPath}.ListModules()" -remote $Remote
Write-Host "Done."

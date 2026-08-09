# Test whether you know the password for a gnokey entry (no broadcast).
param(
  [string]$KeyName = "deploykey",
  [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
  [string]$ChainId = "sapphire-1"
)

$ErrorActionPreference = "Continue"
$env:PATH = "C:\Program Files\nodejs;$env:USERPROFILE\go\bin;C:\Users\Hi\tools;$env:PATH"

Write-Host "Keys:"
gnokey list
Write-Host ""
Write-Host "Testing sign for key: $KeyName"
Write-Host "When prompted, type that key's password (nothing shown), then Enter."
Write-Host ""

# Self-send 1 ugnot simulate-only: needs valid password to sign, no chain effect if simulate only works
gnokey maketx send $KeyName g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr 1ugnot `
  -gas-fee 1000000ugnot `
  -gas-wanted 2000000 `
  -broadcast `
  -chainid $ChainId `
  -remote $Remote `
  -simulate only

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "OK: password for '$KeyName' is CORRECT."
} else {
  Write-Host ""
  Write-Host "FAIL: password for '$KeyName' is WRONG (invalid account password)."
  Write-Host "Fix options:"
  Write-Host "  1) Try again with the password you set when creating $KeyName"
  Write-Host "  2) Recover with mnemonic: gnokey add ${KeyName}2 --recover"
  Write-Host "  3) Use another key you know (e.g. mykey-new) for deploy"
}

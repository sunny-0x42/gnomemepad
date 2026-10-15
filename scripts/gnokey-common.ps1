# Shared gnokey helpers for Sapphire deploys.
# Always defaults to the historical deployer key: deploykey @ g1mv0052...
#
# Password sources (first wins):
#   1) $env:GNOKEY_PASS
#   2) repo .env.deploy  (GNOKEY_PASS=...  - gitignored)
#   3) interactive prompt (optional)

$script:GnoDeployDefaults = @{
  KeyName = "deploykey"
  Address = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
  Remote  = "https://rpc.sapphire.testnets.gno.land:443"
  ChainId = "sapphire-1"
  Home    = Join-Path $env:USERPROFILE "AppData\Roaming\gno"
}

function Initialize-GnokeyPath {
  $env:PATH = "C:\Users\Hi\tools;$env:USERPROFILE\go\bin;$env:PATH"
  if (-not (Get-Command gnokey -ErrorAction SilentlyContinue)) {
    throw "gnokey not found. Expected under C:\Users\Hi\tools or PATH."
  }
}

function Import-DotEnvDeploy {
  param([string]$Root)
  $path = Join-Path $Root ".env.deploy"
  if (-not (Test-Path $path)) { return }
  Get-Content $path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $k = $Matches[1]
      $v = $Matches[2].Trim()
      # strip optional single/double quotes
      if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
        $v = $v.Substring(1, $v.Length - 2)
      }
      [Environment]::SetEnvironmentVariable($k, $v, "Process")
    }
  }
  Write-Host "Loaded secrets from .env.deploy (process env only)." -ForegroundColor DarkGray
}

function Get-DeployKeyConfig {
  param(
    [string]$KeyName = "",
    [string]$Address = ""
  )
  $name = if ($KeyName) { $KeyName } elseif ($env:GNOKEY_NAME) { $env:GNOKEY_NAME } else { $script:GnoDeployDefaults.KeyName }
  $addr = if ($Address) { $Address } elseif ($env:GNOKEY_ADDR) { $env:GNOKEY_ADDR } else { $script:GnoDeployDefaults.Address }
  return @{ KeyName = $name; Address = $addr }
}

function Assert-DeployKeyExists {
  param(
    [Parameter(Mandatory = $true)][string]$KeyName,
    [Parameter(Mandatory = $true)][string]$ExpectedAddress
  )
  Initialize-GnokeyPath
  $list = & gnokey list 2>&1 | Out-String
  if ($list -notmatch [regex]::Escape($KeyName)) {
    throw @"
Key '$KeyName' not found in gnokey keyring.
Run: gnokey list
Recover if needed:
  gnokey add $KeyName --recover
Expected address: $ExpectedAddress
"@
  }
  if ($list -notmatch [regex]::Escape($ExpectedAddress)) {
    Write-Host "WARN: keyring list does not show expected address $ExpectedAddress next to keys." -ForegroundColor Yellow
    Write-Host "Confirm '$KeyName' is the Sapphire deployer (g1mv0052...)." -ForegroundColor Yellow
  } else {
    Write-Host "Using gnokey key '$KeyName' (expect $ExpectedAddress)" -ForegroundColor Green
  }
}

function Get-GnokeyPassword {
  param([switch]$PromptIfMissing)
  if ($env:GNOKEY_PASS -and [string]$env:GNOKEY_PASS -ne "") {
    return [string]$env:GNOKEY_PASS
  }
  if ($PromptIfMissing) {
    $secure = Read-Host "Password for gnokey deploykey" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    } finally {
      [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR) | Out-Null
    }
  }
  return $null
}

function Invoke-Gnokey {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args,
    [string]$StepName = "gnokey",
    [string]$Password = ""
  )
  Initialize-GnokeyPath
  Write-Host ">> $StepName" -ForegroundColor DarkCyan

  $pass = $Password
  if (-not $pass) { $pass = Get-GnokeyPassword }

  if ($pass) {
    $exe = (Get-Command gnokey).Source
    $argList = [System.Collections.Generic.List[string]]::new()
    foreach ($a in $Args) { [void]$argList.Add([string]$a) }
    if ($argList -notcontains "-insecure-password-stdin") {
      [void]$argList.Add("-insecure-password-stdin")
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    # ProcessStartInfo.ArgumentList is PS7+; build quoted command line for WinPS 5.1
    $psi.Arguments = ($argList | ForEach-Object {
      $a = $_
      if ($a -match '[\s"]') { '"{0}"' -f ($a -replace '"', '\"') } else { $a }
    }) -join " "
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()
    # gnokey reads one line password
    $p.StandardInput.Write($pass)
    if (-not $pass.EndsWith("`n")) { $p.StandardInput.Write("`n") }
    $p.StandardInput.Close()
    $stdout = $p.StandardOutput.ReadToEnd()
    $stderr = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    if ($stdout) { Write-Host $stdout }
    if ($stderr) { Write-Host $stderr }
    if ($p.ExitCode -ne 0) {
      if (("$stdout`n$stderr") -match "invalid account password") {
        throw "Failed: $StepName - invalid password for key (GNOKEY_PASS wrong for deploykey)."
      }
      throw "Failed: $StepName (exit $($p.ExitCode))"
    }
  } else {
    Write-Host "No GNOKEY_PASS - gnokey will prompt interactively." -ForegroundColor Yellow
    & gnokey @Args
    if ($LASTEXITCODE -ne 0) { throw "Failed: $StepName" }
  }
}

function Test-GnokeyPassword {
  param(
    [Parameter(Mandatory = $true)][string]$KeyName,
    [string]$Remote = "https://rpc.sapphire.testnets.gno.land:443",
    [string]$ChainId = "sapphire-1",
    [string]$SelfAddress = "g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr"
  )
  $pass = Get-GnokeyPassword -PromptIfMissing
  if (-not $pass) { throw "GNOKEY_PASS required to test password" }
  try {
    # gnokey maketx send [flags] <key-name>  - amount via -send, dest via -to
    Invoke-Gnokey -StepName "simulate send (password check)" -Password $pass -Args @(
      "maketx", "send",
      "-to", $SelfAddress,
      "-send", "1ugnot",
      "-gas-fee", "1000000ugnot",
      "-gas-wanted", "2000000",
      "-broadcast",
      "-chainid", $ChainId,
      "-remote", $Remote,
      "-simulate", "only",
      $KeyName
    )
    Write-Host "OK: password unlocks '$KeyName'." -ForegroundColor Green
    return $true
  } catch {
    Write-Host "FAIL: $_" -ForegroundColor Red
    return $false
  }
}

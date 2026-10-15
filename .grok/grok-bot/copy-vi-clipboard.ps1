# Copy UTF-8 Vietnamese text to the Windows Unicode clipboard.
# Windows PowerShell 5.1 Get-Content | Set-Clipboard misreads UTF-8 as ANSI.
$ErrorActionPreference = 'Stop'
$name = if ($args.Count -ge 1) { $args[0] } else { 'FORCE-VIETNAMESE.txt' }
$path = Join-Path $PSScriptRoot $name
$utf8 = New-Object System.Text.UTF8Encoding $false
$text = [System.IO.File]::ReadAllText($path, $utf8)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText($text)
$back = [System.Windows.Forms.Clipboard]::GetText()
if (-not $back.StartsWith($text.Substring(0, [Math]::Min(20, $text.Length)))) { throw 'Clipboard roundtrip mismatch.' }
Write-Output ('clipboard-ok ' + $name)

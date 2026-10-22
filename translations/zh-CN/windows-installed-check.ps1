$ErrorActionPreference = 'Stop'
$out = Join-Path $PWD 'smoke-results'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$exe = Get-ChildItem "$env:LOCALAPPDATA" -Recurse -Depth 3 -Filter 'Nexus.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { throw 'Nexus.exe not found after installation' }
$testRoot = Join-Path $env:RUNNER_TEMP 'nexus-zh-smoke'
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $testRoot 'webview'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
$env:APPDATA = Join-Path $testRoot 'roaming'
New-Item -ItemType Directory -Force -Path $env:APPDATA | Out-Null
$started = Get-Date
$p = Start-Process -FilePath $exe.FullName -PassThru -RedirectStandardOutput "$out/stdout.txt" -RedirectStandardError "$out/stderr.txt"
try {
  node translations/zh-CN/windows-smoke.mjs $out
  $checkExit = $LASTEXITCODE
  $p.Refresh()
  if ($p.HasExited) { throw "App exited during startup: $($p.ExitCode)" }
  if ($checkExit -ne 0) { throw 'Installed Windows UI check failed' }
} finally {
  $p.Refresh()
  @{ executable=$exe.FullName; pid=$p.Id; exited=$p.HasExited; exitCode=$(if($p.HasExited){$p.ExitCode}else{$null}) } | ConvertTo-Json | Set-Content "$out/process.json"
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'Nexus|msedgewebview2' } | Select-Object Name,ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Depth 3 | Set-Content "$out/webview-processes.json"
  try { Invoke-RestMethod 'http://127.0.0.1:9222/json/list' | ConvertTo-Json -Depth 6 | Set-Content "$out/cdp-targets.json" } catch { $_.ToString() | Set-Content "$out/cdp-error.txt" }
  Get-ChildItem $env:APPDATA,$env:LOCALAPPDATA -Recurse -Depth 4 -Filter 'nexus-diag.log' -ErrorAction SilentlyContinue | ForEach-Object { Get-Content $_.FullName | Add-Content "$out/nexus-diag.txt" }
  try { Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=$started} -ErrorAction Stop | Where-Object {$_.Message -match 'Nexus.exe'} | Select-Object TimeCreated,Id,Message | Format-List | Out-File "$out/windows-events.txt" } catch { }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap=New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height
    $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bounds.Size)
    $bitmap.Save("$out/desktop.png")
    $graphics.Dispose(); $bitmap.Dispose()
  } catch { $_.ToString() | Set-Content "$out/screenshot-error.txt" }
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
}

# Cubicle en Windows (PowerShell). Mismos comandos que `cubicle` en macOS/Linux.
#   .\cubicle.ps1 install    arranque automático al iniciar sesión (Tarea programada)
#   .\cubicle.ps1 start      arranca en segundo plano
#   .\cubicle.ps1 stop | restart | status | logs | open | uninstall
param([Parameter(Position = 0)][string]$Cmd = "help")
$ErrorActionPreference = "Stop"
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = if ($env:OFICINA_PORT) { $env:OFICINA_PORT } else { "3100" }
$Extra = if ($env:OFICINA_ARGS) { $env:OFICINA_ARGS } else { "" }
$PA = Join-Path $HOME ".pixel-agents"
$Log = Join-Path $PA "cubicle.log"
$PidFile = Join-Path $PA "cubicle.pid"
$Task = "Cubicle"
New-Item -ItemType Directory -Force -Path $PA | Out-Null
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Write-Host "Falta Node.js (20+)."; exit 1 }
function Url { $t = if (Test-Path (Join-Path $PA "standalone-token")) { (Get-Content (Join-Path $PA "standalone-token") -Raw).Trim() } else { "" }; if ($t) { "http://127.0.0.1:$Port/?token=$t" } else { "http://127.0.0.1:$Port/" } }
function Running { try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/"; $true } catch { $false } }
function Procs { Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*dist\cli.js*--port $Port*" } }
function StartBg {
  $args = "`"$Dir\pixel-agents-src\dist\cli.js`" --port $Port --relaunch $Extra"
  $p = Start-Process -FilePath $Node -ArgumentList $args -WorkingDirectory $Dir -WindowStyle Hidden -RedirectStandardOutput $Log -RedirectStandardError (Join-Path $PA "cubicle.err.log") -PassThru
  Set-Content -Path $PidFile -Value $p.Id
}
function StopAll { Procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Remove-Item -Force -ErrorAction SilentlyContinue $PidFile }
function Installed { $null -ne (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) }
switch ($Cmd) {
  "install" {
    StopAll
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Dir\cubicle.ps1`" start" -WorkingDirectory $Dir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
    Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    StartBg; Start-Sleep 3
    Write-Host "Instalado: la oficina arranca sola al iniciar sesión."; Write-Host ("URL: " + (Url))
  }
  "uninstall" { if (Installed) { Unregister-ScheduledTask -TaskName $Task -Confirm:$false; Write-Host "Quitado el arranque automático." } else { Write-Host "No estaba instalado." } }
  "start" { if (Running) { Write-Host ("Ya está corriendo: " + (Url)) } else { StartBg; Start-Sleep 3; Write-Host ("URL: " + (Url)) } }
  "stop" { StopAll; Write-Host "Parada." }
  "restart" { StopAll; Start-Sleep 1; StartBg; Start-Sleep 3; Write-Host ("Reiniciada: " + (Url)) }
  "status" { if (Running) { Write-Host ("Corriendo en " + (Url)) } else { Write-Host "Parada." }; if (Installed) { Write-Host "Arranque automático: instalado (Tarea programada 'Cubicle')" } else { Write-Host "Arranque automático: no instalado (cubicle install)" } }
  "logs" { if (-not (Test-Path $Log)) { New-Item $Log -ItemType File | Out-Null }; Get-Content $Log -Tail 50 -Wait }
  "open" { if (Running) { Start-Process (Url) } else { Write-Host "No está corriendo (cubicle start)."; exit 1 } }
  default { Get-Content $MyInvocation.MyCommand.Path | Select-Object -Skip 1 -First 3 }
}

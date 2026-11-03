# Instalación en Windows (PowerShell): dependencias, compilación, comando `cubicle` y statusline.
#   git clone https://github.com/YeisonGomez/cubicle.git cubicle; cd cubicle; .\install.ps1; .\cubicle.ps1 install
# Requisitos: Git, Node.js 20+, Python 3 (python en el PATH) y Claude Code.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
function Falta($que, $como) { Write-Host "Falta $que. $como"; exit 1 }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Falta "git" "https://git-scm.com" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Falta "Node.js (20+)" "https://nodejs.org" }
$major = [int]((node -p "process.versions.node.split('.')[0]"))
if ($major -lt 20) { Falta "Node.js 20 o superior (tienes $(node -v))" "Actualiza Node" }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Falta "Python 3 (python en el PATH)" "https://python.org (marca 'Add to PATH')" }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Host "Aviso: no encuentro 'claude' (Claude Code) en el PATH; la oficina lo necesita para abrir terminales." }
Write-Host "→ Instalando dependencias y compilando (una sola vez)…"
Push-Location pixel-agents-src
npm install --no-audit --no-fund | Out-Null
npm run build:webview | Out-Null
node esbuild.js | Out-Null
Pop-Location
New-Item -ItemType Directory -Force -Path (Join-Path $HOME ".pixel-agents\oficina") | Out-Null
# Statusline: guarda el uso de la cuenta (sesión/semana) para que la oficina lo muestre.
$sl = Join-Path $HOME ".claude\statusline-command.ps1"
if (-not (Test-Path $sl)) {
  New-Item -ItemType Directory -Force -Path (Join-Path $HOME ".claude") | Out-Null
  Copy-Item examples\statusline-command.ps1 $sl
  $settingsPath = Join-Path $HOME ".claude\settings.json"
  $s = if (Test-Path $settingsPath) { Get-Content $settingsPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
  if (-not $s.statusLine) { $s | Add-Member -NotePropertyName statusLine -NotePropertyValue ([pscustomobject]@{ type = "command"; command = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$sl`"" }) }
  $s | ConvertTo-Json -Depth 10 | Set-Content $settingsPath -Encoding UTF8
  Write-Host "→ Statusline instalada (muestra el modelo; guarda el uso de la cuenta para la oficina)."
} else { Write-Host "→ Ya tienes una statusline; integra examples\statusline-command.ps1 si quieres ver el uso de la cuenta." }
# Comando `cubicle`: carpeta en el PATH del usuario con cubicle.cmd.
$bin = Join-Path $HOME ".local\bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Copy-Item cubicle.cmd (Join-Path $bin "cubicle.cmd") -Force
(Get-Content (Join-Path $bin "cubicle.cmd")) -replace '%~dp0cubicle.ps1', "$PWD\cubicle.ps1" | Set-Content (Join-Path $bin "cubicle.cmd")
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$bin*") { [Environment]::SetEnvironmentVariable("Path", "$userPath;$bin", "User"); Write-Host "→ Añadido $bin al PATH del usuario (abre una terminal nueva)." }
Write-Host ""
Write-Host "Listo. Arranca con:  cubicle install   (queda en segundo plano y arranca sola al iniciar sesión)"
Write-Host "                o:   cubicle start     ·  cubicle open abre la oficina"

# Statusline de Claude Code para Cubicle (Windows / PowerShell): muestra el modelo y guarda los
# límites de uso de la cuenta (sesión de 5 h y semana) en ~/.pixel-agents/usage.json.
$raw = [Console]::In.ReadToEnd()
try { $j = $raw | ConvertFrom-Json } catch { exit 0 }
$dir = Join-Path $HOME ".pixel-agents"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$rl = $j.rate_limits
if ($rl -and ($rl.five_hour -or $rl.seven_day)) {
  $out = @{ five_hour = $rl.five_hour; seven_day = $rl.seven_day; rate_limits = $rl; model = $j.model.display_name; modelId = $j.model.id; cost = $j.cost; context_window = $j.context_window; version = $j.version; updatedAt = [int][double]::Parse((Get-Date -UFormat %s)) }
  $tmp = Join-Path $dir "usage.json.tmp"
  $out | ConvertTo-Json -Compress -Depth 5 | Set-Content -Path $tmp -Encoding UTF8
  Move-Item -Force $tmp (Join-Path $dir "usage.json")
}
if ($j.model.display_name) { Write-Output ("🤖 " + $j.model.display_name) }

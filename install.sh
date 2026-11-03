#!/bin/zsh
# Instalación en un paso: dependencias, compilación y statusline opcional.
#   git clone <repo> oficina && cd oficina && ./install.sh && ./cubicle-start.sh
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Falta Node.js (20+). Instálalo y vuelve a correr ./install.sh"; exit 1; }
command -v python3 >/dev/null || { echo "Falta python3."; exit 1; }
command -v claude >/dev/null || echo "Aviso: no encuentro 'claude' (Claude Code) en el PATH; la oficina lo necesita para lanzar agentes."
[ -s ~/.nvm/nvm.sh ] && source ~/.nvm/nvm.sh && nvm use 24 >/dev/null 2>&1 || true
echo "→ Instalando dependencias y compilando (una sola vez)…"
(cd pixel-agents-src && npm install --no-audit --no-fund >/dev/null && npm run build:webview >/dev/null 2>&1 && node esbuild.js >/dev/null)
mkdir -p ~/.pixel-agents/oficina
# Statusline: Claude Code solo entrega los límites de uso (sesión/semana) a la statusline;
# este script los guarda en ~/.pixel-agents/usage.json para que la oficina los muestre.
if [ ! -f ~/.claude/statusline-command.sh ]; then
  mkdir -p ~/.claude && cp examples/statusline-command.sh ~/.claude/statusline-command.sh && chmod +x ~/.claude/statusline-command.sh
  python3 - <<'PY'
import json, os
p = os.path.expanduser('~/.claude/settings.json')
s = json.load(open(p)) if os.path.exists(p) else {}
s.setdefault('statusLine', {'type': 'command', 'command': 'bash ~/.claude/statusline-command.sh'})
json.dump(s, open(p, 'w'), indent=2)
PY
  echo "→ Statusline instalada (muestra carpeta, rama y modelo; guarda el uso de la cuenta para la oficina)."
else
  echo "→ Ya tienes una statusline; para ver el uso de la cuenta en la oficina integra el bloque 'Oficina' de examples/statusline-command.sh."
fi
echo
echo "Listo. Arranca con:  ./cubicle-start.sh   (imprime la URL con el token)"

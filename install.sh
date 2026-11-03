#!/usr/bin/env bash
# Instalación en un paso (macOS y Linux): dependencias, compilación, comando `cubicle` y statusline.
#   git clone https://github.com/YeisonGomez/cubicle.git cubicle && cd cubicle && ./install.sh && cubicle install
# Windows: usa install.ps1 (PowerShell) o este script dentro de WSL.
set -e
cd "$(dirname "$0")"
falta() { echo "Falta $1. $2"; exit 1; }
command -v git >/dev/null || falta "git" "Instálalo y vuelve a correr ./install.sh"
[ -s "$HOME/.nvm/nvm.sh" ] && { . "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null 2>&1 || true; }
command -v node >/dev/null || falta "Node.js (20+)" "https://nodejs.org o nvm; luego ./install.sh"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || falta "Node.js 20 o superior (tienes $(node -v))" "Actualiza Node y vuelve a correr ./install.sh"
command -v python3 >/dev/null || falta "python3" "macOS: xcode-select --install · Debian/Ubuntu: sudo apt install python3"
command -v claude >/dev/null || echo "Aviso: no encuentro 'claude' (Claude Code) en el PATH; la oficina lo necesita para abrir terminales."
command -v jq >/dev/null || echo "Aviso: falta 'jq' (lo usa la statusline para guardar el uso de la cuenta). macOS: brew install jq · Debian/Ubuntu: sudo apt install jq"
echo "→ Instalando dependencias y compilando (una sola vez)…"
(cd pixel-agents-src && npm install --no-audit --no-fund >/dev/null && npm run build:webview >/dev/null 2>&1 && node esbuild.js >/dev/null)
mkdir -p "$HOME/.pixel-agents/oficina"
# Statusline: Claude Code solo entrega los límites de uso (sesión/semana) a la statusline;
# este script los guarda en ~/.pixel-agents/usage.json para que la oficina los muestre.
if [ ! -f "$HOME/.claude/statusline-command.sh" ]; then
  mkdir -p "$HOME/.claude" && cp examples/statusline-command.sh "$HOME/.claude/statusline-command.sh" && chmod +x "$HOME/.claude/statusline-command.sh"
  python3 - <<'PY'
import json, os
p = os.path.expanduser('~/.claude/settings.json')
s = json.load(open(p)) if os.path.exists(p) else {}
s.setdefault('statusLine', {'type': 'command', 'command': 'bash ~/.claude/statusline-command.sh'})
json.dump(s, open(p, 'w'), indent=2)
PY
  echo "→ Statusline instalada (muestra el modelo; guarda el uso de la cuenta para la oficina)."
else
  echo "→ Ya tienes una statusline; para ver el uso de la cuenta en la oficina integra el bloque 'Oficina' de examples/statusline-command.sh."
fi
# Comando `cubicle` en el PATH (arranque en segundo plano, sin terminal abierta).
BIN=""; for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do [ -d "$d" ] && [ -w "$d" ] && { BIN="$d"; break; }; done
if [ -z "$BIN" ]; then mkdir -p "$HOME/.local/bin" && BIN="$HOME/.local/bin"; fi
ln -sf "$PWD/cubicle" "$BIN/cubicle" && echo "→ Comando 'cubicle' instalado en $BIN."
case ":$PATH:" in *":$BIN:"*) ;; *) echo "   Añade $BIN a tu PATH (p. ej. en ~/.bashrc o ~/.zshrc: export PATH=\"$BIN:\$PATH\") o usa ./cubicle desde esta carpeta.";; esac
echo
echo "Listo. Arranca con:  cubicle install   (queda en segundo plano y arranca sola al iniciar sesión)"
echo "                o:   cubicle start     (en esta terminal)   ·  cubicle open abre la oficina"

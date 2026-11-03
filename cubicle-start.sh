#!/usr/bin/env bash
# Arranca la oficina en primer plano (puerto 3100) y reanuda la última conversación de cada
# proyecto (--relaunch). Para segundo plano usa `cubicle install` / `cubicle start`.
# Correr desde una terminal normal, nunca desde dentro de una sesión de Claude.
set -e
cd "$(dirname "$0")"
[ -s "$HOME/.nvm/nvm.sh" ] && { . "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null 2>&1 || true; }
exec node pixel-agents-src/dist/cli.js --port "${OFICINA_PORT:-3100}" --relaunch "$@"

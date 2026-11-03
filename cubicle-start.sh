#!/bin/zsh
# Arranca la oficina (nuestra copia modificada de Pixel Agents) en el puerto 3100 y
# reanuda la última conversación de cada proyecto (--relaunch).
# Correr desde una terminal normal, nunca desde dentro de una sesión de Claude.
set -e
cd "$(dirname "$0")"
[ -s ~/.nvm/nvm.sh ] && source ~/.nvm/nvm.sh && nvm use 24 >/dev/null 2>&1 || true
exec node pixel-agents-src/dist/cli.js --port "${OFICINA_PORT:-3100}" --relaunch "$@"

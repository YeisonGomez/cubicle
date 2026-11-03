#!/bin/zsh
# Recompila webview + servidor del fork (tras editar código en pixel-agents-src).
set -e
cd "$(dirname "$0")/pixel-agents-src"
[ -s ~/.nvm/nvm.sh ] && source ~/.nvm/nvm.sh && nvm use 24 >/dev/null 2>&1 || true
[ -d node_modules ] || npm install
(cd webview-ui && npx tsc -b && npx vite build 2>&1 | tail -2)
node esbuild.js 2>&1 | tail -1
echo "listo: dist/cli.js + dist/webview. Reinicia Cubicle (cubicle-start.sh) para aplicar cambios de servidor;"
echo "los cambios solo de webview se ven con recargar la pestaña."

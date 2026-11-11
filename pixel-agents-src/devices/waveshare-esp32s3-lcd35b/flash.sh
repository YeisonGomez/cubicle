#!/usr/bin/env bash
# Compila y carga Cubicle Screen en la Waveshare ESP32-S3-Touch-LCD-3.5B conectada por USB
# y le guarda servidor, puerto y clave (los de esta máquina).
#   ./flash.sh            compilar + cargar + configurar
#   ./flash.sh config     solo configurar (sin volver a cargar el programa)
#   ./flash.sh ota        cargar por Wi-Fi (sin cable de datos; la placa debe estar encendida)
# Requisitos: arduino-cli con el core esp32:esp32 3.2.0 y las librerías del README.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SKETCH="$HERE/cubicle_screen"
FQBN="esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=cdc,FlashMode=qio"
OFICINA="${OFICINA_DIR:-$HOME/.pixel-agents/oficina}"
CFG="$OFICINA/dispositivo.json"

port() {
  local p
  p="$(ls /dev/cu.usbmodem* 2>/dev/null | head -1 || true)"
  if [[ -z "$p" ]]; then
    echo "No encuentro la pantalla por USB (/dev/cu.usbmodem*). Conéctala con un cable de datos." >&2
    exit 1
  fi
  echo "$p"
}

# Activa la pantalla externa en Cubicle (genera la clave al arrancar el servidor si falta).
if [[ ! -f "$CFG" ]] || ! grep -q '"key"' "$CFG"; then
  mkdir -p "$OFICINA"
  python3 - "$CFG" <<'PY'
import json, os, secrets, sys
p = sys.argv[1]
try:
    c = json.load(open(p))
except Exception:
    c = {}
c["enabled"] = True
c.setdefault("port", 3101)
c.setdefault("key", secrets.token_hex(16))
json.dump(c, open(p, "w"), indent=2)
os.chmod(p, 0o600)
PY
  echo "Pantalla externa activada en $CFG (reinicia Cubicle: cubicle restart)."
fi

if [[ "${1:-}" == "ota" ]]; then
  KEY="$(python3 -c "import json;print(json.load(open('$CFG'))['key'])")"
  BUILD="$(mktemp -d)"
  arduino-cli compile --fqbn "$FQBN" --output-dir "$BUILD" "$SKETCH"
  ESPOTA="$(ls -d "$HOME"/Library/Arduino15/packages/esp32/hardware/esp32/*/tools/espota.py "$HOME"/.arduino15/packages/esp32/hardware/esp32/*/tools/espota.py 2>/dev/null | tail -1)"
  TARGET="${OTA_HOST:-cubicle-pantalla.local}"
  python3 "$ESPOTA" -i "$TARGET" -a "$KEY" -f "$BUILD/cubicle_screen.ino.bin" -r
  rm -rf "$BUILD"
  echo "Pantalla actualizada por Wi-Fi ($TARGET)."
  exit 0
fi

if [[ "${1:-}" != "config" ]]; then
  P="$(port)"
  arduino-cli compile --fqbn "$FQBN" "$SKETCH"
  arduino-cli upload --fqbn "$FQBN" -p "$P" "$SKETCH"
  sleep 4  # la placa se reinicia y vuelve a crear el puerto
fi

P="$(port)"
HOST="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
# IP de respaldo: la de la interfaz de la ruta por defecto (Wi-Fi o cable).
IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
IP="$(ipconfig getifaddr "${IFACE:-en0}" 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
LINE="$(python3 - "$CFG" "$HOST" "$IP" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))
print("CFG " + json.dumps({"host": sys.argv[2], "ip": sys.argv[3], "port": c.get("port", 3101), "key": c["key"]}))
PY
)"
stty -f "$P" 115200 2>/dev/null || stty -F "$P" 115200
exec 3<>"$P"
printf '%s\n' "$LINE" >&3
REPLY=""
read -r -t 5 REPLY <&3 || true
exec 3>&-
if [[ "$REPLY" == OK* ]]; then
  echo "Pantalla configurada: servidor $HOST (respaldo ${IP:-sin IP}), puerto $(python3 -c "import json;print(json.load(open('$CFG')).get('port',3101))")."
else
  echo "La pantalla no confirmó la configuración (respuesta: '${REPLY:-nada}'). Vuelve a ejecutar: ./flash.sh config" >&2
  exit 1
fi

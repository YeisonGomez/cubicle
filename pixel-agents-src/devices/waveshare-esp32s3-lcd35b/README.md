# Cubicle Screen — Waveshare ESP32-S3-Touch-LCD-3.5B

Tus agentes de Cubicle en una pantalla táctil por Wi-Fi, en una cuadrícula de 4x2 por diapositiva: el Pokémon animado, el nombre, el color de su sala y el estado (Trabajando, Te necesita, Libre). Al tocar uno, Cubicle lo abre en el computador (panel del agente, su terminal y el navegador al frente en macOS).

## Cómo funciona

- Cubicle abre un servidor HTTP **aparte** en la red local (puerto 3101), solo con dos rutas y una clave propia (`X-Cubicle-Key`). El servidor de la oficina, que lleva la terminal, sigue escuchando solo en `127.0.0.1`. Está apagado hasta que `~/.pixel-agents/oficina/dispositivo.json` tenga `"enabled": true` (lo crea `flash.sh`).
  - `GET /device/agents` → `{ agents: [{ id, name, room, color, status: working|permission|idle, pokemon? }] }`
  - `GET /device/sprite/:id` → el GIF del Pokémon ya compuesto en RGB565 (solo en memoria).
  - `GET /device/summary` → hora, idioma, prompts de hoy y consumo de la semana y de Fable.
  - `POST /device/open {"id": n}` → la oficina abre ese agente.
- La pantalla consulta cada 2 s y solo redibuja si algo cambió.

## Instalar

1. `brew install arduino-cli`, y luego:
   ```bash
   arduino-cli config init
   arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
   arduino-cli core update-index && arduino-cli core install esp32:esp32@3.2.0
   arduino-cli lib install "GFX Library for Arduino@1.6.0" "TCA9554@0.1.2" "WiFiManager" "ArduinoJson" "U8g2"
   ```
2. Conecta la pantalla con un cable USB **de datos** (si el Mac no la ve, prueba otro puerto o cable: muchos solo cargan).
3. `./flash.sh` — compila, carga, activa la pantalla en Cubicle y le guarda servidor (`<tu-mac>.local` y, de respaldo, su IP actual), puerto y clave por USB.
4. `cubicle restart` (y "Permitir" si macOS pregunta por conexiones entrantes a `node`).
5. Wi-Fi: la primera vez la pantalla crea la red **Cubicle-Pantalla**; conéctate desde el móvil y elige tu Wi-Fi. La contraseña se queda en la placa.

Después basta el cable de carga: la pantalla funciona sola por Wi-Fi.

## Vistas

- **Activos** (por defecto si hay alguno): solo los agentes que te necesitan (primero, del que más lleva esperando) y los que trabajan, en grande y con cuánto llevan.
- **Todos**: la cuadrícula completa por salas. Se alterna con Activos tocando la cabecera ("Ver todos" / "Ver activos").
- **Reposo**: tras 5 min sin agentes activos ni toques: reloj, prompts de hoy y consumo de la semana y de Fable, con la luz atenuada. Un toque vuelve a Todos.
- **Aviso**: cuando un agente termina o pide permiso, pantalla completa 5 s con su Pokémon y un borde que parpadea. Tocarlo abre el agente.

Los textos salen en el idioma de la oficina (ES/EN).

## Uso

- Tocar una ficha → se abre el agente en el computador. El agente seleccionado en la oficina sale con borde morado y la pantalla pasa a su diapositiva.
- Estados: Trabajando (azul), Pide permiso y Te necesita (amarillo: terminó o pregunta y aún no lo has mirado), Libre (gris).
- Franjas con flecha a los lados (o deslizar) → diapositiva siguiente o anterior. Hasta 8 agentes por diapositiva, agrupados por sala (de la más usada a la menos en los últimos 30 días); una sala no se parte entre diapositivas si cabe en una.
- Gira sola si está claramente de pie (acelerómetro QMI8658: horizontal al derecho o al revés). Tumbada, usa el giro elegido a mano: toque corto en BOOT o `http://cubicle-pantalla.local/rotate` (se guarda).
- BOOT 3 s → olvida el Wi-Fi y vuelve a abrir el portal.
- `./flash.sh ota` → actualizar el programa por Wi-Fi (sin cable de datos; contraseña = la clave de Cubicle). `http://cubicle-pantalla.local/info` → estado y acelerómetro. Con la cabecera `X-Cubicle-Key`: `/shot` (captura de la pantalla en RGB565 crudo) y `/preview?v=rest|alert|toggle` (enseña una vista para revisarla).
- `./flash.sh config` → solo vuelve a guardar servidor y clave (p. ej. si cambias de clave).
- Por el puerto serie: `INFO` (estado), `WIFI_RESET`, `CFG {"host":"…","ip":"…","port":3101,"key":"…"}`.

## Hardware

Controlador AXS15231B (pantalla por QSPI 320x480 y táctil por I2C 0x3B, SDA 8 / SCL 7). Reset de la pantalla por el expansor TCA9554 (0x20, pin 1); luz de fondo en GPIO 6. ESP32-S3R8: 16 MB de flash, 8 MB de PSRAM octal.

## Problemas

- **Solo redes de 2,4 GHz:** la ESP32 no ve las redes de 5 GHz (a menudo las que llevan "Plus" o "5G"). Si son del mismo router, el Mac en la de 5 GHz y la pantalla en la de 2,4 GHz se ven igual.
- **"No encuentro <tu-mac>.local":** algunos routers no dejan pasar mDNS. La pantalla usa entonces la IP guardada; si la IP del Mac cambia, `./flash.sh config` la actualiza (o reserva la IP del Mac en el router).

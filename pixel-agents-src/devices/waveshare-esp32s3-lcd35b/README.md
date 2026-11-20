# Cubicle Screen — Waveshare ESP32-S3-Touch-LCD-3.5B

Tus agentes de Cubicle en una pantalla táctil por Wi-Fi, en una cuadrícula de 4x2 por diapositiva: el Pokémon animado, el nombre, el color de su sala y el estado (Trabajando, Te necesita, Libre). Al tocar uno, Cubicle lo abre en el computador (panel del agente, su terminal y el navegador al frente en macOS). Opcional: [responder a un agente por voz](#responder-a-un-agente-desde-la-pantalla-voz) desde la propia pantalla.

## Cómo funciona

- Cubicle abre un servidor HTTP **aparte** en la red local (puerto 3101), con unas pocas rutas y una clave propia (`X-Cubicle-Key`). El servidor de la oficina, que lleva la terminal, sigue escuchando solo en `127.0.0.1`. Está apagado hasta que `~/.pixel-agents/oficina/dispositivo.json` tenga `"enabled": true` (lo crea `flash.sh`).
  - `GET /device/agents` → `{ agents: [{ id, name, room, color, status: working|permission|idle, pokemon? }] }`
  - `GET /device/sprite/:id` → el GIF del Pokémon ya compuesto en RGB565 (solo en memoria).
  - `GET /device/summary` → hora, idioma, prompts de hoy y consumo de la semana y de Fable.
  - `POST /device/open {"id": n}` → la oficina abre ese agente.
  - `POST /device/evolved {"id": n, "stage": s}` → la pantalla ya mostró esa evolución.
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
- **Reposo**: cuando ningún agente trabaja ni te necesita: reloj, prompts de hoy y consumo de la semana y de Fable; tras 5 min sin toques, con la luz a la mitad. Puede llevar un fondo (ver "Fondos de reposo"): con fondo, un toque pasa a la imagen siguiente y la franja de arriba lleva a Todos; sin fondo, cualquier toque lleva a Todos.
- **Aviso**: cuando un agente termina o pide permiso, el borde de su ficha parpadea grueso 5 s; las demás fichas siguen a la vista.

- **Experiencia** (temas Pokémon y Yu-Gi-Oh): cada ficha lleva el nivel, una barra de 10 tramos y los prompts que faltan para evolucionar.
- **Evolución**: cuando un Pokémon sube lo suficiente, la pantalla lo anima a pantalla completa y, al cerrarla con un toque, el agente pasa a su forma nueva.

Los textos salen en el idioma de la oficina (ES/EN).

- **Brillo**: 30 min sin tocar la pantalla bajan la luz a un 10 %, aunque haya agentes en pantalla; a la hora queda al mínimo visible (~2 %), nunca apagada. Solo un toque reinicia la cuenta (el primero solo la despierta); un aviso o una evolución la encienden mientras duran y luego vuelve a bajar. `GET /info` muestra `bl` (brillo 0-255; 26 = 10 %), `idle` (segundos sin tocarla) y `touches`.

## Fondos de reposo

La vista de reposo puede llevar una imagen de fondo. El servidor la compone a 480x320 (la imagen desenfocada y oscurecida cubre toda la pantalla; encima, la figura a la derecha, fundida en óvalo) y la placa la baja ya lista para dibujar.

- Las imágenes salen de `~/.pixel-agents/oficina/reposo/*.png` si pones las tuyas; si no, de `scripts/reposo/<tema>/` (las que acompañan al tema de personajes activo, p. ej. `yugioh`). Detalle en `scripts/reposo/README.md`.
- Cambia sola cada 10 minutos y con un toque en la pantalla.
- Diagnóstico: `GET /preview?v=rest` (con la clave) enseña el reposo unos segundos.

## Uso

- Tocar una ficha → se abre el agente en el computador. El agente seleccionado en la oficina sale con borde morado y la pantalla pasa a su diapositiva.
- Con las sesiones en la app de Claude (Ajustes de Cubicle → "Sesiones en"), tocar una ficha abre esa conversación en la app y salen todos los agentes, también los que no están trabajando.
- Estados: Trabajando (azul), Pide permiso y Te necesita (amarillo: terminó o pregunta y aún no lo has mirado), Libre (gris).
- Franjas con flecha a los lados (o deslizar) → diapositiva siguiente o anterior. Hasta 8 agentes por diapositiva, agrupados por sala (de la más usada a la menos en los últimos 30 días); una sala no se parte entre diapositivas si cabe en una.
- Gira sola si está claramente de pie (acelerómetro QMI8658: horizontal al derecho o al revés). Tumbada, usa el giro elegido a mano: toque corto en BOOT o `http://cubicle-pantalla.local/rotate` (se guarda).
- BOOT 3 s → olvida el Wi-Fi y vuelve a abrir el portal.
- `./flash.sh ota` → actualizar el programa por Wi-Fi (sin cable de datos; contraseña = la clave de Cubicle). `http://cubicle-pantalla.local/info` → estado y acelerómetro. Con la cabecera `X-Cubicle-Key`: `/shot` (captura de la pantalla en RGB565 crudo) y `/preview?v=rest|alert|evo|toggle|detail|back` (enseña una vista o el parpadeo de aviso para revisarlos).
- `./flash.sh config` → solo vuelve a guardar servidor y clave (p. ej. si cambias de clave).
- Por el puerto serie: `INFO` (estado), `WIFI_RESET`, `CFG {"host":"…","ip":"…","port":3101,"key":"…"}`.

## Hardware

Controlador AXS15231B (pantalla por QSPI 320x480 y táctil por I2C 0x3B, SDA 8 / SCL 7). Reset de la pantalla por el expansor TCA9554 (0x20, pin 1); luz de fondo en GPIO 6. ESP32-S3R8: 16 MB de flash, 8 MB de PSRAM octal.

**Batería (opcional):** la placa trae cargador (AXP2101) y un conector **MX1.25 de 2 pines** para una batería de litio de **3,7 V y una celda** (LiPo 1S) con circuito de protección. Entre 1000 y 2000 mAh va bien por tamaño. Antes de enchufarla comprueba la **polaridad** contra las marcas `+` y `-` de la placa: el orden de los cables no es estándar entre fabricantes y al revés puede dañarla. Se carga sola por el USB.

## Problemas

- **Solo redes de 2,4 GHz:** la ESP32 no ve las redes de 5 GHz (a menudo las que llevan "Plus" o "5G"). Si son del mismo router, el Mac en la de 5 GHz y la pantalla en la de 2,4 GHz se ven igual.
- **"No encuentro <tu-mac>.local":** algunos routers no dejan pasar mDNS. La pantalla usa entonces la IP guardada; si la IP del Mac cambia, `./flash.sh config` la actualiza (o reserva la IP del Mac en el router).

## Responder a un agente desde la pantalla (voz)

Para contestar a un agente sin volver al computador: dejas pulsada su ficha, lees un resumen de lo que necesita, le dictas la respuesta y la pantalla la envía a su conversación.

**Apagado por defecto.** Solo funciona en **macOS** y con las sesiones en la **app de Claude** (Ajustes → "Sesiones en" → App de Claude).

### Activarlo

1. Instala la transcripción local y descarga un modelo (unos 465 MB):
   ```bash
   brew install whisper-cpp ffmpeg
   mkdir -p ~/.cache/cubicle-whisper
   curl -L -o ~/.cache/cubicle-whisper/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
   ```
   `ffmpeg` es opcional: limpia el zumbido del micrófono de la placa y mejora lo que entiende.
2. Comprueba que `claude` funciona en tu terminal y que tiene la sesión iniciada (`claude auth login`). El resumen se pide con él.
3. En `~/.pixel-agents/oficina/dispositivo.json` añade `"voice": true` y, si dictas en un idioma distinto al de la interfaz, tu idioma:
   ```json
   { "enabled": true, "port": 3101, "key": "…", "voice": true, "voiceLang": "es" }
   ```
4. `cubicle restart`.
5. Carga el programa actual en la placa si la tenías de antes: `./flash.sh` (USB) o `./flash.sh ota` (Wi-Fi).
6. En el primer envío macOS pide el permiso de **Accesibilidad** para Cubicle (puede aparecer como `node`): Ajustes del Sistema → Privacidad y seguridad → Accesibilidad. Apruébalo y pulsa Enviar otra vez.

### Usarlo

1. **Deja pulsada una ficha** un poco más de medio segundo: se abre la vista del agente. **Volver** regresa a las fichas; **Abrir en el computador** hace lo mismo que un toque corto.
2. En unos 5 s aparece el **resumen** de su última respuesta: qué necesita de ti y la conclusión. Si el agente sigue trabajando, lo dice y el resumen llega cuando termine.
3. **Mantén para hablar**: graba mientras tengas el dedo apoyado (hasta 20 s). Suelta al terminar.
4. La pantalla muestra lo que entendió. **Enviar** lo escribe en la conversación; **Cancelar** lo descarta y puedes dictar de nuevo.
5. Si el agente estaba a mitad de un turno, el mensaje queda en cola en la app y lo recibe al acabar ("En cola").

### Qué pasa por dentro

- **Resumen** (`GET /device/brief?id=`): Cubicle toma del transcript la última respuesta del agente y se la pasa a Claude Haiku con `claude -p`, sin herramientas y sin guardar sesión. Se genera una vez por respuesta.
- **Dictado** (`POST /device/voice`): la placa manda un WAV de 16 kHz y `whisper-cli` lo pasa a texto en tu computador. El audio no sale de tu red.
- **Envío** (`POST /device/prompt {id, text}`): la app de Claude no tiene una entrada para recibir mensajes de otros programas, así que Cubicle abre la conversación en la app, pega el texto y pulsa Enter, como harías tú. Antes de teclear comprueba que el computador no está bloqueado, que la app abrió esa conversación y que está al frente; después confirma que el mensaje llegó.

Consecuencias de enviar así: el computador debe estar **encendido y desbloqueado**, la app de Claude pasa al frente y cambia a esa conversación, y si había un texto a medio escribir en ella se reemplaza por lo dictado.

### Opciones

| Dónde | Clave | Para qué |
|---|---|---|
| `dispositivo.json` | `"voice": true` | Activa la función. |
| `dispositivo.json` | `"voiceLang": "es"` | Idioma del dictado y del resumen (dos letras). Sin ella el dictado se detecta solo y el resumen sale en el idioma de la interfaz. |
| Variable de entorno | `OFICINA_WHISPER_BIN` | Ruta de `whisper-cli` si no está en Homebrew. |
| Variable de entorno | `OFICINA_WHISPER_MODEL` | Ruta de otro modelo ggml. |

### Seguridad

Con esta opción, quien tenga la clave de la pantalla y esté en tu red local puede leer resúmenes de tus conversaciones y mandar prompts a tus agentes. La clave viaja sin cifrar por la red. Actívala solo en una red de confianza.

### Si algo falla

| Lo que ves | Causa y arreglo |
|---|---|
| Dejar pulsada una ficha no hace nada | La función no está activa: falta `"voice": true`, reiniciar Cubicle, pasar las sesiones a la app de Claude, o instalar whisper y su modelo. |
| "No hay una respuesta que resumir" | El agente aún no ha respondido en su último turno, o `claude` no pudo hacer el resumen (revisa `claude auth login`). |
| Lo que entiende no tiene sentido | El idioma no coincide: fija `"voiceLang"` con el tuyo. |
| "No te oí" | Habla a menos de medio metro y mantén el dedo apoyado mientras hablas. |
| "Falta el permiso de Accesibilidad" | Apruébalo en Ajustes del Sistema (paso 6). |
| "El computador está bloqueado" | Desbloquéalo; con la pantalla bloqueada no se puede teclear en la app. |
| "La app de Claude no abrió la conversación" | La app está cerrada o tardó en responder. Ábrela y reintenta. |
| Un agente aparece con un círculo en vez de su personaje | Su dibujo no se pudo descargar; la placa lo reintenta sola cada 30 s. |

Revisar la vista sin tocar la placa: `/preview?v=detail` (`&id=` para un agente, `&s=confirm` para la confirmación) y `/preview?v=back`.

## Micrófono (prueba)

La placa trae micrófono y códec ES8311 (I2C 0x18 en el bus de siempre; I2S: MCLK 44, BCLK 13, LRCK 15, DOUT 16, DIN 14). `GET /mic?s=N` (con `X-Cubicle-Key`, 1-8 s) graba y devuelve un WAV de 16 kHz mono; la pantalla se congela mientras graba. El driver `es8311.*` es de Espressif (Apache-2.0, con su cabecera), tomado de las demos de Waveshare.

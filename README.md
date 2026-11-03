# Cubicle · v2.0

**Un centro de mando pixel-art para todas tus sesiones de Claude Code.** Cada sesión es un personaje sentado en la sala de su proyecto; haces clic y tienes su terminal, sus cambios git, sus reportes, su actividad y lo que sabe hacer. Sin IDE, sin diez pestañas abiertas.

Construido sobre un fork de [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) de Pablo De Lucca (MIT): a él le debemos la oficina animada, los personajes, el editor de salas y la integración con los hooks y transcripts de Claude Code. Esta versión agrega todo lo que hay debajo. Interfaz en **español e inglés**.

> **English:** a pixel-art command center for your Claude Code sessions: one room per project, one character per session, with an IDE-like side panel (notes, git changes, HTML reports, activity heatmap, capabilities), an integrated terminal, account usage meters and a one-command install. Fork of Pixel Agents (MIT). UI available in English and Spanish.

![La oficina](docs/img/oficina.jpg)

## Qué cambia en tu día

| Antes | Con la oficina |
|---|---|
| Un IDE abierto por proyecto para ver qué tocó Claude | Pestaña **Cambios**: árbol estilo VS Code con diff, por repo, con la rama actual visible |
| Una pestaña del navegador por cada reporte HTML | Pestaña **Reportes**: los HTML del proyecto dentro del panel, con pantalla completa para presentar y "Nuevo reporte" que se lo pide a la sesión |
| Terminales sueltas, sin saber cuál es cuál | Un personaje por sesión en su sala; clic y aparece su terminal; estados cortos (💻 Ejecutando, ✋ Necesita permiso, ☕ Libre) |
| Abrir y cerrar sesiones a mano | **+ Agent** crea una sesión en cualquier carpeta en segundos; 🗑️ la quita; al reiniciar todo se reanuda solo |
| Sesiones abandonadas mezcladas con las activas | Las que llevan dos semanas sin prompt se van al **sofá** y salen de la barra; vuelven al escribirles |
| ¿Cuánto llevo usado de mi cuenta? ¿En qué proyecto? | Medidor de **sesión y semana** arriba, y **Consumo** de tokens por sala y agente |
| ¿A qué accede cada sesión? | **Capacidades**: bases de datos, APIs, nube, correo, MCP, apps y skills, declaradas por la propia sesión |

## Instalación (un comando)

Requisitos: macOS o Linux, [Claude Code](https://docs.anthropic.com/claude-code) ya usado al menos una vez, Node 20+ y Python 3.

```bash
git clone <este-repo> cubicle && cd cubicle && ./install.sh && ./cubicle-start.sh
```

`install.sh` instala dependencias, compila y, si no tienes una, configura la statusline de Claude Code (es lo que entrega los límites de uso de la cuenta). `cubicle-start.sh` arranca en `http://127.0.0.1:3100/?token=…` e imprime la URL. Arranca siempre desde una terminal normal, no desde dentro de una sesión de Claude.

## Primer arranque

Sin nada configurado, la oficina detecta las carpetas donde usaste Claude Code en la última semana y te las propone agrupadas: una carpeta con sesión que contiene otras carpetas con sesión es una **oficina**, y ella y sus hijas son sus **agentes**. Cambias nombres en el sitio, marcas lo que quieres y listo.


Después puedes agregar más con **+ Oficina** (carpeta nueva o existente, con tema) y **+ Agent** (una sesión más dentro de una oficina), o desde Settings → "Importar sesiones".

## Recorrido

### La oficina y la barra

Salas por filas (vida personal · trabajo · proyectos personales), cada una con tema, suelo y letrero de su color. Arriba, las fichas de los agentes agrupadas por sala y arrastrables; a la derecha, el uso de tu cuenta (sesión de 5 h y semana) y el botón de consumo. Clic en una ficha o en un personaje abre su terminal y su panel; clic sobre la ficha ya seleccionada abre el menú (descansar, quitar).

### Panel por agente

![Cambios](docs/img/panel-cambios.jpg)

- **Notas**: tablero de la sala, compartido por sus agentes.
- **Cambios**: archivos sin commit de cada repo del agente, con iconos y colores por tipo, guías de nivel y diff verde/rojo. La rama actual va en la cabecera.
- **Reportes**: los `*.html` de `docs/reports/` (o las carpetas que elijas). Pantalla completa con cambio entre reportes para presentar, y "Nuevo reporte": describes qué quieres ver y la sesión lo crea.

![Reportes](docs/img/reportes.jpg)

- **Actividad**: mapa de calor de tus prompts por día, horas y días de la semana en que más trabajas, prompts por semana. La historia se guarda aunque borres sesiones.

![Actividad](docs/img/actividad.jpg)

- **Capacidades**: a qué accede esa sesión fuera del proyecto (bases de datos, APIs y servicios, nube, correo), MCP que usa con conteo real, apps y skills con explicación en lenguaje natural. La primera vez que se lanza un agente, la oficina se lo pregunta a la sesión y ella lo registra sola.

![Capacidades](docs/img/capacidades.jpg)

- **Configuración**: nombre del agente, repositorios conocidos y carpetas de reportes.

### Consumo de tokens

Por sala y por agente, en hoy, 7 días, 30 días o todo, con porcentajes. Sale de los transcripts, no gasta tokens.

![Consumo](docs/img/consumo.jpg)

## Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Código del fork (servidor + webview) | `pixel-agents-src/` (nuestro: `server/src/office/`, `server/src/*.ts` de la oficina, `webview-ui/src/components/`, `components/panel/`, `hooks/`, `i18n/`) |
| Scripts | `scripts/`: `proyecto.py` (salas), `capacidades.py`, `nota.py`, `gen_layout.py`, `gen_assets.py` |
| Datos del usuario | `~/.pixel-agents/oficina/` (`oficinas.json`, `letreros.json`, `capacidades.json`, `actividad.json`, `layout-oficina.json`, `assets/`); cambia con `OFICINA_DIR` |
| Config de Pixel Agents | `~/.pixel-agents/config.json`, `layout.json`, `notes.json`, `usage.json` |

El repositorio no contiene datos de nadie: todo lo tuyo queda en `~/.pixel-agents/`.

## Scripts

```bash
python3 scripts/proyecto.py nuevo "Mi proyecto" ~/code/mi-proyecto --tema code --fila 3 --lanzar
python3 scripts/proyecto.py aplicar        # regenera muebles + plano y lo aplica en vivo
python3 scripts/proyecto.py lista
python3 scripts/nota.py "Mi proyecto" "revisar el deploy"
python3 scripts/capacidades.py pregunta "Mi proyecto"   # la pregunta que responde la sesión
python3 scripts/capacidades.py lista
```

Temas: `code`, `personal`, `finanzas`, `gym`, `cafe`, `cursos`, `fintech`, `inmobiliaria`, `hardware`.

## Desarrollo

- Solo webview: `cd pixel-agents-src/webview-ui && npx tsc -b && npx vite build` y recargar la pestaña.
- Servidor: `./cubicle-build.sh` y reiniciar `cubicle-start.sh`.
- Probar sin tocar tu oficina: `HOME=<tmp> OFICINA_DIR=<tmp>/datos node pixel-agents-src/dist/cli.js --port 3200 --allowed-host prueba.local`.

## Créditos y licencia

- [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) © Pablo De Lucca, MIT. Base: v1.5.0.
- Oficina, MIT. Ver `LICENSE`.

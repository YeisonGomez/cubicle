#!/usr/bin/env python3
"""Contexto de Cubicle en el CLAUDE.md de cada agente: dónde van los reportes y cómo pedirlos.

  contexto.py aplicar [nombre ...]   escribe/actualiza el bloque <!-- cubicle --> en el CLAUDE.md
                                     de cada Directorio (todos si no se indica ninguno)
  contexto.py mostrar "Nombre"       imprime el bloque que le tocaría

El bloque va entre marcas, así se actualiza sin tocar el resto del archivo. Idioma: OFICINA_LANG
o <OFICINA_DIR>/idioma.json (inglés por defecto).
"""
import json, os, sys

HOME = os.path.expanduser("~")
PA = os.path.join(HOME, ".pixel-agents")
DATA = os.environ.get("OFICINA_DIR") or os.path.join(PA, "oficina")
CFG_PATH = os.path.join(PA, "config.json")
INICIO, FIN = "<!-- cubicle:start -->", "<!-- cubicle:end -->"

def idioma():
    l = os.environ.get("OFICINA_LANG")
    if l in ("es", "en"):
        return l
    try:
        l = json.load(open(os.path.join(DATA, "idioma.json"))).get("lang")
    except Exception:
        l = None
    return l if l in ("es", "en") else "en"

BLOQUE = {
"es": """## Cubicle (oficina de sesiones de Claude Code)
Esta carpeta es el agente **{nombre}** de la oficina Cubicle. Hay un panel que muestra tus reportes, cambios git, notas y actividad.
- **Reportes, informes y dashboards**: cuando te pidan uno, créalo como HTML autocontenido (CSS y datos en el mismo archivo, sin dependencias externas) en `{reportes}/<nombre-corto>.html`, en español. NUNCA uses artifacts ni abras el archivo en el navegador: aparece solo en la pestaña Reportes de Cubicle. Si el reporte ya existe, actualiza el mismo archivo.
- Si no está claro si algo debe ser un reporte, pregúntalo antes de generar artefactos.""",
"en": """## Cubicle (Claude Code sessions office)
This folder is the **{nombre}** agent of the Cubicle office. A panel shows your reports, git changes, notes and activity.
- **Reports and dashboards**: when asked for one, create it as a self-contained HTML (CSS and data inline, no external dependencies) at `{reportes}/<short-name>.html`. NEVER use artifacts or open the file in the browser: it shows up by itself in Cubicle's Reports tab. If the report already exists, update the same file.
- If it is unclear whether something should be a report, ask before generating artifacts.""",
}

def cfg():
    return json.load(open(CFG_PATH))

def carpeta_reportes(c, nombre):
    dirs = (c.get("standalone", {}).get("agentSettings", {}).get(nombre, {}) or {}).get("dashboardDirs") or []
    for d in dirs:
        if d not in (".", "") and "*" not in d:
            return d
    return "docs/reports"

def bloque(c, nombre):
    return INICIO + "\n" + BLOQUE[idioma()].format(nombre=nombre, reportes=carpeta_reportes(c, nombre)) + "\n" + FIN

def aplicar(c, d):
    ruta = os.path.join(d["path"], "CLAUDE.md")
    nuevo = bloque(c, d["name"])
    if not os.path.isdir(d["path"]):
        return "sin carpeta"
    actual = open(ruta, encoding="utf-8").read() if os.path.exists(ruta) else ""
    if INICIO in actual and FIN in actual:
        a, b = actual.index(INICIO), actual.index(FIN) + len(FIN)
        salida = actual[:a] + nuevo + actual[b:]
        if salida == actual:
            return "al día"
        estado = "actualizado"
    else:
        salida = (actual.rstrip("\n") + "\n\n" if actual.strip() else "") + nuevo + "\n"
        estado = "añadido" if actual else "creado"
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(salida)
    return estado

def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__); return 0
    c = cfg()
    if argv[1] == "mostrar":
        print(bloque(c, argv[2])); return 0
    if argv[1] == "aplicar":
        quiero = set(argv[2:])
        for d in c.get("directories", []):
            if quiero and d["name"] not in quiero:
                continue
            print(f"{d['name']}: {aplicar(c, d)}")
        return 0
    print("comando desconocido", argv[1]); return 1

if __name__ == "__main__":
    sys.exit(main(sys.argv))

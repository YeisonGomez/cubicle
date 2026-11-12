#!/usr/bin/env python3
"""Proyectos = oficinas. Crea/aplica salas de la oficina Pixel Agents.

  proyecto.py nuevo "<Nombre>" "<ruta>" [--sala "<Sala>"] [--tipo code|personal]
                    [--tema code|personal|finanzas|gym|cafe|cursos|fintech|inmobiliaria|hardware]
                    [--color "#hex"] [--letrero TEXTO] [--fila N] [--sin-aplicar] [--lanzar]
      Registra el Directorio en ~/.pixel-agents/config.json (directories, areaMappings,
      agentSettings), crea la carpeta y su subcarpeta docs/reports/ (reportes), agrega la
      sala a oficinas.json con su letrero (y su fila: 1 vida personal, 2 trabajo,
      3 proyectos personales; por defecto la última), regenera muebles + layout y los aplica en
      vivo (PUT /api/layout + POST /api/assets/reload). --lanzar abre su agente.
  proyecto.py aplicar        regenera muebles + layout y los empuja a la oficina.
  proyecto.py lista          muestra salas y directorios.
"""
import argparse, json, os, re, subprocess, sys, urllib.request

HOME = os.path.expanduser("~")
PA = os.path.join(HOME, ".pixel-agents")
OFI = os.path.dirname(os.path.abspath(__file__))          # scripts
DATA = os.environ.get("OFICINA_DIR") or os.path.join(PA, "oficina")   # datos del usuario: oficinas.json, letreros.json, layout, assets
CFG_PATH = os.path.join(PA, "config.json")
OF_PATH = os.path.join(DATA, "oficinas.json")
LET_PATH = os.path.join(DATA, "letreros.json")
URL = os.environ.get("OFICINA_URL", "http://127.0.0.1:3100")
PALETA = ["#feca57", "#54a0ff", "#e17055", "#1dd1a1", "#ff9ff3", "#a29bfe", "#fd79a8", "#00cec9", "#ffeaa7", "#74b9ff"]
FLOORS = {"finanzas": (7, {"h": 35, "s": 30, "b": 10, "c": 0}), "gym": (4, {"h": 205, "s": 35, "b": 5, "c": 0}),
          "cafe": (7, {"h": 20, "s": 40, "b": -5, "c": 0}), "fintech": (3, {"h": 150, "s": 35, "b": -5, "c": 0}),
          "inmobiliaria": (6, {"h": 300, "s": 30, "b": 0, "c": 0}), "cursos": (1, {"h": 260, "s": 35, "b": -5, "c": 0}),
          "hardware": (4, {"h": 180, "s": 35, "b": -4, "c": 0}),
          "code": (7, {"h": 190, "s": 30, "b": -5, "c": 0}), "personal": (1, {"h": 50, "s": 20, "b": 5, "c": 0})}

# Suelos (valor de tile = índice de floor_N.png + 1): 1 liso, 3 baldosa grande, 4 baldosa
# pequeña, 6 ladrillo claro, 7 ladrillo oscuro. PROHIBIDOS: 2 y 5 (líneas blancas) y 8 y 9
# (ajedrez): su contraste tapa las etiquetas de los personajes. Misma lista que
# FLOOR_PATTERNS_FORBIDDEN en la webview (floorTiles.ts). Brillo acotado por lo mismo.
PISOS_OK = [1, 3, 4, 6, 7]
PISO_REEMPLAZO = {2: 1, 5: 3, 8: 7, 9: 4}
FLOOR_VARIEDAD = [7, 4, 3, 6, 1]
BRILLO = (-10, 12)   # tileColor.b: ni muy claro (tapa la etiqueta) ni muy oscuro (se pierde el personaje)
SATURACION_MAX = 45

def piso_seguro(floor, tcol):
    """Devuelve (floor, tileColor) dentro de lo permitido."""
    f = int(floor) if floor in PISOS_OK else PISO_REEMPLAZO.get(int(floor), 1)
    t = dict(tcol or {"h": 0, "s": 0, "b": 0, "c": 0})
    t["b"] = max(BRILLO[0], min(BRILLO[1], int(t.get("b", 0))))
    t["s"] = min(SATURACION_MAX, int(t.get("s", 0)))
    return f, t

def aplicar_skin(of):
    """Tema Pokémon: cada sala toma el color y el tono de piso de su tipo (skin.json +
    scripts/pokemon.json). Guarda los valores originales en *_base y los restaura con el
    tema clásico. Devuelve una descripción de lo que cambió o None."""
    skin = load(os.path.join(DATA, "skin.json"), {"theme": "classic", "rooms": {}})
    tema = skin.get("theme")
    # Yu-Gi-Oh lleva su propio reparto (skin.json -> yugioh) y sus datos (yugioh.json).
    data = load(os.path.join(OFI, "yugioh.json" if tema == "yugioh" else "pokemon.json"), None)
    salas_tipo = (skin.get("yugioh") or {}).get("rooms", {}) if tema == "yugioh" else skin.get("rooms", {})
    cambios = []
    if tema in ("pokemon", "yugioh") and data:
        orden, tipos = data["order"], data["types"]
        for i, s in enumerate(of.get("salas", [])):
            t = salas_tipo.get(s["label"])
            t = t if t in tipos else orden[i % len(orden)]
            info = tipos[t]
            s.setdefault("color_base", s["color"]); s.setdefault("tileColor_base", dict(s["tileColor"]))
            tc = dict(s["tileColor_base"]); tc["h"] = info["hue"]; tc["s"] = info.get("sat", tc.get("s", 30))
            if s["color"] != info["color"] or s["tileColor"] != tc:
                s["color"], s["tileColor"] = info["color"], tc
                cambios.append("%s=%s" % (s["label"], t))
    else:
        for s in of.get("salas", []):
            if "color_base" in s:
                s["color"], s["tileColor"] = s.pop("color_base"), s.pop("tileColor_base", s["tileColor"])
                cambios.append("%s restaurada" % s["label"])
    return ", ".join(cambios) or None

def normalizar_pisos(of):
    """Corrige en oficinas.json las salas con piso o brillo prohibidos. Devuelve las que cambió."""
    cambiadas = []
    for s in of.get("salas", []):
        f, t = piso_seguro(s.get("floor", 1), s.get("tileColor"))
        if f != s.get("floor") or t != s.get("tileColor"):
            que = ("suelo %s→%s" % (s.get("floor"), f)) if f != s.get("floor") else ("brillo %s→%s" % ((s.get("tileColor") or {}).get("b"), t["b"]))
            cambiadas.append("%s: %s" % (s["label"], que))
            s["floor"], s["tileColor"] = f, t
    return cambiadas

def load(p, default):
    return json.load(open(p)) if os.path.exists(p) else default
def save(p, d):
    json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
def token():
    return open(os.path.join(PA, "standalone-token")).read().strip()
def api(method, path, body=None, auth=True):
    data = json.dumps(body).encode() if body is not None else (b"{}" if method in ("POST", "PUT") else None)
    req = urllib.request.Request(URL + path, method=method, data=data)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if auth: req.add_header("Authorization", "Bearer " + token())
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode() or "null")

def asegurar_datos(cfg):
    """Carpeta de datos y pack de muebles registrados en la config de Pixel Agents."""
    os.makedirs(DATA, exist_ok=True)
    assets = os.path.join(DATA, "assets")
    ext = cfg.setdefault("externalAssetDirectories", [])
    if assets not in ext:
        ext.append(assets)

def regenerar():
    subprocess.run([sys.executable, os.path.join(OFI, "gen_assets.py")], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([sys.executable, os.path.join(OFI, "gen_layout.py")], check=True)

def aplicar():
    cfg = load(CFG_PATH, None)
    if cfg is not None:
        asegurar_datos(cfg); save(CFG_PATH, cfg)
    of = load(OF_PATH, None)
    if of is not None:
        sk = aplicar_skin(of)
        if sk:
            print("skin:", sk)
        cambios = normalizar_pisos(of)
        if cambios:
            print("pisos corregidos (contraste de etiquetas):", "; ".join(cambios))
        if sk or cambios:
            save(OF_PATH, of)
    regenerar()
    layout = json.load(open(os.path.join(DATA, "layout-oficina.json")))
    try:
        api("POST", "/api/assets/reload")
        r = api("PUT", "/api/layout", layout)
        print("oficina actualizada en vivo:", r)
    except Exception as e:  # servidor apagado o viejo: queda para el próximo arranque
        save(os.path.join(PA, "layout.json"), layout)
        print("servidor no disponible (%s): layout guardado en ~/.pixel-agents/layout.json; se aplica al reiniciar" % e)

def cmd_nuevo(a):
    nombre, ruta = a.nombre.strip(), os.path.abspath(os.path.expanduser(a.ruta))
    sala = (a.sala or nombre).strip()
    cfg = load(CFG_PATH, None)
    if cfg is None: sys.exit("no existe " + CFG_PATH)
    asegurar_datos(cfg)
    os.makedirs(os.path.join(ruta, "docs", "reports"), exist_ok=True)
    if not os.path.exists(os.path.join(ruta, "CLAUDE.md")):
        open(os.path.join(ruta, "CLAUDE.md"), "w").write(
            f"# {nombre}\n\nProyecto creado desde la oficina el {__import__('datetime').date.today()}.\n\n"
            "## Oficina\n- Los `*.html` que dejes en `docs/reports/` aparecen en la pestaña Reportes de este agente.\n"
            f"- Notas de la sala: `python3 {OFI}/nota.py \"{sala}\" \"<texto>\"`.\n"
            f"- En tu primera conversación, y cada vez que ganes acceso a algo externo (bases de datos, APIs, nube, correo, apps), "
            f"registra tus capacidades: `python3 {OFI}/capacidades.py pregunta \"{nombre}\"` muestra el formato; "
            f"responde con `capacidades.py set \"{nombre}\"`. Así la oficina muestra tus Recursos externos, MCP, Apps y Skills.\n")
    dirs = cfg.setdefault("directories", [])
    if not any(d["name"] == nombre for d in dirs):
        dirs.append({"name": nombre, "path": ruta})
    st = cfg.setdefault("standalone", {})
    st.setdefault("areaMappings", {})[nombre] = [sala]
    tipo = a.tipo or ("code" if os.path.isdir(os.path.join(ruta, ".git")) else "personal")
    st.setdefault("agentSettings", {})[nombre] = {"kind": tipo, "projects": [], "dashboardDirs": ["docs/reports"]}
    save(CFG_PATH, cfg)
    of = load(OF_PATH, {"salas": [], "descanso": {}})
    if not any(s["label"] == sala for s in of["salas"]):
        slug = re.sub(r"[^A-Z0-9]+", "_", sala.upper()).strip("_")
        sign = "SIGN_" + slug
        tema = a.tema or ("code" if tipo == "code" else "personal")
        floor, tcol = FLOORS.get(tema, FLOORS["personal"])
        color = a.color or PALETA[len(of["salas"]) % len(PALETA)]
        fila = a.fila or max([x.get("fila", 1) for x in of["salas"]] + [1])
        floor = FLOOR_VARIEDAD[len(of["salas"]) % len(FLOOR_VARIEDAD)] if a.tema is None else floor
        floor, tcol = piso_seguro(floor, tcol)
        of["salas"].append({"label": sala, "sign": sign, "color": color, "floor": floor, "tileColor": tcol, "tema": tema, "base": ruta, "fila": fila})
        save(OF_PATH, of)
        let = load(LET_PATH, {})
        let[sign] = (a.letrero or sala).upper()[:15]
        save(LET_PATH, let)
    print(f"proyecto '{nombre}' → sala '{sala}' ({tipo}); carpeta {ruta}")
    if not a.sin_aplicar:
        aplicar()
    if a.lanzar:
        try:
            print("lanzando agente:", api("POST", "/api/relaunch", {"only": [nombre]}))
        except Exception as e:
            print("no se pudo lanzar:", e)

def cmd_lista(_):
    cfg = load(CFG_PATH, {}); of = load(OF_PATH, {"salas": []})
    m = cfg.get("standalone", {}).get("areaMappings", {})
    for s in of["salas"]:
        dirs = [d for d, v in m.items() if s["label"] in v]
        print(f"fila {s.get('fila','?')}  {s['label']:<14} {s['color']}  tema={s.get('tema','?'):<9} suelo={s['floor']}  agentes: {', '.join(dirs) or '—'}")

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = p.add_subparsers(dest="cmd", required=True)
n = sub.add_parser("nuevo"); n.add_argument("nombre"); n.add_argument("ruta")
n.add_argument("--sala"); n.add_argument("--tipo", choices=["code", "personal"]); n.add_argument("--tema")
n.add_argument("--color"); n.add_argument("--letrero"); n.add_argument("--fila", type=int); n.add_argument("--sin-aplicar", action="store_true"); n.add_argument("--lanzar", action="store_true")
n.set_defaults(f=cmd_nuevo)
sub.add_parser("aplicar").set_defaults(f=lambda a: aplicar())
sub.add_parser("lista").set_defaults(f=cmd_lista)
args = p.parse_args(); args.f(args)

#!/usr/bin/env python3
"""Layout v3 de la oficina (Pixel Agents), generado a partir de oficinas.json.

  - Una sala por proyecto (entrada en oficinas.json → "salas"). Cada sala tiene
    "fila" (1 = vida personal, 2 = trabajo, 3 = proyectos personales…); las salas
    de una fila se reparten TODO el ancho (la fila con más salas fija el ancho de
    la cuadrícula: 12 de piso por sala). Alto fijo: 10 de piso + pared doble arriba.
  - Cada sala tiene su sofá (SOFA_LOUNGE, 3 puestos): ahí se sienta el agente de
    la sala cuando el usuario lleva semanas sin escribirle (regla en la webview).
  - El número de escritorios de cada sala sale de cuántos Directorios de
    ~/.pixel-agents/config.json están mapeados a esa sala (mín. 2, máx. 3).
Escribe <OFICINA_DIR>/layout-oficina.json. Se aplica con proyecto.py aplicar
(PUT /api/layout) o reiniciando la oficina (se copia a ~/.pixel-agents/layout.json).
"""
import json, os, random, string, sys, time

HOME = os.path.expanduser("~")
DATA = os.environ.get("OFICINA_DIR") or os.path.join(HOME, ".pixel-agents", "oficina")
CFG = json.load(open(os.path.join(HOME, ".pixel-agents", "config.json")))
OF = json.load(open(os.path.join(DATA, "oficinas.json")))

VOID, WALL = 255, 0
ROOM_W, ROOM_H = 12, 10         # ancho mínimo de piso por sala; alto de piso
BLOCK_H = ROOM_H + 2            # 2 filas de pared + 10 de piso

salas = OF["salas"]
# Filas: por el campo "fila" de cada sala (orden ascendente; sin campo → última).
_filas = sorted({s.get("fila", 99) for s in salas})
filas = [[s for s in salas if s.get("fila", 99) == f] for f in _filas]
PER_ROW = max(len(f) for f in filas)
n_rows = len(filas)
COLS = 1 + PER_ROW * (ROOM_W + 1)
ROWS = n_rows * BLOCK_H + 1

def anchos(n):
    """Anchos de piso de las n salas de una fila: reparten COLS entre todas."""
    w = (COLS - 1 - n) // n
    ws = [w] * n
    ws[-1] += (COLS - 1 - n) - w * n
    return ws

tiles = [VOID] * (COLS * ROWS)
colors = [None] * (COLS * ROWS)
areas = [None] * (COLS * ROWS)
def put(c, r, v, col=None, area=None):
    i = r * COLS + c; tiles[i] = v; colors[i] = col; areas[i] = area

# uid determinista (tipo + posición): el mismo mueble conserva su uid entre regeneraciones,
# así los asientos de los agentes (guardados por uid) sobreviven a `proyecto.py aplicar`.
_seen = {}
def uid(t, c, r):
    k = f"f-{t.lower()}-{c}-{r}"
    n = _seen.get(k, 0); _seen[k] = n + 1
    return k if n == 0 else f"{k}-{n}"
F = []
def add(t, c, r): F.append({"uid": uid(t, c, r), "type": t, "col": c, "row": r})
def desk(c, r):
    add("DESK_FRONT", c, r); add("PC_FRONT_OFF", c + 1, r); add("CUSHIONED_BENCH", c + 1, r + 2)

# Offsets relativos a (x0 = primera col de piso, yw = primera fila de pared).
# wall: (tipo, dx, dy) con dy 0 (alto 2) o 1 (letrero, alto 1); ondesk: decor
# sobre el escritorio k; floor: (tipo, dx, dy) con dy >= 6 (debajo de las bancas).
TEMAS = {
    "finanzas": dict(wall=[],
                     ondesk=["GOLD_BARS", "PIGGY_BANK", "GOLD_BARS"],
                     floor=[("SAFE", 0, 10), ("BIN", 0, 7), ("PLANT", 10, 8), ("SMALL_TABLE_FRONT", 8, 9), ("COFFEE", 8, 9)]),
    "gym":      dict(wall=[],
                     ondesk=["LUNCHBOX", "KETTLEBELL", "LUNCHBOX"],
                     floor=[("TREADMILL", 0, 7), ("TREADMILL", 2, 7), ("DUMBBELL_RACK", 9, 7), ("BENCH_PRESS", 7, 10),
                            ("YOGA_MAT", 0, 10), ("YOGA_MAT", 2, 10), ("KETTLEBELL", 10, 10), ("KETTLEBELL", 11, 10),
                            ("PUNCHING_BAG", 11, 6), ("BARBELL", 7, 9)]),
    "fintech":  dict(wall=[],
                     ondesk=["GOLD_BARS", "HOUSE", "GOLD_BARS"],
                     floor=[("SAFE", 11, 9), ("BIN", 0, 10), ("PLANT", 11, 6), ("SMALL_TABLE_FRONT", 8, 7), ("COFFEE", 8, 7)]),
    "inmobiliaria": dict(wall=[],
                     ondesk=["HOUSE", "HOUSE", "HOUSE"],
                     floor=[("SIGNAL_TOWER", 10, 8), ("PLANT_2", 0, 10), ("SMALL_TABLE_FRONT", 8, 7), ("COFFEE", 8, 7)]),
    "cafe":     dict(wall=[],
                     ondesk=["COFFEE_MACHINE", "COFFEE_MACHINE", "COFFEE_MACHINE"],
                     floor=[("SMALL_TABLE_FRONT", 0, 7), ("COFFEE", 0, 7), ("SMALL_TABLE_FRONT", 3, 7), ("COFFEE", 3, 7),
                            ("SMALL_TABLE_FRONT", 8, 7), ("COFFEE", 8, 7), ("SMALL_TABLE_FRONT", 11, 7), ("COFFEE", 11, 7),
                            ("SMALL_TABLE_FRONT", 1, 10), ("COFFEE", 1, 10), ("SMALL_TABLE_FRONT", 9, 10), ("COFFEE", 9, 10),
                            ("PLANT", 11, 9), ("PLANT_2", 0, 10), ("DOUBLE_BOOKSHELF", 5, 7)]),
    "cursos":   dict(wall=[],
                     ondesk=["BOOK_STACK", "BOOK_STACK", "BOOK_STACK"],
                     floor=[("PLANT", 11, 6), ("BIN", 0, 7), ("SMALL_TABLE_FRONT", 8, 7), ("COFFEE", 8, 7), ("PLANT_2", 0, 10)]),
    "code":     dict(wall=[],
                     ondesk=["BOOK_STACK", "PC_FRONT_OFF", "BOOK_STACK"],
                     floor=[("PLANT", 11, 6), ("BIN", 0, 7), ("SMALL_TABLE_FRONT", 8, 7), ("COFFEE", 8, 7), ("PLANT_2", 0, 10), ("SAFE", 11, 10)]),
    "hardware": dict(wall=[],
                     ondesk=["BOOK_STACK", "LUNCHBOX", "BOOK_STACK"],
                     floor=[("SIGNAL_TOWER", 11, 6), ("SIGNAL_TOWER", 0, 7), ("SMALL_TABLE_FRONT", 8, 7), ("COFFEE", 8, 7),
                            ("PLANT_2", 0, 10), ("BIN", 11, 10)]),
    "personal": dict(wall=[],
                     ondesk=[], floor=[("PLANT", 11, 6), ("SMALL_TABLE_FRONT", 8, 7), ("COFFEE", 8, 7), ("PLANT_2", 0, 10)]),
}

mapped = CFG["standalone"].get("areaMappings", {})
# ── Biblioteca: tamaño según los archivos de la oficina (carpeta base o sus proyectos) ──
_SKIP = {"node_modules", ".git", "dist", "build", "out", "coverage", ".next", "venv", ".venv", "__pycache__",
         ".cache", "target", "vendor", "Pods", "DerivedData", ".Trash"}
_MAX_FILES = 200_000

def count_files(root):
    """Archivos bajo root sin dependencias ni compilados; se detiene en _MAX_FILES."""
    n = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP and not d.startswith(".")]
        n += len(filenames)
        if n >= _MAX_FILES:
            return _MAX_FILES
    return n

def shelf_units(sala):
    """Bibliotecas dobles para la sala: 1 (<100 archivos), 2 (<1k), 3 (<5k), 4 (<20k), 5 (<50k), 6 (más)."""
    roots = []
    base = os.path.expanduser(sala.get("base") or "")
    if base and os.path.isdir(base):
        roots = [base]
    else:
        roots = [d["path"] for d in CFG.get("directories", []) if sala["label"] in mapped.get(d["name"], []) and os.path.isdir(d["path"])]
    files = sum(count_files(r) for r in roots)
    sala["_archivos"] = files
    for units, limit in ((1, 100), (2, 1000), (3, 5000), (4, 20000), (5, 50000)):
        if files < limit:
            return units
    return 6

def desks_for(n):
    """Escritorios de una sala según sus agentes: 2-3 en una fila; 4-6 en dos filas."""
    return max(2, min(3, n)) if n <= 3 else min(6, n)
def n_dirs(label):
    return sum(1 for v in mapped.values() if label in v)

# Posiciones relativas de los temas asumen una sala de 12 de ancho: lo que está
# a la izquierda (dx < 6) se ancla a la izquierda; el resto, a la derecha.
def ax(x0, W, dx):
    return x0 + dx if dx < 6 else x0 + W - (ROOM_W - dx)

# Ancho en tiles de cada mueble (manifests del pack de Pixel Agents + nuestro pack
# generado), para que nada asome fuera de la sala: un mueble de 2 tiles en la última
# columna se salía a la pared (p. ej. las mesas del tema cafe en salas de 12).
def _anchos_muebles():
    import glob
    out = {}
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pixel-agents-src")
    dirs = [os.path.join(base, "webview-ui", "public", "assets", "furniture"), os.path.join(base, "dist", "webview", "assets", "furniture")]
    for d in dirs:
        for m in glob.glob(os.path.join(d, "*", "manifest.json")):
            try:
                j = json.load(open(m))
            except Exception:
                continue
            for it in (j.get("members") or [j]):
                if it.get("id"):
                    out.setdefault(it["id"], int(it.get("footprintW") or max(1, int(it.get("width", 16)) // 16)))
    try:
        ext = json.load(open(os.path.join(DATA, "assets", "manifest.json")))
        for it in ext.get("items", ext.get("furniture", [])):
            if it.get("id"):
                out.setdefault(it["id"], int(it.get("footprintW") or max(1, int(it.get("width", 16)) // 16)))
    except Exception:
        pass
    return out
ANCHO = _anchos_muebles()
def dentro(c, t, x0, W):
    """Columna corregida para que el mueble t quepa en el piso [x0, x0+W)."""
    return max(x0, min(c, x0 + W - ANCHO.get(t, 1)))

for gy, fila in enumerate(filas):
    ws = anchos(len(fila))
    x0 = 1
    for sala, W in zip(fila, ws):
        yw = gy * BLOCK_H; yf = yw + 2
        # paredes: 2 filas arriba + laterales
        for c in range(x0 - 1, x0 + W + 1):
            put(c, yw, WALL); put(c, yw + 1, WALL)
        for r in range(yf, yf + ROOM_H):
            put(x0 - 1, r, WALL); put(x0 + W, r, WALL)
            for c in range(x0, x0 + W):
                put(c, r, sala["floor"], sala["tileColor"], sala["label"])
        tema = TEMAS.get(sala.get("tema", "personal"), TEMAS["personal"])
        # Pared estándar: letrero a la izquierda; a la derecha TV (reportes), tablero
        # de notas y reloj; en medio, la biblioteca crece con los archivos de la oficina.
        add(sala["sign"], x0, yw + 1)
        add("TV_WALL", x0 + W - 5, yw); add("NOTE_BOARD", x0 + W - 3, yw); add("CLOCK", x0 + W - 1, yw)
        max_units = max(0, (W - 8) // 2)
        for k in range(min(max_units, shelf_units(sala))):
            add("DOUBLE_BOOKSHELF", x0 + 3 + 2 * k, yw)
        nd = desks_for(n_dirs(sala["label"]))
        if W >= 20:                      # sala ancha: escritorios repartidos a lo ancho
            gap = (W - 4 * min(nd, 3)) // (min(nd, 3) + 1)
            offs = [gap * (k + 1) + 4 * k for k in range(min(nd, 3))]
            sh = 0
        else:
            offs = [0, 4, 8] if nd >= 3 else [1, 5]
            sh = (W - ROOM_W) // 2       # bloque de escritorios centrado
        for k, dx in enumerate(offs):
            desk(x0 + sh + dx, yf + 1)
            if k < len(tema["ondesk"]):
                add(tema["ondesk"][k], x0 + sh + dx + 2, yf + 1)
        if nd > 3:
            # segunda fila de escritorios (hasta 6 agentes) en filas 7-9; el sofá baja a la 10
            for k, dx in enumerate([0, 4, 8][: nd - 3]):
                desk(x0 + sh + dx, yf + 5)
            add("SOFA_LOUNGE", x0 + (W - 3) // 2, yw + 10)
        else:
            # Los adornos que van encima de otro mueble (COFFEE sobre la mesa) comparten (dx, dy):
            # se mueven junto con él si hubo que meterlo dentro de la sala.
            pos = {}
            for t, dx, dy in tema["floor"]:
                c = pos.get((dx, dy))
                if c is None:
                    c = pos[(dx, dy)] = dentro(ax(x0, W, dx), t, x0, W)
                add(t, c, yw + dy)
            sx = x0 + (W - 3) // 2
            add("SOFA_LOUNGE", sx, yw + 8)    # sofá de descanso (filas 8-9; la 11 la tapa la pared de abajo)
            if W >= 20:  # salas anchas: plantas a los lados del sofá
                add("PLANT", sx - 2, yw + 8); add("PLANT_2", sx + 4, yw + 8)
        x0 += W + 1

# pared inferior bajo la última fila de salas
yb = n_rows * BLOCK_H
for c in range(0, COLS):
    put(c, yb, WALL)
if False:  # (zona de descanso separada: descartada, los sofás van dentro de cada sala)
    desc = OF["descanso"]
    yw = n_rows * BLOCK_H; yf = yw + 2
    x0, w = 1, COLS - 2
    for c in range(0, COLS):
        put(c, yw, WALL); put(c, yw + 1, WALL); put(c, yf + LOUNGE_H, WALL)
    for r in range(yf, yf + LOUNGE_H):
        put(0, r, WALL); put(COLS - 1, r, WALL)
        for c in range(x0, x0 + w):
            put(c, r, desc["floor"], desc["tileColor"], desc["label"])
    add(desc["sign"], x0 + (w - 3) // 2, yw + 1)
    add("LARGE_PAINTING", x0 + 1, yw); add("CLOCK", x0 + w - 8, yw); add("DOUBLE_BOOKSHELF", x0 + w - 6, yw)
    n_sofas = (w - 2) // 6
    for k in range(n_sofas):
        add("SOFA_LOUNGE", x0 + 1 + k * 6, yf + 2)
    for k in range(0, n_sofas, 2):
        add("SMALL_TABLE_FRONT", x0 + 2 + k * 6, yf + 4); add("COFFEE", x0 + 2 + k * 6, yf + 4)
    add("PLANT", x0, yf + LOUNGE_H - 1); add("PLANT_2", x0 + w - 1, yf + LOUNGE_H - 1)

layout = {
    "version": 1, "cols": COLS, "rows": ROWS, "layoutRevision": 1,
    "tiles": tiles, "tileColors": colors, "furniture": F, "pets": [],
    "areas": [{"label": s["label"], "color": s["color"]} for s in salas],
    "areaTiles": areas,
}
out = os.path.join(DATA, "layout-oficina.json")
json.dump(layout, open(out, "w"))
print("escrito", out, f"{COLS}x{ROWS}", "salas:", len(salas), "muebles:", len(F),
      "| biblioteca:", ", ".join(f"{s['label']} {s.get('_archivos', 0)} archivos" for s in salas))
if "--mapa" in sys.argv:
    for r in range(ROWS):
        print("".join("." if tiles[r*COLS+c] == VOID else ("#" if tiles[r*COLS+c] == WALL else str(tiles[r*COLS+c])) for c in range(COLS)))

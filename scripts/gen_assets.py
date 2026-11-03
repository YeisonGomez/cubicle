#!/usr/bin/env python3
"""Genera el pack de muebles pixel-art de la oficina (temas: finanzas, gym, café,
cursos, fintech, inmobiliaria, código, hardware) y un letrero por sala con el
color de la sala. Sin dependencias: escribe PNG RGBA con zlib. Salida:
  <OFICINA_DIR>/assets/assets/furniture/<ID>/{manifest.json, <ID>.png}
(OFICINA_DIR = ~/.pixel-agents/oficina por defecto; es el pack externo que
Pixel Agents carga desde config.externalAssetDirectories).
"""
import json, os, struct, zlib

DATA = os.environ.get("OFICINA_DIR") or os.path.join(os.path.expanduser("~"), ".pixel-agents", "oficina")
ROOT = os.path.join(DATA, "assets", "assets", "furniture")

# ---------- PNG writer ----------
def write_png(path, rows, palette):
    h = len(rows); w = len(rows[0])
    raw = b""
    for r in rows:
        assert len(r) == w, (path, r)
        raw += b"\x00" + b"".join(bytes(palette[ch]) for ch in r)
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)

T = (0, 0, 0, 0)
P = {
    ".": T,
    "k": (28, 24, 32, 255),      # negro/contorno
    "K": (60, 56, 70, 255),      # gris oscuro
    "g": (120, 120, 130, 255),   # gris
    "G": (180, 180, 190, 255),   # gris claro
    "w": (240, 240, 235, 255),   # blanco
    "y": (230, 184, 0, 255),     # dorado
    "Y": (255, 220, 90, 255),    # dorado claro
    "o": (255, 140, 40, 255),    # naranja
    "r": (210, 60, 60, 255),     # rojo
    "p": (235, 130, 170, 255),   # rosa (cerdito)
    "e": (60, 160, 80, 255),     # verde
    "E": (20, 90, 50, 255),      # verde oscuro (tablero finanzas)
    "b": (40, 70, 130, 255),     # azul oscuro (tablero deporte)
    "B": (80, 140, 220, 255),    # azul
    "v": (120, 80, 180, 255),    # morado (mat)
    "V": (160, 120, 220, 255),   # morado claro
    "n": (110, 75, 45, 255),     # madera
    "N": (160, 115, 70, 255),    # madera clara
    "c": (90, 200, 220, 255),    # cian (pantalla)
    "d": (18, 22, 34, 255),      # pantalla apagada (TV)
}

# ---------- fuente 3x5 ----------
FONT = {
    "A": ["010", "101", "111", "101", "101"],
    "D": ["110", "101", "101", "101", "110"],
    "E": ["111", "100", "110", "100", "111"],
    "F": ["111", "100", "110", "100", "100"],
    "I": ["111", "010", "010", "010", "111"],
    "N": ["101", "111", "111", "101", "101"],
    "O": ["111", "101", "101", "101", "111"],
    "P": ["111", "101", "111", "100", "100"],
    "R": ["111", "101", "111", "110", "101"],
    "S": ["111", "100", "111", "001", "111"],
    "T": ["111", "010", "010", "010", "010"],
    "Z": ["111", "001", "010", "100", "111"],
    "C": ["111", "100", "100", "100", "111"],
    "U": ["101", "101", "101", "101", "111"],
    "H": ["101", "101", "111", "101", "101"],
    "K": ["101", "110", "100", "110", "101"],
    "V": ["101", "101", "101", "101", "010"],
    "M": ["101", "111", "111", "101", "101"],
    "L": ["100", "100", "100", "100", "111"],
    "G": ["111", "100", "101", "101", "111"],
    "B": ["110", "101", "110", "101", "110"],
    "J": ["111", "001", "001", "101", "111"],
    "Q": ["111", "101", "101", "111", "001"],
    "W": ["101", "101", "111", "111", "101"],
    "X": ["101", "101", "010", "101", "101"],
    "Y": ["101", "101", "010", "010", "010"],
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "-": ["000", "000", "111", "000", "000"],
    " ": ["000", "000", "000", "000", "000"],
}

def sign(text, w, h, bg, fg, border):
    rows = [[bg] * w for _ in range(h)]
    for x in range(w):
        rows[0][x] = border; rows[h - 1][x] = border
    for y in range(h):
        rows[y][0] = border; rows[y][w - 1] = border
    tw = len(text) * 4 - 1
    x0 = (w - tw) // 2; y0 = (h - 5) // 2
    for i, ch in enumerate(text):
        g = FONT[ch]
        for yy in range(5):
            for xx in range(3):
                if g[yy][xx] == "1":
                    rows[y0 + yy][x0 + i * 4 + xx] = fg
    return ["".join(r) for r in rows]

# ---------- sprites ----------
def grid(s):
    return [l for l in s.strip("\n").split("\n")]

SPRITES = {}


# Letreros genéricos para proyectos nuevos (proyecto.py los genera con sign() y los
# registra en ITEMS en tiempo de ejecución: ver gen_sign_extra abajo).

# Sofá de descanso (48x32, 3 asientos). Fila superior = respaldo (backgroundTiles 1,
# no es asiento); fila inferior = cojines, cada tile es una silla (category chairs).
_sf = [["."] * 48 for _ in range(32)]
def _rect(x1, y1, x2, y2, col):
    for y in range(y1, y2 + 1):
        for x in range(x1, x2 + 1):
            _sf[y][x] = col
_rect(2, 6, 45, 30, "k")            # contorno general
_rect(3, 7, 44, 29, "v")            # cuerpo morado
_rect(4, 8, 43, 15, "V")            # respaldo claro
for x in (17, 31):                  # costuras del respaldo
    for y in range(8, 16):
        _sf[y][x] = "v"
_rect(0, 14, 3, 29, "k"); _rect(1, 15, 2, 28, "K")      # brazo izq
_rect(44, 14, 47, 29, "k"); _rect(45, 15, 46, 28, "K")  # brazo der
for seat in range(3):               # cojines de asiento
    x1 = 4 + seat * 14
    _rect(x1, 17, x1 + 12, 26, "p" if seat % 2 == 0 else "o")
    _rect(x1, 17, x1 + 12, 17, "w")   # brillo
for x in (17, 31):
    for y in range(17, 27):
        _sf[y][x] = "k"
_rect(3, 27, 44, 29, "K")           # base
for x in (4, 43):                   # patas
    _sf[30][x] = "k"; _sf[31][x] = "k"
SPRITES["SOFA_LOUNGE"] = ["".join(r) for r in _sf]

# Máquina de café (16x16), tema café
SPRITES["COFFEE_MACHINE"] = grid("""
................
....kkkkkkkk....
...kGGGGGGGGk...
...kGkkkkkkGk...
...kGkccccckGk..
...kGkkkkkkGk...
...kGGGGGGGGk...
...kggggggggk...
...kgkkkkkkgk...
...kgk.ww.kgk...
...kgk.ww.kgk...
...kgkkkkkkgk...
...kKKKKKKKKk...
...kkkkkkkkkk...
................
................
""")

# Tablero de menú (pared, 32x32) para el café
_mb = [["."] * 32 for _ in range(32)]
for y in range(4, 28):
    for x in range(2, 30):
        _mb[y][x] = "K"
for x in range(2, 30):
    _mb[4][x] = "n"; _mb[27][x] = "n"
for y in range(4, 28):
    _mb[y][2] = "n"; _mb[y][29] = "n"
for (yy, x0, x1, col) in [(8, 6, 16, "w"), (8, 20, 25, "y"), (12, 6, 14, "w"), (12, 20, 25, "y"), (16, 6, 18, "w"), (16, 20, 25, "y"), (20, 6, 12, "w"), (20, 20, 25, "y"), (23, 6, 24, "o")]:
    for x in range(x0, x1 + 1):
        _mb[yy][x] = col
SPRITES["MENU_BOARD"] = ["".join(r) for r in _mb]

# Saco de boxeo (16x32: fila superior fondo/cadena, fila inferior el saco)
_pb = [["."] * 16 for _ in range(32)]
for y in range(0, 8):
    _pb[y][7] = "g"; _pb[y][8] = "g"
for y in range(8, 30):
    for x in range(4, 12):
        _pb[y][x] = "r"
    _pb[y][4] = "k"; _pb[y][11] = "k"; _pb[y][5] = "o"
for x in range(4, 12):
    _pb[8][x] = "k"; _pb[29][x] = "k"; _pb[12][x] = "k"; _pb[25][x] = "k"
SPRITES["PUNCHING_BAG"] = ["".join(r) for r in _pb]

# Banco de pesas (32x16)
_bp = [["."] * 32 for _ in range(16)]
for x in range(6, 26):
    _bp[7][x] = "k"; _bp[8][x] = "r"; _bp[9][x] = "k"
for x in (8, 23):
    for y in range(9, 15):
        _bp[y][x] = "g"
for x in range(2, 30):
    _bp[3][x] = "g"
for x in (2, 3, 28, 29):
    for y in range(1, 6):
        _bp[y][x] = "k"
for x in (4, 27):
    for y in range(2, 5):
        _bp[y][x] = "K"
SPRITES["BENCH_PRESS"] = ["".join(r) for r in _bp]

# Letrero WiFi (pared 16x16)
_wf = [["."] * 16 for _ in range(16)]
for y in range(1, 15):
    for x in range(1, 15):
        _wf[y][x] = "K"
for (r, y0) in [(6, 4), (4, 7), (2, 10)]:
    for x in range(8 - r, 8 + r):
        _wf[y0][x] = "c"
_wf[13][7] = "c"; _wf[13][8] = "c"
SPRITES["WIFI_SIGN"] = ["".join(r) for r in _wf]

# Pila de libros (16x16) para Cursos
SPRITES["BOOK_STACK"] = grid("""
................
................
................
................
....kkkkkkkk....
....krrrrrrk....
...kkkkkkkkk....
...kBBBBBBBk....
..kkkkkkkkkk....
..keeeeeeeek....
..kkkkkkkkkk....
..kyyyyyyyyk....
..kkkkkkkkkk....
................
................
................
""")

# Tablero de corcho con notas (32x32, pared) — abre el panel de notas de la sala
_cb = [["."] * 32 for _ in range(32)]
for y in range(2, 30):
    for x in range(2, 30):
        _cb[y][x] = "N" if (x + y) % 5 else "n"
for x in range(2, 30):
    _cb[2][x] = _cb[29][x] = "n"
for y in range(2, 30):
    _cb[y][2] = _cb[y][29] = "n"
def _note(x0, y0, col):
    for y in range(y0, y0 + 8):
        for x in range(x0, x0 + 8):
            _cb[y][x] = col
    for x in range(x0 + 1, x0 + 7):
        _cb[y0 + 3][x] = "k"; _cb[y0 + 5][x] = "k"
    _cb[y0][x0 + 3] = _cb[y0][x0 + 4] = "r"
_note(5, 6, "Y"); _note(17, 5, "c"); _note(8, 17, "p"); _note(19, 16, "e")
SPRITES["NOTE_BOARD"] = ["".join(r) for r in _cb]

# Televisor de pared (32x32): acceso directo a Reportes de la sala. Pantalla con
# una gráfica de barras y una línea, marco oscuro y una barra de luz abajo.
_tv = [["."] * 32 for _ in range(32)]
for y in range(3, 27):
    for x in range(1, 31):
        _tv[y][x] = "k" if (y in (3, 26) or x in (1, 30)) else ("K" if (y in (4, 25) or x in (2, 29)) else "d")
for x, h in ((7, 9), (11, 14), (15, 6), (19, 16), (23, 11)):
    for y in range(24 - h, 24):
        for xx in range(x, x + 3):
            _tv[y][xx] = "e" if h < 12 else "c"
for x in range(5, 27):
    y = 12 - (x // 6) % 3
    _tv[y][x] = "Y"
for x in range(12, 20):
    _tv[27][x] = "K"; _tv[28][x] = "K"
_tv[28][15] = _tv[28][16] = "c"
SPRITES["TV_WALL"] = ["".join(r) for r in _tv]

SPRITES["HOUSE"] = grid("""
................
.......kk.......
......krrk......
.....krrrrk.....
....krrrrrrk....
...krrrrrrrrk...
..kkkkkkkkkkkk..
..kwwwwwwwwwwk..
..kwBBwwwwBBwk..
..kwBBwwwwBBwk..
..kwwwwnnwwwwk..
..kwwwwnnwwwwk..
..kwwwwnnwwwwk..
..kkkkkkkkkkkk..
................
................
""")

SPRITES["SIGNAL_TOWER"] = grid("""
.......c........
......c.c.......
.....c.k.c......
....c..k..c.....
.......k........
......kkk.......
......k.k.......
......k.k.......
.....kk.kk......
.....k...k......
.....k...k......
....kk...kk.....
....k.....k.....
....k.....k.....
...kk.....kk....
...k.......k....
""")

# Tablero con gráfica subiendo (32x32, pared)
chart = [["w"] * 32 for _ in range(32)]
for x in range(32):
    chart[0][x] = chart[31][x] = "k"
for y in range(32):
    chart[y][0] = chart[y][31] = "k"
for x in range(2, 30):
    chart[28][x] = "g"
for y in range(2, 29):
    chart[y][3] = "g"
# barras
for (bx, bh, col) in [(6, 6, "r"), (11, 9, "o"), (16, 13, "y"), (21, 17, "e"), (26, 22, "e")]:
    for y in range(28 - bh, 28):
        for x in range(bx, bx + 3):
            chart[y][x] = col
# línea de tendencia
pts = [(5, 24), (9, 21), (13, 18), (17, 14), (21, 10), (25, 6), (28, 4)]
for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
    steps = max(abs(x2 - x1), abs(y2 - y1))
    for s in range(steps + 1):
        x = round(x1 + (x2 - x1) * s / steps); y = round(y1 + (y2 - y1) * s / steps)
        chart[y][x] = "k"
SPRITES["CHART_UP"] = ["".join(r) for r in chart]

SPRITES["SAFE"] = grid("""
.kkkkkkkkkkkkkk.
kKKKKKKKKKKKKKKk
kKggggggggggggKk
kKgGGGGGGGGGGgKk
kKgGGGkkkGGGGgKk
kKgGGkGGGkGGGgKk
kKgGGkGkGkGyGgKk
kKgGGkGGGkGyGgKk
kKgGGGkkkGGGGgKk
kKgGGGGGGGGGGgKk
kKgGGGGGGGGGGgKk
kKggggggggggggKk
kKKKKKKKKKKKKKKk
.kkkkkkkkkkkkkk.
..kk........kk..
..kk........kk..
""")

SPRITES["PIGGY_BANK"] = grid("""
................
......kkkk......
....kkppppkk....
...kppppppppk...
..kpppkkkppppk..
.kppppppppppppk.
.kppkpppppppppk.
.kpkkppppppppkk.
.kppppppppppkpk.
.kppppppppppppk.
..kppppppppppk..
...kkppppppkk...
...kpk....kpk...
...kkk....kkk...
................
................
""")

SPRITES["GOLD_BARS"] = grid("""
................
................
................
................
......kkkkkk....
.....kYYYYYYk...
....kyyyyyyyyk..
...kkkkkkkkkkkk.
..kYYYYYkYYYYYk.
.kyyyyyykyyyyyyk
kkkkkkkkkkkkkkkk
................
................
................
................
................
""")

# Caminadora 32x32 (2x2 tiles), vista frontal-superior
tread = [["."] * 32 for _ in range(32)]
for y in range(6, 30):
    for x in range(4, 28):
        tread[y][x] = "K"
for y in range(8, 28):
    for x in range(6, 26):
        tread[y][x] = "k" if (y % 4 == 0) else "g"
for y in range(2, 8):
    for x in range(8, 24):
        tread[y][x] = "G"
for y in range(3, 6):
    for x in range(11, 21):
        tread[y][x] = "c"
for y in range(6, 14):
    tread[y][7] = tread[y][24] = "G"
for y in range(30, 32):
    for x in range(4, 28):
        tread[y][x] = "k"
SPRITES["TREADMILL"] = ["".join(r) for r in tread]

# Rack de mancuernas 32x32 (2x2)
rack = [["."] * 32 for _ in range(32)]
for y in [8, 16, 24]:
    for x in range(2, 30):
        rack[y][x] = "n"; rack[y + 1][x] = "N"
for y in range(6, 30):
    rack[y][2] = rack[y][3] = rack[y][28] = rack[y][29] = "n"
def dumbbell(r0, c0, col):
    for dx in range(2):
        for dy in range(3):
            rack[r0 + dy][c0 + dx] = col; rack[r0 + dy][c0 + 5 + dx] = col
    rack[r0 + 1][c0 + 2] = rack[r0 + 1][c0 + 3] = rack[r0 + 1][c0 + 4] = "k"
for i, (row, cols) in enumerate([(5, (6, 15, 24 - 4)), (13, (6, 15, 20)), (21, (6, 15, 20))]):
    for j, c in enumerate(cols):
        dumbbell(row, c, ["r", "B", "e"][(i + j) % 3])
SPRITES["DUMBBELL_RACK"] = ["".join(r) for r in rack]

# Mat de yoga 32x16 (2x1)
mat = [["."] * 32 for _ in range(16)]
for y in range(3, 13):
    for x in range(2, 30):
        mat[y][x] = "V" if (x + y) % 6 == 0 else "v"
for x in range(2, 30):
    mat[3][x] = mat[12][x] = "k"
for y in range(3, 13):
    mat[y][2] = mat[y][29] = "k"
SPRITES["YOGA_MAT"] = ["".join(r) for r in mat]

SPRITES["KETTLEBELL"] = grid("""
................
................
.....kkkkkk.....
....kk....kk....
....k......k....
....k......k....
...kkkkkkkkkk...
..kkKKKKKKKKkk..
.kKKKKKKKKKKKKk.
.kKKKKKkkKKKKKk.
.kKKKKKkkKKKKKk.
.kKKKKKKKKKKKKk.
..kKKKKKKKKKKk..
...kkkkkkkkkk...
................
................
""")

# Barra olímpica 32x16 (2x1)
bar = [["."] * 32 for _ in range(16)]
for x in range(2, 30):
    bar[8][x] = "g"; bar[9][x] = "G"
for cx in (3, 6, 25, 28):
    for y in range(3, 15):
        bar[y][cx] = bar[y][cx + 1] = "k"
        if 4 < y < 13:
            bar[y][cx] = "K"
SPRITES["BARBELL"] = ["".join(r) for r in bar]

# Tupper de comida 16x16 (sobre escritorio, tema gym)
SPRITES["LUNCHBOX"] = grid("""
................
................
................
....kkkkkkkk....
...kBBBBBBBBk...
..kBBBBBBBBBBk..
..kkkkkkkkkkkk..
..kwwwwwwwwwwk..
..kweeerooeewk..
..kweeerooeewk..
..kwwwwwwwwwwk..
..kkkkkkkkkkkk..
................
................
................
................
""")

ITEMS = {
    "CHART_UP":      dict(name="Gráfica",          category="wall", w=32, h=32, fw=2, fh=2, wall=True, surf=False),
    "SAFE":          dict(name="Caja fuerte",      category="misc", w=16, h=16, fw=1, fh=1, wall=False, surf=False),
    "PIGGY_BANK":    dict(name="Alcancía",         category="decor", w=16, h=16, fw=1, fh=1, wall=False, surf=True),
    "GOLD_BARS":     dict(name="Lingotes",         category="decor", w=16, h=16, fw=1, fh=1, wall=False, surf=True),
    "TREADMILL":     dict(name="Caminadora",       category="misc", w=32, h=32, fw=2, fh=2, wall=False, surf=False),
    "DUMBBELL_RACK": dict(name="Rack mancuernas",  category="misc", w=32, h=32, fw=2, fh=2, wall=False, surf=False),
    "YOGA_MAT":      dict(name="Mat de yoga",      category="misc", w=32, h=16, fw=2, fh=1, wall=False, surf=False),
    "KETTLEBELL":    dict(name="Kettlebell",       category="misc", w=16, h=16, fw=1, fh=1, wall=False, surf=False),
    "BARBELL":       dict(name="Barra",            category="misc", w=32, h=16, fw=2, fh=1, wall=False, surf=False),
    "LUNCHBOX":      dict(name="Tupper",           category="decor", w=16, h=16, fw=1, fh=1, wall=False, surf=True),
    "NOTE_BOARD":     dict(name="Tablero de notas", category="wall", w=32, h=32, fw=2, fh=2, wall=True, surf=False),
    "TV_WALL":        dict(name="Televisor (reportes)", category="wall", w=32, h=32, fw=2, fh=2, wall=True, surf=False),
    "HOUSE":          dict(name="Casa",             category="decor", w=16, h=16, fw=1, fh=1, wall=False, surf=True),
    "SIGNAL_TOWER":   dict(name="Antena",           category="misc", w=16, h=16, fw=1, fh=1, wall=False, surf=False),
    "SOFA_LOUNGE":    dict(name="Sofá de descanso", category="chairs", w=48, h=32, fw=3, fh=2, wall=False, surf=False, bg=1),
    "COFFEE_MACHINE": dict(name="Máquina de café",  category="decor", w=16, h=16, fw=1, fh=1, wall=False, surf=True),
    "BOOK_STACK":     dict(name="Pila de libros",   category="decor", w=16, h=16, fw=1, fh=1, wall=False, surf=True),
    "MENU_BOARD":     dict(name="Tablero de menú",  category="wall", w=32, h=32, fw=2, fh=2, wall=True, surf=False),
    "PUNCHING_BAG":   dict(name="Saco de boxeo",    category="misc", w=16, h=32, fw=1, fh=2, wall=False, surf=False, bg=1),
    "BENCH_PRESS":    dict(name="Banco de pesas",   category="misc", w=32, h=16, fw=2, fh=1, wall=False, surf=False),
    "WIFI_SIGN":      dict(name="Letrero WiFi",     category="wall", w=16, h=16, fw=1, fh=1, wall=True, surf=False),
}

# ---------- letreros de las salas ----------
# Uno por sala de oficinas.json (id = sala["sign"]), con el color de la sala.
# letreros.json puede cambiar el texto: {"SIGN_<ID>": "TEXTO"} (máx. 15 caracteres).
def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
def shade(rgb, f, to=(0, 0, 0)):
    return tuple(int(c * (1 - f) + t * f) for c, t in zip(rgb, to)) + (255,)

def letreros_de_salas():
    try:
        salas = json.load(open(os.path.join(DATA, "oficinas.json")))["salas"]
    except Exception:
        salas = []
    try:
        textos = json.load(open(os.path.join(DATA, "letreros.json")))
    except Exception:
        textos = {}
    for sala in salas:
        sid = sala.get("sign") or "SIGN_" + "".join(ch for ch in sala["label"].upper() if ch.isalnum())
        text = "".join(ch for ch in textos.get(sid, sala["label"]).upper() if ch in FONT)[:15] or "SALA"
        w = 48 if len(text) <= 11 else 64   # 4 px por letra: 11 caben en 48, 15 en 64
        rgb = hex_rgb(sala.get("color", "#888888"))
        pal = {**P, "1": shade(rgb, 0.6), "2": (245, 245, 240, 255), "3": shade(rgb, 0.15)}
        SPRITES[sid] = sign(text, w, 16, "1", "2", "3")
        ITEMS[sid] = dict(name="Letrero " + text.title(), category="wall", w=w, h=16, fw=w // 16, fh=1, wall=True, surf=False, pal=pal)
letreros_de_salas()

for id_, it in ITEMS.items():
    rows = SPRITES[id_]
    assert len(rows) == it["h"] and len(rows[0]) == it["w"], (id_, len(rows), len(rows[0]))
    d = os.path.join(ROOT, id_); os.makedirs(d, exist_ok=True)
    write_png(os.path.join(d, id_ + ".png"), rows, it.get("pal", P))
    man = {
        "id": id_, "name": it["name"], "category": it["category"], "type": "asset",
        "file": id_ + ".png", "width": it["w"], "height": it["h"],
        "footprintW": it["fw"], "footprintH": it["fh"],
        "canPlaceOnWalls": it["wall"], "canPlaceOnSurfaces": it["surf"], "backgroundTiles": it.get("bg", 0),
    }
    json.dump(man, open(os.path.join(d, "manifest.json"), "w"), indent=2, ensure_ascii=False)
    print("ok", id_, it["w"], "x", it["h"])
print("pack en", os.path.join(DATA, "assets"))

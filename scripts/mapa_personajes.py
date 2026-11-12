#!/usr/bin/env python3
"""Mapa visual de personajes (temas Pokémon y Yu-Gi-Oh) como HTML autocontenido.

Pide a la oficina en marcha el reparto actual (`/api/skin`) y el catálogo del tema
(`/api/skin/catalog`), baja cada sprite y lo incrusta en el HTML. Solo es para mirar:
arriba, qué personaje tiene cada agente; abajo, todos los del tema por grupo y cadena.

    python3 scripts/mapa_personajes.py [salida.html]      (por defecto docs/reports/mapa-personajes.html)

Variables: OFICINA_URL (por defecto http://127.0.0.1:3100).
"""
import base64, html, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ.get("OFICINA_URL", "http://127.0.0.1:3100").rstrip("/")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "reports", "mapa-personajes.html")


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cubicle-map"}), timeout=20) as r:
        return r.read()


def data_uri(url):
    full = BASE + url[1:] if url.startswith("./") else url
    try:
        raw = get(full)
    except Exception:
        return ""
    kind = "gif" if full.lower().split("?")[0].endswith(".gif") else "png"
    return "data:image/%s;base64,%s" % (kind, base64.b64encode(raw).decode())


def main():
    skin = json.loads(get(BASE + "/api/skin"))
    cat = json.loads(get(BASE + "/api/skin/catalog"))
    if not cat["groups"]:
        sys.exit("El tema clásico no tiene personajes.")
    es = True
    try:
        es = json.loads(get(BASE + "/api/lang")).get("lang") == "es"
    except Exception:
        pass
    gname = lambda g: g["es"] if es else g["en"]
    urls = {f["sprite"] for g in cat["groups"] for c in g["chains"] for f in c} | {a["sprite"] for a in skin["agents"].values()}
    with ThreadPoolExecutor(8) as ex:
        img = dict(zip(urls, ex.map(data_uri, urls)))
    owners = {}
    for name, a in skin["agents"].items():
        owners.setdefault(a["id"], []).append(name)
    groups = {g["id"]: g for g in cat["groups"]}
    e = html.escape
    pic = lambda u, n, s: '<img src="%s" alt="%s" width="%d" height="%d">' % (img.get(u, ""), e(n), s, s)

    rooms = []
    order = list(skin["rooms"].keys())
    by_room = {}
    for name, a in skin["agents"].items():
        by_room.setdefault(a.get("room") or "", []).append((name, a))
    for room in order + [r for r in by_room if r not in order]:
        if room not in by_room:
            continue
        g = groups.get(skin["rooms"].get(room, ""))
        cards = "".join(
            '<div class="agent">%s<div><b>%s</b><span>%s</span><small>%s %d</small></div></div>' % (pic(a["sprite"], a["name"], 64), e(name), e(a["name"]), "Nivel" if es else "Level", a["level"])
            for name, a in by_room[room]
        )
        rooms.append('<section><h3 style="color:%s">%s%s</h3><div class="row">%s</div></section>' % (g["color"] if g else "#aaa", e(room or "—"), " · " + e(gname(g)) if g else "", cards))

    decks = []
    for g in cat["groups"]:
        chains = []
        for c in g["chains"]:
            forms = []
            for f in c:
                who = owners.get(f["id"], [])
                forms.append('<div class="form%s">%s<span>%s</span>%s</div>' % (" taken" if who else "", pic(f["sprite"], f["name"], 64), e(f["name"]), "<em>%s</em>" % e(", ".join(who)) if who else ""))
            chains.append('<div class="chain">%s</div>' % '<i>›</i>'.join(forms))
        decks.append('<section><h3 style="color:%s">%s</h3><div class="row">%s</div></section>' % (g["color"], e(gname(g)), "".join(chains)))

    t = (lambda a, b: a) if es else (lambda a, b: b)
    page = """<!doctype html><html lang="%s"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s</title><style>
:root{color-scheme:dark}body{margin:0;padding:20px 16px 40px;background:#16161f;color:#e6e6f0;font:14px/1.35 system-ui,-apple-system,Segoe UI,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 2px}p{margin:0 0 10px;color:#9a9ab0;font-size:12px}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:14px 0 6px}
.row{display:flex;flex-wrap:wrap;gap:8px 18px}img{image-rendering:pixelated;object-fit:contain;flex:none}
.agent{display:flex;align-items:center;gap:10px;background:#20202e;border-radius:8px;padding:6px 12px 6px 6px}
.agent div{display:flex;flex-direction:column}.agent span{color:#b9b9cc;font-size:12px}.agent small{color:#7d7d95;font-size:11px}
.chain{display:flex;align-items:flex-start;gap:2px}.chain i{align-self:center;color:#6c6c85;font-style:normal;font-size:18px;margin-top:-18px}
.form{width:92px;display:flex;flex-direction:column;align-items:center;text-align:center;padding:4px 2px;border-radius:8px}
.form span{font-size:11px;color:#c9c9da;line-height:1.2}.form em{font-style:normal;font-size:10px;color:#ffd166;line-height:1.2;margin-top:2px}
.taken{background:#262637;outline:1px solid #4a4a66}
</style></head><body>
<h1>%s</h1><p>%s</p>
<h2>%s</h2>%s
<h2>%s</h2><p>%s</p>%s
</body></html>""" % (
        "es" if es else "en",
        t("Mapa de personajes", "Character map"),
        t("Mapa de personajes", "Character map"),
        t("Solo para mirar. Para cambiar uno, di el agente y el nombre del personaje.", "View only. To change one, name the agent and the character."),
        t("Tus agentes ahora", "Your agents now"),
        "".join(rooms),
        t("Todos los personajes del tema", "Every character in the theme"),
        t("Las flechas marcan las evoluciones. En amarillo, el agente que ya tiene ese personaje.", "Arrows mark evolutions. In yellow, the agent that already has that character."),
        "".join(decks),
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(page)
    print(OUT, "%d KB" % (len(page) // 1024), "sin imagen:", sum(1 for v in img.values() if not v))


if __name__ == "__main__":
    main()

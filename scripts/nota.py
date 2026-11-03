#!/usr/bin/env python3
"""Agrega una nota al tablero de una sala de la oficina (para usar desde cualquier sesión de Claude).
Uso:  nota.py "<Sala>" "<texto de la nota>" [--by "quién"]
<Sala> es la etiqueta del área en el layout (proyecto.py lista).
Escribe en ~/.pixel-agents/notes.json; la oficina lo relee sola.
"""
import json, os, sys, time, random, string

if len(sys.argv) < 3:
    sys.exit(__doc__)
area, text = sys.argv[1], sys.argv[2].strip()
by = sys.argv[sys.argv.index("--by") + 1] if "--by" in sys.argv else None
f = os.path.expanduser("~/.pixel-agents/notes.json")
try:
    doc = json.load(open(f))
except Exception:
    doc = {}
item = {"id": f"n-{int(time.time()*1000)}-{''.join(random.choices(string.ascii_lowercase+string.digits,k=5))}",
        "text": text[:500], "done": False, "createdAt": int(time.time() * 1000)}
if by: item["by"] = by
doc.setdefault(area, []).append(item)
os.makedirs(os.path.dirname(f), exist_ok=True)
tmp = f + ".tmp"
json.dump(doc, open(tmp, "w"), indent=1, ensure_ascii=False)
os.replace(tmp, f)
print(f"nota agregada a «{area}»: {text}")

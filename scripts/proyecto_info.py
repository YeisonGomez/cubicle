#!/usr/bin/env python3
"""Ficha de cada oficina (sala) escrita por su propia sesión: <OFICINA_DIR>/proyectos.json

  { "<Sala>": { "descripcion": "una línea", "subproyectos": {"<carpeta>": "una línea"},
                "roles": {"<Directorio>": "rol en una frase"}, "actualizado": ms } }

  proyecto_info.py pregunta "<Sala>" [carpeta ...]   imprime la pregunta estándar (con las carpetas y agentes)
  proyecto_info.py set "<Sala>" < json                guarda (reemplaza) la ficha
  proyecto_info.py get ["<Sala>"]
"""
import json, os, sys, time

DATA = os.environ.get("OFICINA_DIR") or os.path.join(os.path.expanduser("~"), ".pixel-agents", "oficina")
DB = os.path.join(DATA, "proyectos.json")
OFI = os.path.dirname(os.path.abspath(__file__))

PREGUNTA = """Cubicle: describe esta oficina (proyecto "{sala}") para su ficha. Lee el CLAUDE.md, AGENTS.md o README
de {base} y de sus subcarpetas principales, y responde SOLO ejecutando este comando con el JSON lleno
(sin texto adicional):

python3 {script} set "{sala}" <<'JSON'
{{
  "descripcion": "Una sola línea (máx. 140 caracteres): qué es este proyecto y para qué sirve",
  "subproyectos": {{ {subs} }},
  "roles": {{ {roles} }}
}}
JSON

Reglas: "subproyectos" = una línea por carpeta de las listadas (qué es; si no sabes, "Sin información").
"roles" = para cada agente listado, su rol en una frase (qué parte del proyecto lleva y para qué se le pide ayuda).
Todo en español, empezando con mayúscula, sin rutas ni datos sensibles."""

PREGUNTA_EN = """Cubicle: describe this office (project "{sala}") for its project card. Read the CLAUDE.md, AGENTS.md or README
of {base} and of its main sub-folders, and reply ONLY by running this command with the JSON filled in
(no extra text):

python3 {script} set "{sala}" <<'JSON'
{{
  "descripcion": "A single line (max 140 characters): what this project is and what it is for",
  "subproyectos": {{ {subs} }},
  "roles": {{ {roles} }}
}}
JSON

Rules: "subproyectos" = one line per listed folder (what it is; if unknown, "No information").
"roles" = for each listed agent, its role in one sentence (which part of the project it owns and what you ask it for).
Everything in English, starting with a capital letter, no paths or sensitive data."""

def pregunta_tpl():
    return PREGUNTA_EN if os.environ.get("OFICINA_LANG", "en") == "en" else PREGUNTA

def cap(s):
    s = str(s).strip()
    return s[:1].upper() + s[1:] if s else s

def load():
    return json.load(open(DB)) if os.path.exists(DB) else {}

def save(d):
    os.makedirs(DATA, exist_ok=True)
    tmp = DB + ".tmp"
    json.dump(d, open(tmp, "w"), indent=2, ensure_ascii=False)
    os.replace(tmp, DB)

def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__); return 0
    cmd = argv[1]
    if cmd == "pregunta":
        sala = argv[2]
        base = os.environ.get("OFICINA_BASE", "the office folder" if os.environ.get("OFICINA_LANG", "en") == "en" else "la carpeta de la oficina")
        subs = ", ".join(f'"{c}": "…"' for c in argv[3:]) or '"<carpeta>": "…"'
        roles = ", ".join(f'"{a}": "…"' for a in os.environ.get("OFICINA_AGENTES", "").split("|") if a) or '"<agente>": "…"'
        print(pregunta_tpl().format(sala=sala, base=base, script=os.path.join(OFI, "proyecto_info.py"), subs=subs, roles=roles)); return 0
    if cmd == "set":
        sala = argv[2]
        raw = json.loads(sys.stdin.read())
        d = load()
        d[sala] = {
            "descripcion": cap(raw.get("descripcion", ""))[:160],
            "subproyectos": {str(k)[:80]: cap(v)[:160] for k, v in (raw.get("subproyectos") or {}).items() if str(k).strip()},
            "roles": {str(k)[:60]: cap(v)[:200] for k, v in (raw.get("roles") or {}).items() if str(k).strip()},
            "actualizado": int(time.time() * 1000),
        }
        save(d)
        print(f"guardada la ficha de {sala}: {len(d[sala]['subproyectos'])} subproyectos, {len(d[sala]['roles'])} roles → {DB}")
        return 0
    if cmd == "get":
        d = load(); print(json.dumps(d.get(argv[2]) if len(argv) > 2 else d, indent=2, ensure_ascii=False)); return 0
    print("comando desconocido", cmd); return 1

if __name__ == "__main__":
    sys.exit(main(sys.argv))
